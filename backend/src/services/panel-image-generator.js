const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { GoogleGenAI } = require('@google/genai');
const { HttpError } = require('../utils/http-error');
const { VISUAL_STYLES } = require('../config/story-options');

const DEFAULT_IMAGE_DIRECTORY = path.resolve(__dirname, '../../generated');
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const IMAGE_TIMEOUT_MS = 60000;
const POLLINATIONS_TIMEOUT_MS = 45000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function buildImagePrompt({ project, panel }) {
  const style = VISUAL_STYLES.find((option) => option.id === project.visualStyle);
  if (!style || project.styleLocked !== true) {
    throw new HttpError(409, 'This project does not have a valid locked visual style.');
  }

  return [
    'Create one polished, subject-accurate comic or storyboard illustration. Depict the described people, place, era, objects, and action specifically; prioritize recognizable subject details and clear visual storytelling over generic decorative imagery.',
    `Use the locked art direction "${style.label}" (${style.description}) consistently.`,
    project.paletteNotes ? `Color palette and atmosphere: ${project.paletteNotes}.` : '',
    'Single full-bleed landscape comic frame with 16:9 composition (16:9 widescreen), detailed ink illustration, and vibrant comic lighting. Match the described subject count, appearance, clothing, era, location, and action. Avoid unrelated characters, props, costumes, lettering, captions, speech bubbles, borders, and watermarks.',
    ...(project.characterAnchors?.length
      ? [`Character continuity anchors (match these exactly): ${project.characterAnchors.join('; ')}.`]
      : []),
    `Scene and composition: ${panel.visualPrompt}`,
    `Panel title for story context: ${panel.title}.`,
    `Narration for story context: ${panel.narration}.`
  ].filter(Boolean).join('\n');
}

function getGeminiClient(options = {}) {
  if (options.ai || options.client) return options.ai || options.client;
  const env = options.env || process.env;
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, 'Gemini image generation is unavailable. Configure GEMINI_API_KEY on the backend.', 'GEMINI_IMAGE_NOT_CONFIGURED');
  }
  return new GoogleGenAI({ apiKey });
}

function isQuotaError(error) {
  const details = [error?.message, error?.status, error?.code, error?.error, error?.response?.data]
    .filter(Boolean).map((detail) => {
      if (typeof detail === 'string') return detail;
      try { return JSON.stringify(detail); } catch { return String(detail); }
    }).join(' ');
  return /429|RESOURCE_EXHAUSTED|quota|limit\s*:\s*0/i.test(details);
}

function detectImageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function imageDataFromBytes(bytes, mimeType) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function readGeminiImage(response) {
  const parts = response?.candidates?.[0]?.content?.parts || response?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data);
  if (!imagePart) throw new Error('Gemini did not return inline image data.');

  const mimeType = String(imagePart.inlineData.mimeType || 'image/png').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) throw new Error(`Gemini returned an unsupported image type: ${mimeType}.`);
  const bytes = Buffer.from(imagePart.inlineData.data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Gemini returned an empty image or an image larger than 15 MB.');
  const extension = detectImageExtension(bytes);
  if (!extension || (mimeType === 'image/png' && extension !== 'png') ||
      (mimeType === 'image/jpeg' && extension !== 'jpg') || (mimeType === 'image/webp' && extension !== 'webp')) {
    throw new Error('Gemini image data was not a valid image matching its declared MIME type.');
  }
  return { bytes, mimeType };
}

async function generateGeminiImageDataUrl(promptText, options = {}) {
  if (typeof promptText !== 'string' || !promptText.trim()) {
    throw new HttpError(400, 'An image prompt is required.', 'IMAGE_PROMPT_REQUIRED');
  }
  const ai = getGeminiClient(options);
  const response = await ai.models.generateContent({
    model: options.model || GEMINI_IMAGE_MODEL,
    contents: promptText.trim(),
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9' },
      abortSignal: options.signal || AbortSignal.timeout(IMAGE_TIMEOUT_MS)
    }
  });
  const { bytes, mimeType } = readGeminiImage(response);
  return imageDataFromBytes(bytes, mimeType);
}

function buildPollinationsImageUrl(promptText, random = Math.random) {
  const seed = Math.floor(random() * 100000);
  return `https://gen.pollinations.ai/image/${encodeURIComponent(promptText)}?model=black-forest-labs%2Fflux.1-schnell&width=1280&height=720&nologo=true&seed=${seed}`;
}

async function generatePollinationsImageDataUrl(promptText, options = {}) {
  const fetchImage = options.fetch || globalThis.fetch;
  if (typeof fetchImage !== 'function') throw new Error('Image fetching is unavailable in this Node.js runtime.');
  const env = options.env || process.env;
  const apiKey = env.POLLINATIONS_API_KEY?.trim() || env.POLLINATIONS_KEY?.trim();
  if (!apiKey) {
    throw new Error('Pollinations fallback needs a server API key. Add POLLINATIONS_API_KEY to backend/.env.');
  }
  const response = await fetchImage(buildPollinationsImageUrl(promptText, options.random), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: options.signal || AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS)
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240); } catch {}
    throw new Error(`Pollinations returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
  }

  const declaredType = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Pollinations returned an empty image or an image larger than 15 MB.');
  const extension = detectImageExtension(bytes);
  const mimeType = extension === 'jpg' ? 'image/jpeg' : extension ? `image/${extension}` : '';
  if (!extension || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType) || (declaredType && declaredType !== mimeType)) {
    throw new Error('Pollinations did not return a valid PNG, JPEG, or WebP image.');
  }
  return imageDataFromBytes(bytes, mimeType);
}

async function generateImageResult(promptText, options = {}) {
  let geminiFailure = 'Gemini image generation failed';
  try {
    return { dataUrl: await generateGeminiImageDataUrl(promptText, options), imageSource: 'gemini-image' };
  } catch (error) {
    const status = Number(error?.status || error?.statusCode);
    geminiFailure = isQuotaError(error)
      ? 'Gemini image quota is exhausted'
      : `Gemini image generation failed${Number.isFinite(status) && status > 0 ? ` (HTTP ${status})` : ''}`;
    const logger = options.logger || console;
    if (isQuotaError(error)) {
      logger.warn('Gemini free-tier image quota is exhausted; switching to Pollinations FLUX.');
    } else {
      logger.warn(`${geminiFailure}; switching to Pollinations FLUX.`);
    }
    let fallbackError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return { dataUrl: await generatePollinationsImageDataUrl(promptText, options), imageSource: 'pollinations-flux' };
      } catch (error) {
        fallbackError = error;
      }
    }
    throw new HttpError(
      502,
      `${geminiFailure}. Pollinations fallback failed: ${fallbackError?.message || 'Please try again.'}`,
      'IMAGE_GENERATION_FAILED'
    );
  }
}

async function generateImageDataUrl(promptText, options = {}) {
  return (await generateImageResult(promptText, options)).dataUrl;
}

async function saveGeneratedImage(dataUrl, imageSource, options = {}) {
  const imageDirectory = options.imageDirectory || DEFAULT_IMAGE_DIRECTORY;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/=]+)$/i.exec(dataUrl || '');
  if (!match) throw new Error('Generated image data URL is invalid.');
  const bytes = Buffer.from(match[2], 'base64');
  const mimeType = match[1].toLowerCase();
  const extension = detectImageExtension(bytes);
  const expectedType = extension === 'jpg' ? 'image/jpeg' : extension ? `image/${extension}` : '';
  if (!extension || expectedType !== mimeType || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Generated image data URL did not contain valid image bytes.');
  }
  await fs.mkdir(imageDirectory, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(imageDirectory, filename), bytes, { flag: 'wx' });
  return { imageUrl: `/generated/${filename}`, imageSource };
}

async function generatePanelImage(promptOrInput, options = {}) {
  if (typeof promptOrInput === 'string') return generateImageDataUrl(promptOrInput, options);
  const prompt = buildImagePrompt(promptOrInput);
  const { dataUrl, imageSource } = await generateImageResult(prompt, options);
  return { ...await saveGeneratedImage(dataUrl, imageSource, options), status: 'locked' };
}

async function generatePanelImages({ project, panels }, options = {}) {
  if (!Array.isArray(panels) || panels.length < 1 || panels.length > 6) {
    throw new HttpError(400, 'Generate between 1 and 6 storyboard panels at a time.', 'INVALID_PANEL_COUNT');
  }
  const imageDirectory = options.imageDirectory || DEFAULT_IMAGE_DIRECTORY;
  const createdFiles = [];
  await fs.mkdir(imageDirectory, { recursive: true });

  try {
    const results = await Promise.allSettled(panels.map(async (panel, index) => {
      try {
        const generated = await generatePanelImage({ project, panel }, options);
        createdFiles.push(path.join(imageDirectory, path.basename(generated.imageUrl)));
        return { ...panel, ...generated, panelNumber: panel.panelNumber || index + 1 };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, `Could not generate artwork for frame ${panel.panelNumber || index + 1}. Please retry.`, 'IMAGE_GENERATION_FAILED');
      }
    }));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map((result) => result.value);
  } catch (error) {
    await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => {})));
    throw error;
  }
}

module.exports = {
  DEFAULT_IMAGE_DIRECTORY,
  GEMINI_IMAGE_MODEL,
  buildImagePrompt,
  buildPollinationsImageUrl,
  detectImageExtension,
  generateGeminiImageDataUrl,
  generateImageDataUrl,
  generateImageResult,
  generatePanelImage,
  generatePanelImages,
  generatePollinationsImageDataUrl,
  isQuotaError
};
