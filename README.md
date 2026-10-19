# Vizzy

Vizzy is a chat-first graphic novel and storyboard studio with an Express/Mongoose API and a Vite frontend. Lock an art direction, set palette and story context, then turn each chat prompt into an ordered sequence of 3–6 illustrated frames. Preview the full sequence as a looping slideshow or export JSON, PNG, and print-ready pages.

## Requirements and setup

- Node.js 20 or newer
- MongoDB
- Gemini API credentials for AI-assisted story dialogue (optional; the scene itself is used directly if Gemini is unavailable)
- Google Gemini 2.5 Flash Image (Nano Banana) generates comic artwork

From the repository root:

1. Run `npm install`.
2. Copy `.env.example` to `.env` (or place a local environment file at `backend/.env`).
3. Set `MONGODB_URI` when MongoDB is not using the local default. If it is absent, Vizzy connects to `mongodb://127.0.0.1:27017/vizzy_db`. Add `?authSource=admin` (or the database where your MongoDB user was created) when needed; Vizzy preserves and passes that setting to Mongoose. MongoDB credentials containing reserved characters must be percent-encoded in the URI; the backend normalizes raw username/password characters such as `@` without logging the URI. Invalid MongoDB URLs produce a clear startup error.
4. Set `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` to enable Gemini narrative dialogue through its OpenAI-compatible API. The template uses `https://generativelanguage.googleapis.com/v1beta/openai/` and `gemini-2.5-flash`.
5. Set `GEMINI_API_KEY` to enable image generation with Google's Gemini 2.5 Flash Image model. Keep the key in the backend `.env` file; do not expose it in frontend variables.
6. Optional: set `POLLINATIONS_API_KEY` to enable the image fallback when Gemini is unavailable or out of quota. Create a server-side key at Pollinations; the fallback uses its current `gen.pollinations.ai` Flux endpoint and sends the key only from the backend. Without this key, image generation still works while Gemini is available, but a Gemini outage/quota error will return a clear configuration error.
7. Run `npm run dev`, then open the Vite URL shown in the terminal (typically `http://localhost:5173`).

The API listens on `PORT` (default `4000`). The Vite development server proxies API requests to `localhost:4000`; in production, serve the frontend and proxy `/api` to the backend on the same origin. Never place provider credentials in frontend variables or commit `.env`.

The OpenAI-compatible SDK uses the configured Gemini endpoint to produce structured, sequential story beats with subject-focused illustration prompts. Each frame inherits the locked style, palette notes, story context, and character-continuity notes. Gemini 2.5 Flash Image creates each frame at 16:9. The backend extracts inline image data, validates and writes the actual PNG, JPEG, or WebP bytes to generated assets, and returns static image URLs in the standard JSON response. It does not store large base64 image payloads in MongoDB. If image generation fails, Vizzy returns a structured JSON error instead of persisting placeholder artwork. At startup, Vizzy silently removes exact-name test projects, orphaned/broken panels, chat records for deleted projects, and unreferenced generated image files. If Gemini narrative generation is unavailable or rate-limited, Vizzy still creates a direct 3–6 frame sequence from the story brief.

## API overview

Successful JSON endpoints return `{ "success": true, "data": ... }`; errors return `{ "success": false, "error": { "message": "...", "code": "..." } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API liveness check |
| `GET`, `POST` | `/api/projects` | List or create projects |
| `DELETE` | `/api/projects/reset-all` | Delete every project, panel, chat message, and generated image file |
| `GET`, `PATCH` | `/api/projects/:id` | Read or update project context, palette notes, name, or status |
| `POST` | `/api/projects/:id/generate` | Generate 3–6 frames from `{ brief, panelCount }` (optional `tone`; response includes `data.frames`; `panelCount` defaults to 3) |
| `POST` | `/api/projects/:id/panels/reorder` | Reorder adjacent frames using `{ panelId, direction: "up" \| "down" }` |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/panels` and `/api/panels/:id` | Manage panels; list can be filtered with `?projectId=<id>` |
| `GET` | `/api/chat-histories?projectId=<id>` | Read conversation history for a project |
| `GET` | `/api/options` | List supported locked art directions |

New projects receive a locked visual style and may include palette notes and up to 12 character continuity notes. Generated panels and their chat turn are linked in both the conversation and storyboard. The cinema player supports 2, 4, and 6 second playback, scrubbing, pause/play, fullscreen, JSON export, PNG export, and print-to-PDF.

## Scripts

- `npm run dev` — start the API and frontend in development mode.
- `npm run build` — build the frontend production assets.
- `npm test` — run focused backend API, provider, and model tests.
