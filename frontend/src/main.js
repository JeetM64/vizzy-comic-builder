const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const app = document.querySelector('#app');

const state = {
  projects: [],
  activeProject: null,
  panels: [],
  messages: [],
  options: { visualStyles: [] },
  serviceStatus: { api: false, database: false, aiConfigured: false },
  showProjectForm: false,
  selectedVisualStyle: '',
  busy: false,
  error: null,
  briefDraft: '',
  playbackIndex: -1,
  playing: false,
  playTimer: null,
  playbackInterval: 4000,
  panelCount: 3,
  navigationCollapsed: false
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error('The connection to the Vizzy API was interrupted. Check that the backend is running, then retry.');
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch {
    throw new Error('The API connection closed before its response completed. Check the backend and development proxy logs, then retry.');
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`The Vizzy API returned a non-JSON response (HTTP ${response.status}). Check the backend or development proxy logs.`);
  }
  if (!response.ok) {
    const error = new Error(
      (typeof result?.error === 'string' ? result.error : result?.error?.message) ||
      `Request failed (${response.status}).`
    );
    error.code = response.headers.get('x-error-code') || result?.error?.code;
    error.status = response.status;
    throw error;
  }
  if (result?.success !== true || !Object.prototype.hasOwnProperty.call(result, 'data')) {
    throw new Error('The Vizzy API returned an invalid success response.');
  }
  return result.data;
}

function imageSource(imageUrl) {
  if (typeof imageUrl !== 'string') return '';
  if (/^\/generated\/[a-f0-9-]+\.(png|jpg|webp)$/i.test(imageUrl)) {
    return `${API_BASE}${imageUrl}`;
  }
  try {
    const url = new URL(imageUrl);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'image.pollinations.ai' &&
      url.pathname.startsWith('/prompt/')
    ) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function renderPanelImage(panel, className, alt) {
  const src = imageSource(panel.imageUrl);
  return src
    ? `<div class="artwork-image-shell is-loading">
        <img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />
        <span class="artwork-image-shimmer" aria-hidden="true"></span>
        <span class="artwork-image-error" role="img" aria-label="Illustration unavailable"><i></i><b></b><em></em></span>
      </div>`
    : `<div class="${className} image-unavailable" role="img" aria-label="Comic artwork could not be loaded"></div>`;
}

function renderChatPanel(panel) {
  return `<article class="chat-panel-artwork">
    <div class="chat-panel-image">
      ${renderPanelImage(panel, 'chat-panel-image-element', `Comic panel ${panel.position + 1}: ${panel.title}`)}
      <span class="frame-number">FRAME ${String(panel.position + 1).padStart(2, '0')}</span>
    </div>
    <div class="chat-panel-caption">
      <strong>${escapeHtml(panel.title)}</strong>
      <p>${escapeHtml(panel.narration)}</p>
    </div>
  </article>`;
}

function renderLoadingSkeletons(count, className) {
  return `<div class="${className}" aria-label="Generating panel artwork">
    ${Array.from({ length: count }, (_, index) => `
      <div class="image-skeleton" aria-hidden="true">
        <span class="skeleton-number">FRAME ${String(index + 1).padStart(2, '0')}</span>
        <span class="skeleton-shimmer"></span>
        <div class="skeleton-caption"><i></i><i></i></div>
      </div>`).join('')}
  </div>`;
}

function renderSidebar() {
  return `
    <aside class="sidebar${state.navigationCollapsed ? ' is-collapsed' : ''}">
      <a class="brand" href="#" aria-label="Vizzy home">
        <span class="brand-mark">V</span>
        <span>vizzy<span class="brand-period">.</span></span>
      </a>
      <div class="sidebar-label">YOUR WORKSPACE</div>
      <button class="nav-collapse-button" data-action="toggle-navigation" aria-label="Toggle project navigation">${state.navigationCollapsed ? '›' : '‹'}</button>
      <button class="new-project-button" data-action="new-project">
        <span aria-hidden="true">＋</span> New comic
      </button>
      <div class="project-list">
        ${state.projects.length
          ? state.projects.map((project) => `
            <button class="project-link${state.activeProject?._id === project._id ? ' active' : ''}"
              data-action="select-project" data-project-id="${escapeHtml(project._id)}">
              <span class="project-dot"></span>
              <span class="project-link-copy">
                <strong>${escapeHtml(project.name)}</strong>
                <small>${escapeHtml(state.options.visualStyles.find((style) => style.id === project.visualStyle)?.label || 'Comic')}</small>
              </span>
              <span class="project-chevron">›</span>
            </button>`).join('')
          : '<p class="sidebar-empty">Your next story starts here.</p>'}
      </div>
      <div class="sidebar-footer">
        <span class="status-indicator"></span>
        <span>STUDIO MODE</span>
        <span class="sidebar-version">V 1.0</span>
      </div>
    </aside>`;
}

function renderProjectForm() {
  if (!state.showProjectForm) return '';
  return `
    <div class="modal-backdrop" data-action="backdrop-close">
      <form class="project-modal" id="project-form">
        <div class="project-modal-content">
        <div class="modal-heading">
          <div>
            <span class="eyebrow">A FRESH CANVAS</span>
            <h2>Start a new comic</h2>
          </div>
          <button type="button" class="icon-button" data-action="cancel-project" aria-label="Close">×</button>
        </div>
        <label class="field-label" for="project-name">Project name</label>
        <input id="project-name" name="name" maxlength="120" required placeholder="The midnight library" />
        <label class="field-label" for="project-description">A little context <span>OPTIONAL</span></label>
        <textarea id="project-description" name="description" maxlength="2000" rows="2" placeholder="What is this comic about?"></textarea>
        <label class="field-label" for="palette-notes">Palette &amp; atmosphere <span>OPTIONAL</span></label>
        <input id="palette-notes" name="paletteNotes" maxlength="1000" placeholder="Stormy slate, warm brass, muted sea green…" />
        <label class="field-label" for="character-anchors">Character continuity notes <span>OPTIONAL</span></label>
        <textarea id="character-anchors" name="characterAnchors" maxlength="6000" rows="3"
          placeholder="One character per line: appearance, outfit, defining details…"></textarea>
        <div class="field-row">
          <div class="field-label">Visual language</div>
          <span class="lock-label"><span aria-hidden="true">⌑</span> STYLE LOCKED</span>
        </div>
        <input id="visual-style" name="visualStyle" type="hidden" value="${escapeHtml(state.selectedVisualStyle)}" required />
        <div class="style-option-grid" role="radiogroup" aria-label="Locked visual style">
          ${state.options.visualStyles.map((style) => `
            <button type="button" role="radio" tabindex="${state.selectedVisualStyle === style.id ? '0' : '-1'}"
              aria-checked="${state.selectedVisualStyle === style.id}"
              class="style-option${state.selectedVisualStyle === style.id ? ' selected' : ''}"
              data-action="select-style" data-style-id="${escapeHtml(style.id)}">
              <span class="style-preview style-preview-${escapeHtml(style.id)}" aria-hidden="true">
                <i></i><i></i><i></i><b></b>
              </span>
              <span class="style-option-copy"><strong>${escapeHtml(style.label)}</strong><small>${escapeHtml(style.description)}</small></span>
              <span class="style-check" aria-hidden="true">✓</span>
            </button>
          `).join('')}
        </div>
        <p class="field-hint">This look stays consistent across every panel in this project.</p>
        </div>
        <div class="project-modal-actions">
          <button class="primary-button modal-submit" type="submit">Create project <span>→</span></button>
        </div>
      </form>
    </div>`;
}

function renderConversation() {
  const project = state.activeProject;
  if (!project) {
    return `
      <section class="welcome-panel">
        <span class="eyebrow">YOUR COMIC STUDIO</span>
        <h1>Every great story<br /><span>starts with a frame.</span></h1>
        <p>Shape your idea into a visual story. Set the mood, lock your art direction, and build a storyboard worth sharing.</p>
        <button class="primary-button" data-action="new-project">Create your first comic <span>→</span></button>
        <div class="welcome-footnote"><span class="status-indicator"></span> YOUR CREATIVE SPACE IS READY</div>
      </section>`;
  }

  const style = state.options.visualStyles.find((option) => option.id === project.visualStyle);
  return `
    <section class="conversation-panel">
      <div class="section-heading">
        <div>
          <span class="eyebrow">THE STORY ROOM</span>
          <h2>Let’s build your story<span class="accent-dot">.</span></h2>
        </div>
        <span class="mobile-style-lock"><span>⌑</span> ${escapeHtml(style?.label || 'Style locked')}</span>
      </div>
      <div class="chat-scroll" id="chat-scroll">
        ${state.messages.length
          ? state.messages.map((message) => {
            const messagePanels = (message.panelIds?.length
              ? message.panelIds.map((panelId) => state.panels.find((item) => String(item._id) === String(panelId)))
              : [message.panelId && state.panels.find((item) => String(item._id) === String(message.panelId))]).filter(Boolean);
            return `
            <article class="chat-message ${message.role === 'assistant' ? 'assistant-message' : 'user-message'}">
              <span class="message-avatar">${message.role === 'assistant' ? 'V' : 'Y'}</span>
              <div>
                <div class="message-author">${message.role === 'assistant' ? 'VIZZY' : 'YOU'}</div>
                <p>${escapeHtml(message.content)}</p>
                ${messagePanels.map(renderChatPanel).join('')}
              </div>
            </article>`;
          }).join('')
          : `
            <article class="chat-message assistant-message">
              <span class="message-avatar">V</span>
              <div>
                <div class="message-author">VIZZY</div>
                <p>Your visual direction is locked. Describe a scene or story beat and I’ll turn it into a short, ordered sequence of illustrated frames.</p>
              </div>
            </article>`}
        ${state.busy ? `
          <article class="chat-message assistant-message">
            <span class="message-avatar">V</span>
            <div><div class="message-author">VIZZY</div><p class="thinking"><i></i><i></i><i></i><span>Illustrating your next panel…</span></p></div>
          </article>` : ''}
        ${state.busy ? renderLoadingSkeletons(1, 'chat-image-grid skeleton-grid') : ''}
      </div>
      ${state.error ? `
        <div class="notice error-notice" role="alert">
          <span class="notice-icon">!</span>
          <div><strong>${state.error.code === 'AI_PROVIDER_NOT_CONFIGURED' ? 'Generation is not configured yet' : 'We couldn’t finish that'}</strong>
            <p>${escapeHtml(state.error.message)}</p>
            ${state.error.code === 'AI_PROVIDER_NOT_CONFIGURED' ? '<small>Add AI_API_KEY and AI_MODEL to the backend .env, then restart the API.</small>' : ''}
          </div>
          <button class="icon-button" data-action="dismiss-error" aria-label="Dismiss">×</button>
        </div>` : ''}
      <form class="composer" id="story-form">
        <label class="sr-only" for="story-brief">Describe your comic scene or story</label>
        <textarea id="story-brief" name="brief" maxlength="5000" rows="3" required
        placeholder="What happens next? Describe the next moment…">${escapeHtml(state.briefDraft)}</textarea>
        <div class="composer-footer">
        <div class="option-controls">
          <label class="locked-style"><span>✦</span> ${escapeHtml(style?.label || 'STYLE LOCKED')}</label>
          <label class="panel-count-control">FRAMES <select name="panelCount" aria-label="Number of frames">${[3,4,5,6].map((count) => `<option value="${count}" ${state.panelCount === count ? 'selected' : ''}>${count}</option>`).join('')}</select></label>
        </div>
        <button class="send-button" type="submit" ${state.busy ? 'disabled' : ''}>
          ${state.busy ? '<span class="send-spinner"></span>' : '<span>Add panel</span><span class="send-arrow">↗</span>'}
        </button>
        </div>
        <div class="composer-caption">ONE PROMPT · ${state.panelCount} CONNECTED STORY FRAMES</div>
      </form>
    </section>`;
}

function renderStoryboard() {
  const project = state.activeProject;
  const orderedPanels = [...state.panels].sort((left, right) => left.position - right.position);
  const panels = orderedPanels;
  const hasPanels = panels.length > 0;
  return `
    <section class="storyboard-panel">
      <div class="storyboard-heading">
        <div>
          <span class="eyebrow">THE STORYBOARD</span>
          <h2>${project ? escapeHtml(project.name) : 'Your frames, in focus'}</h2>
        </div>
        <div class="storyboard-actions">
          <button class="tool-button" data-action="play" ${hasPanels ? '' : 'disabled'} title="Play slideshow"><span>▶</span> Preview</button>
          <button class="tool-button export-button" data-action="export" ${hasPanels ? '' : 'disabled'} title="Export storyboard JSON"><span>↧</span> Export</button>
          <button class="icon-button print-button" data-action="print" ${hasPanels ? '' : 'disabled'} title="Print or save as PDF">PDF</button>
          <button class="tool-button" data-action="export-png" ${hasPanels ? '' : 'disabled'} title="Download high-resolution PNG grid">PNG</button>
        </div>
      </div>
      ${project ? `
        <div class="storyboard-meta">
          <span class="meta-lock">⌑ STYLE LOCKED</span>
          <span class="meta-divider"></span>
            <span>${!panels.length ? 'NO FRAMES YET' : `${panels.length} SEQUENTIAL FRAMES`}</span>
        </div>` : ''}
      <div class="frame-grid${panels.length || state.busy ? '' : ' frame-grid-empty'}">
        ${panels.length ? `${panels.map((panel, index) => `
          <article class="frame-card">
            <div class="frame-image-container">
              ${renderPanelImage(panel, 'frame-image', `Frame ${panel.position + 1}: ${panel.title}`)}
              <span class="frame-number">FRAME ${String(panel.position + 1).padStart(2, '0')}</span>
              <span class="image-provider-badge">FLUX · FRAME ${String(panel.panelNumber || panel.position + 1).padStart(2, '0')}</span>
            </div>
            <div class="frame-copy">
              <div class="frame-title-row">
                <h3>${escapeHtml(panel.title)}</h3>
                <div class="frame-reorder-controls">
                  <button type="button" class="icon-button" data-action="reorder-panel" data-panel-id="${escapeHtml(panel._id)}" data-direction="up" aria-label="Move frame ${panel.position + 1} earlier" ${panel.position === 0 ? 'disabled' : ''}>↑</button>
                  <button type="button" class="icon-button" data-action="reorder-panel" data-panel-id="${escapeHtml(panel._id)}" data-direction="down" aria-label="Move frame ${panel.position + 1} later" ${panel.position >= orderedPanels.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
              </div>
              <p>${escapeHtml(panel.narration)}</p>
              <details class="frame-prompt">
                <summary>View illustration prompt</summary>
                <p>${escapeHtml(panel.visualPrompt)}</p>
              </details>
            </div>
          </article>`).join('')}          ${state.busy ? renderLoadingSkeletons(1, 'frame-skeleton-grid') : ''}` : state.busy
          ? renderLoadingSkeletons(1, 'frame-skeleton-grid')
          : `
          <div class="empty-storyboard">
            <div class="empty-orbit"><span>V</span><i></i><b></b></div>
            <span class="eyebrow">A NEW STORY IS WAITING</span>
            <h3>${project ? 'Your first page begins with a prompt.' : 'A blank page. Infinite directions.'}</h3>
            <p>${project ? 'Describe the moment you want to bring to life. Vizzy will shape it into a sequence of comic frames.' : 'Choose a visual language and build a graphic novel one cinematic beat at a time.'}</p>
            ${!project ? '<button class="primary-button" data-action="new-project">Set up your canvas <span>↗</span></button>' : '<span class="empty-lock">⌑ ART DIRECTION LOCKED · READY TO DRAW</span>'}
          </div>`}
      </div>
      <div class="storyboard-footer"><span>MADE IN VIZZY</span><span>YOUR STORY, FRAME BY FRAME</span></div>
    </section>`;
}

function renderDock() {
  const project = state.activeProject;
  const style = state.options.visualStyles.find((option) => option.id === project?.visualStyle);
  const recentMessages = state.messages.slice(-6);
  return `<section class="command-dock" aria-label="Story chat and prompt command bar">
    <div class="dock-transcript" id="chat-scroll">
      ${project ? (recentMessages.length ? recentMessages.map((message) => `<article class="dock-message ${message.role === 'assistant' ? 'from-vizzy' : 'from-author'}"><span>${message.role === 'assistant' ? 'V' : 'YOU'}</span><p>${escapeHtml(message.content)}</p></article>`).join('') : '<div class="dock-welcome"><span class="dock-vizzy-mark">V</span><p>Canvas is ready. Describe a scene, a reveal, or a feeling you want the next page to hold.</p></div>') : '<div class="dock-welcome"><span class="dock-vizzy-mark">V</span><p>Create a story canvas to lock the visual language and begin prompting.</p><button class="text-action" data-action="new-project">Set art direction <span>↗</span></button></div>'}
      ${state.error ? `<div class="dock-error" role="alert"><span>${escapeHtml(state.error.message)}</span><button data-action="dismiss-error" aria-label="Dismiss error">×</button></div>` : ''}
      ${state.busy ? '<div class="dock-generating"><i></i><i></i><i></i><span>Building a connected visual sequence…</span></div>' : ''}
    </div>
    <form class="command-composer" id="story-form">
      <label class="sr-only" for="story-brief">Describe your next visual story sequence</label>
      <textarea id="story-brief" name="brief" maxlength="5000" rows="1" required ${project ? '' : 'disabled'} placeholder="${project ? 'Describe the next story beat, scene, or complete sequence…' : 'Create a canvas to start writing…'}">${escapeHtml(state.briefDraft)}</textarea>
      <div class="dock-bottom-row">
        <div class="dock-pills">
          <span class="dock-pill locked-pill"><i>✦</i>${escapeHtml(style?.label || 'STYLE LOCK')}</span>
          <span class="dock-pill palette-pill"><i>◉</i>${escapeHtml(project?.paletteNotes || 'Palette follows art direction')}</span>
          <label class="dock-pill count-pill"><i>▦</i><span>FRAMES</span><select name="panelCount" aria-label="Number of frames">${[3,4,5,6].map((count) => `<option value="${count}" ${state.panelCount === count ? 'selected' : ''}>${count}</option>`).join('')}</select></label>
        </div>
        <button class="dock-send" type="submit" ${state.busy || !project ? 'disabled' : ''} aria-label="Generate story frames">${state.busy ? '<span class="send-spinner"></span>' : 'Generate sequence <span>↗</span>'}</button>
      </div>
    </form>
  </section>`;
}

function renderPlayback() {
  if (state.playbackIndex < 0) return '';
  const panels = [...state.panels].sort((left, right) => left.position - right.position);
  const panel = panels[state.playbackIndex];
  if (!panel) return '';
  return `
    <div class="playback-backdrop cinema-mode">
      <section class="playback-modal cinema-modal" role="dialog" aria-modal="true" aria-label="Storyboard slideshow">
        <div class="playback-topline">
          <span class="eyebrow">CINEMA PREVIEW · ${String(state.playbackIndex + 1).padStart(2, '0')} / ${String(panels.length).padStart(2, '0')}</span>
          <div class="cinema-header-controls">
            <label class="cinema-speed-control">SPEED
              <select data-action="playback-speed" aria-label="Slideshow frame duration">
                <option value="2000" ${state.playbackInterval === 2000 ? 'selected' : ''}>2 sec</option>
                <option value="4000" ${state.playbackInterval === 4000 ? 'selected' : ''}>4 sec</option>
                <option value="6000" ${state.playbackInterval === 6000 ? 'selected' : ''}>6 sec</option>
              </select>
            </label>
            <button class="icon-button" data-action="fullscreen" aria-label="Toggle full screen">⛶</button>
            <button class="icon-button" data-action="close-playback" aria-label="Close preview">×</button>
          </div>
        </div>
        <div class="cinema-art">
          ${renderPanelImage(panel, 'cinema-image', `Frame ${state.playbackIndex + 1}: ${panel.title}`)}
          <span class="cinema-frame-badge">FRAME ${String(state.playbackIndex + 1).padStart(2, '0')}</span>
        </div>
        <div class="playback-copy"><span class="eyebrow">${state.playing ? 'NOW PLAYING · AUTO LOOP' : 'PAUSED'}</span><h2>${escapeHtml(panel.title)}</h2><p>${escapeHtml(panel.narration)}</p></div>
        <div class="playback-controls">
          <button class="tool-button" data-action="previous-slide">← Previous</button>
          <button class="primary-button playback-toggle" data-action="toggle-play">${state.playing ? 'Ⅱ Pause' : '▶ Play'}</button>
          <button class="tool-button" data-action="next-slide">Next →</button>
        </div>
        <div class="cinema-scrub">
          <input type="range" min="0" max="${panels.length - 1}" value="${state.playbackIndex}"
            data-action="scrub-slide" aria-label="Choose slideshow frame" />
          <span>${String(state.playbackIndex + 1).padStart(2, '0')} / ${String(panels.length).padStart(2, '0')}</span>
        </div>
      </section>
    </div>`;
}

function render() {
  app.innerHTML = `
    <div class="studio-shell canvas-studio">
      ${renderSidebar()}
      <main class="studio-main">
        <header class="topbar">
          <div class="breadcrumb"><span>VIZZY</span><span class="breadcrumb-slash">/</span><strong>${state.activeProject ? escapeHtml(state.activeProject.name) : 'THE STORY CANVAS'}</strong></div>
          <div class="topbar-right">
            <div class="service-indicators" aria-label="Service status">
              <span class="service-indicator ${state.serviceStatus.api ? 'online' : 'offline'}"><i></i> API</span>
              <span class="service-indicator ${state.serviceStatus.database ? 'online' : 'offline'}"><i></i> DATABASE</span>
              <span class="service-indicator ${state.serviceStatus.aiConfigured ? 'online' : 'offline'}"><i></i> AI ${state.serviceStatus.aiConfigured ? 'READY' : 'SETUP'}</span>
            </div>
            <button class="tool-button reset-button" data-action="reset-studio" title="Clear all projects, frames, chat and generated image files">Reset studio</button>
          </div>
        </header>
        <div class="canvas-scroll-area">
          ${renderStoryboard()}
        </div>
        ${renderDock()}
      </main>
    </div>
    ${renderProjectForm()}
    ${renderPlayback()}`;
  app.querySelectorAll('.artwork-image-shell img').forEach((image) => {
    const shell = image.closest('.artwork-image-shell');
    const setLoaded = () => shell.classList.remove('is-loading');
    const setFailed = () => {
      shell.classList.remove('is-loading');
      shell.classList.add('is-failed');
    };
    image.addEventListener('load', setLoaded, { once: true });
    image.addEventListener('error', () => {
      if (!image.dataset.retried && image.src.includes('image.pollinations.ai')) {
        image.dataset.retried = 'true';
        const retryUrl = new URL(image.src);
        retryUrl.searchParams.set('seed', String(Math.floor(Math.random() * 999999)));
        image.src = retryUrl.href;
        image.addEventListener('error', setFailed, { once: true });
      } else setFailed();
    }, { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) setLoaded();
      else setFailed();
    }
  });
}

async function loadProjects() {
  state.projects = await api('/api/projects');
  if (state.activeProject) {
    const current = state.projects.find((project) => project._id === state.activeProject._id);
    if (current) state.activeProject = current;
  }
}

async function loadServiceStatus() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) throw new Error('Health check failed.');
    const envelope = await response.json();
    if (envelope.success !== true || !envelope.data) throw new Error('Invalid health response.');
    const status = envelope.data;
    state.serviceStatus = {
      api: status.status === 'ok',
      database: status.database === true,
      aiConfigured: status.aiConfigured === true
    };
  } catch {
    state.serviceStatus = { api: false, database: false, aiConfigured: false };
  }
}

async function loadProjectData(project) {
  stopPlayback();
  state.playbackIndex = -1;
  state.activeProject = project;
  state.error = null;
  state.panels = [];
  state.messages = [];
  const [panels, messages] = await Promise.all([
    api(`/api/panels?projectId=${encodeURIComponent(project._id)}`),
    api(`/api/chat-histories?projectId=${encodeURIComponent(project._id)}`)
  ]);
  state.panels = panels;
  state.messages = messages;
}

function stopPlayback() {
  if (state.playTimer) window.clearInterval(state.playTimer);
  state.playTimer = null;
  state.playing = false;
}

function startPlayback() {
  if (state.playTimer) window.clearInterval(state.playTimer);
  state.playing = true;
  state.playTimer = window.setInterval(() => {
    const count = state.panels.length;
    if (!count) {
      stopPlayback();
      state.playbackIndex = -1;
      render();
      return;
    }
    state.playbackIndex = (state.playbackIndex + 1) % count;
    render();
  }, state.playbackInterval);
}

function advanceSlide(delta) {
  const count = state.panels.length;
  if (!count) return;
  state.playbackIndex = (state.playbackIndex + delta + count) % count;
  render();
}

function exportStoryboard() {
  const payload = {
    project: state.activeProject,
    panels: [...state.panels].sort((left, right) => left.position - right.position)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(state.activeProject?.name || 'vizzy-storyboard').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportStoryboardPng() {
  const panels = [...state.panels].sort((left, right) => left.position - right.position);
  const columns = Math.min(3, panels.length);
  const cellSize = 1024;
  const gap = 32;
  const headerHeight = 150;
  const rows = Math.ceil(panels.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellSize + (columns + 1) * gap;
  canvas.height = headerHeight + rows * cellSize + (rows + 1) * gap;
  const context = canvas.getContext('2d');
  context.fillStyle = '#0d0f12';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f3f1ee';
  context.font = '600 32px Inter, sans-serif';
  context.fillText(state.activeProject?.name || 'Vizzy storyboard', gap, 60);
  context.fillStyle = '#9ba4b1';
  context.font = '16px Inter, sans-serif';
  context.fillText(`${panels.length} sequential frames · generated in Vizzy`, gap, 92);

  const images = await Promise.all(panels.map((panel) => new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Frame ${panel.position + 1} could not be loaded for PNG export.`));
    image.src = imageSource(panel.imageUrl);
  })));
  images.forEach((image, index) => {
    const x = gap + (index % columns) * (cellSize + gap);
    const y = headerHeight + gap + Math.floor(index / columns) * (cellSize + gap);
    context.drawImage(image, x, y, cellSize, cellSize);
    context.fillStyle = '#e8eef7';
    context.font = '600 18px Inter, sans-serif';
    context.fillText(`FRAME ${String(panels[index].position + 1).padStart(2, '0')} · ${panels[index].title}`, x, y + cellSize + 24);
  });

  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => {
    if (value) resolve(value);
    else reject(new Error('Could not encode the storyboard PNG.'));
  }, 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(state.activeProject?.name || 'vizzy-storyboard').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'select-style') {
    state.selectedVisualStyle = button.dataset.styleId;
    const field = document.querySelector('#visual-style');
    if (field) field.value = state.selectedVisualStyle;
    document.querySelectorAll('.style-option').forEach((option) => {
      const isSelected = option.dataset.styleId === state.selectedVisualStyle;
      option.classList.toggle('selected', isSelected);
      option.setAttribute('aria-checked', String(isSelected));
      option.tabIndex = isSelected ? 0 : -1;
    });
  } else if (action === 'new-project') {
    state.showProjectForm = true;
    state.error = null;
    state.selectedVisualStyle = state.options.visualStyles[0]?.id || '';
    render();
    document.querySelector('#project-name')?.focus();
  } else if (action === 'toggle-navigation') {
    state.navigationCollapsed = !state.navigationCollapsed;
    render();
  } else if (action === 'reset-studio') {
    if (!window.confirm('Reset Vizzy completely? This permanently deletes every project, panel, chat message, and generated image file.')) return;
    button.disabled = true;
    try {
      await api('/api/projects/reset-all', { method: 'DELETE' });
      stopPlayback();
      state.activeProject = null;
      state.panels = [];
      state.messages = [];
      state.projects = [];
      state.playbackIndex = -1;
      state.error = null;
      await loadProjects();
    } catch (error) {
      state.error = error;
    }
    render();
  } else if (action === 'cancel-project' || (action === 'backdrop-close' && event.target === button)) {
    state.showProjectForm = false;
    render();
  } else if (action === 'select-project') {
    try {
      const project = state.projects.find((item) => item._id === button.dataset.projectId);
      if (project) {
        state.briefDraft = '';
        await loadProjectData(project);
      }
    } catch (error) {
      state.error = error;
    }
    render();
  } else if (action === 'dismiss-error') {
    state.error = null;
    render();
  } else if (action === 'reorder-panel') {
    if (state.busy || !state.activeProject) return;
    state.busy = true;
    state.error = null;
    const panelId = button.dataset.panelId;
    const direction = button.dataset.direction;
    render();
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject._id)}/panels/reorder`, {
        method: 'POST',
        body: JSON.stringify({ panelId, direction })
      });
      await loadProjectData(state.activeProject);
    } catch (error) {
      state.error = error;
    } finally {
      state.busy = false;
      render();
    }
  } else if (action === 'play') {
    state.playbackIndex = 0;
    startPlayback();
    render();
  } else if (action === 'close-playback') {
    stopPlayback();
    state.playbackIndex = -1;
    render();
  } else if (action === 'previous-slide') {
    advanceSlide(-1);
  } else if (action === 'next-slide') {
    advanceSlide(1);
  } else if (action === 'toggle-play') {
    if (state.playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
    render();
  } else if (action === 'export') {
    exportStoryboard();
  } else if (action === 'print') {
    window.print();
  } else if (action === 'export-png') {
    try {
      await exportStoryboardPng();
      state.error = null;
    } catch (error) {
      state.error = error;
      render();
    }
  } else if (action === 'fullscreen') {
    const player = document.querySelector('.cinema-modal');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player?.requestFullscreen) await player.requestFullscreen();
    } catch (error) {
      state.error = new Error(`Could not enter full-screen mode: ${error.message}`);
      render();
    }
  }
});

app.addEventListener('change', (event) => {
  if (event.target.matches('[name="panelCount"]')) {
    state.panelCount = Number(event.target.value);
    const caption = document.querySelector('.composer-caption');
    if (caption) caption.textContent = `ONE PROMPT · ${state.panelCount} CONNECTED STORY FRAMES`;
  } else if (event.target.matches('[data-action="playback-speed"]')) {
    state.playbackInterval = Number(event.target.value);
    if (state.playing) startPlayback();
  } else if (event.target.matches('[data-action="scrub-slide"]')) {
    state.playbackIndex = Number(event.target.value);
    render();
  }
});

app.addEventListener('keydown', (event) => {
  if (!event.target.matches('.style-option') || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const options = [...document.querySelectorAll('.style-option')];
  const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
  const currentIndex = options.indexOf(event.target);
  const nextOption = options[(currentIndex + direction + options.length) % options.length];
  nextOption.focus();
  nextOption.click();
});

app.addEventListener('submit', async (event) => {
  if (event.target.id === 'project-form') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      const project = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify(values)
      });
      state.projects.unshift(project);
      state.showProjectForm = false;
      state.panels = [];
      state.messages = [];
      state.activeProject = project;
      state.briefDraft = '';
      state.error = null;
    } catch (error) {
      state.error = error;
    }
    render();
  }

  if (event.target.id === 'story-form') {
    event.preventDefault();
    if (state.busy || !state.activeProject) return;
    const values = Object.fromEntries(new FormData(event.target));
    state.briefDraft = values.brief;
    state.busy = true;
    state.error = null;
    render();
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject._id)}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          brief: values.brief,
          panelCount: Number(values.panelCount || state.panelCount)
        })
      });
      state.briefDraft = '';
      await loadProjectData(state.activeProject);
      state.error = null;
    } catch (error) {
      state.error = error;
    } finally {
      state.busy = false;
      render();
      const chatScroll = document.querySelector('#chat-scroll');
      if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
    }
  }

});

async function initialize() {
  render();
  try {
    const [options] = await Promise.all([
      api('/api/options'),
      loadProjects(),
      loadServiceStatus()
    ]);
    state.options = options;
    state.activeProject = null;
  } catch (error) {
    error.status = 0;
    state.error = error;
  }
  render();
}

initialize();
