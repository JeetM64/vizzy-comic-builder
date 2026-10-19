const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  GEMINI_IMAGE_MODEL,
  buildImagePrompt,
  buildPollinationsImageUrl,
  generateGeminiImageDataUrl,
  generateImageDataUrl,
  generateImageResult,
  isQuotaError,
  generatePanelImage,
  generatePanelImages
} = require('../src/services/panel-image-generator');

const project = { visualStyle: 'bold-ink', styleLocked: true, paletteNotes: 'Indigo shadows, warm amber highlights' };
const panel = {
  panelNumber: 1,
  title: 'The glowing map',
  narration: 'A hero discovers a glowing map in a mystical forest.',
  visualPrompt: 'A brave hero lifts a glowing map beneath ancient forest trees.'
};
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

function makeAi(response = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }] } }]
}) {
  const requests = [];
  return {
    requests,
    ai: { models: { generateContent: async (request) => { requests.push(request); return response; } } }
  };
}

describe('Gemini Nano Banana comic panel generation', () => {
  it('synthesizes a subject-anchored prompt with locked style and palette context', () => {
    const prompt = buildImagePrompt({
      project: { ...project, characterAnchors: ['Mara wears a red scarf and carries a brass compass.'] },
      panel
    });
    assert.match(prompt, /subject-accurate comic or storyboard illustration/i);
    assert.match(prompt, /locked art direction/i);
    assert.match(prompt, /16:9 composition/i);
    assert.match(prompt, /Mara wears a red scarf/);
    assert.match(prompt, /Indigo shadows/);
    assert.match(prompt, /glowing map/);
  });

  it('requests Gemini image-only output at 16:9 and returns an inline data URL', async () => {
    const { ai, requests } = makeAi();
    const dataUrl = await generatePanelImage('A specific comic scene.', { ai });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, GEMINI_IMAGE_MODEL);
    assert.deepEqual(requests[0].config.responseModalities, ['IMAGE']);
    assert.equal(requests[0].config.imageConfig.aspectRatio, '16:9');
    assert.equal(dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('allows production deployments to select a supported Gemini image model from the environment', async () => {
    const { ai, requests } = makeAi();
    await generateGeminiImageDataUrl('A specific comic scene.', {
      ai,
      env: { GEMINI_IMAGE_MODEL: 'production-image-model' }
    });
    assert.equal(requests[0].model, 'production-image-model');
  });

  it('saves actual Gemini image bytes as a generated static asset for the panel API', async () => {
    const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vizzy-gemini-'));
    const { ai, requests } = makeAi();
    try {
      const generated = await generatePanelImages({ project, panels: [panel] }, { imageDirectory, ai });
      assert.equal(generated.length, 1);
      assert.match(generated[0].imageUrl, /^\/generated\/[a-f0-9-]+\.jpg$/i);
      assert.equal(generated[0].imageSource, 'gemini-image');
      assert.equal(generated[0].status, 'locked');
      assert.match(requests[0].contents, /glowing map/);
      assert.deepEqual(await fs.readFile(path.join(imageDirectory, path.basename(generated[0].imageUrl))), jpeg);
    } finally {
      await fs.rm(imageDirectory, { recursive: true, force: true });
    }
  });

  it('falls back to Pollinations when Gemini returns no inline image data', async () => {
    const { ai } = makeAi({ candidates: [{ content: { parts: [{ text: 'No image was generated.' }] } }] });
    const dataUrl = await generateImageDataUrl('A comic scene.', {
      ai,
      env: { POLLINATIONS_API_KEY: 'test-key' },
      fetch: async () => ({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => jpeg
      })
    });
    assert.equal(dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('uses Pollinations when the Gemini key is missing and produces a data URL', async () => {
    const result = await generateImageResult('A comic scene.', {
      fetch: async (url) => {
        assert.match(url, /^https:\/\/gen\.pollinations\.ai\/image\//);
        return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg };
      },
      env: { POLLINATIONS_API_KEY: 'test-key' }
    });
    assert.equal(result.imageSource, 'pollinations-flux');
    assert.equal(result.dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('sends the Pollinations server key as a bearer token and explains missing configuration', async () => {
    let authHeader;
    await generateImageDataUrl('A comic scene.', {
      env: { POLLINATIONS_API_KEY: 'server-secret' },
      fetch: async (_url, request) => {
        authHeader = request.headers.Authorization;
        return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg };
      }
    });
    assert.equal(authHeader, 'Bearer server-secret');
    await assert.rejects(
      generateImageDataUrl('A comic scene.', { env: {}, fetch: async () => { throw new Error('should not fetch'); } }),
      /Add POLLINATIONS_API_KEY to backend\/\.env/
    );
  });

  it('detects Gemini quota errors and switches to Pollinations immediately', async () => {
    const warnings = [];
    const ai = { models: { generateContent: async () => { throw Object.assign(new Error('RESOURCE_EXHAUSTED: limit: 0'), { status: 429 }); } } };
    let requestedUrl;
    const result = await generateImageResult('A specific Normandy scene.', {
      ai,
      random: () => 0.42,
      logger: { warn: (message) => warnings.push(message) },
      env: { POLLINATIONS_API_KEY: 'test-key' },
      fetch: async (url) => {
        requestedUrl = url;
        return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg };
      }
    });
    assert.ok(isQuotaError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 })));
    assert.equal(new URL(requestedUrl).searchParams.get('seed'), '42000');
    assert.equal(new URL(requestedUrl).searchParams.get('width'), '1280');
    assert.equal(new URL(requestedUrl).searchParams.get('height'), '720');
    assert.equal(result.imageSource, 'pollinations-flux');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /free-tier image quota/);
    assert.equal(buildPollinationsImageUrl('A scene.', () => 0.42), 'https://gen.pollinations.ai/image/A%20scene.?model=black-forest-labs%2Fflux.1-schnell&width=1280&height=720&nologo=true&seed=42000');
  });

  it('returns a clean error if Gemini and Pollinations both fail', async () => {
    const ai = { models: { generateContent: async () => { throw new Error('provider down'); } } };
    await assert.rejects(
      generateImageDataUrl('A comic scene.', {
        ai,
        env: { POLLINATIONS_API_KEY: 'test-key' },
        fetch: async () => ({ ok: false, status: 503 })
      }),
      (error) => error.status === 502 && error.code === 'IMAGE_GENERATION_FAILED' && /Gemini.*Pollinations/.test(error.message)
    );
  });

  it('removes already-written image assets if a later frame fails', async () => {
    const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vizzy-gemini-'));
    let call = 0;
    const ai = { models: { generateContent: async () => {
      call += 1;
      if (call === 1) {
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }] } }] };
      }
      throw new Error('Gemini unavailable');
    } } };
    try {
      await assert.rejects(
        generatePanelImages({ project, panels: [panel, { ...panel, panelNumber: 2 }] }, {
          imageDirectory,
          ai,
          env: { POLLINATIONS_API_KEY: 'test-key' },
          fetch: async () => ({ ok: false, status: 503 })
        }),
        (error) => error.status === 502 && error.code === 'IMAGE_GENERATION_FAILED'
      );
      assert.deepEqual(await fs.readdir(imageDirectory), []);
    } finally {
      await fs.rm(imageDirectory, { recursive: true, force: true });
    }
  });

  it('rejects projects without a locked visual direction', async () => {
    await assert.rejects(
      generatePanelImage({ project: { ...project, styleLocked: false }, panel }, { ai: makeAi().ai }),
      /valid locked visual style/
    );
  });
});
