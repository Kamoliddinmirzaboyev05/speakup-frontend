# SpeakUp — Mini App (frontend)

React + Vite + Tailwind Telegram Mini App for the SpeakUp speaking-practice bot.
It talks to the FastAPI backend in `../backend`. **No mock data** — every screen
(profile, recent sessions, leaderboard) is loaded live from the API and
authenticated with the Telegram WebApp `initData` signature.

## How it connects to the backend
- `src/app/api.ts` is the API client. Every request sends
  `Authorization: tma <initData>`; the backend validates the HMAC.
- Base URL = `VITE_API_URL` (prod) or empty + Vite dev proxy → `http://localhost:8000` (dev).
- Screens → endpoints:
  - Speaking top bar + Profile → `GET /api/users/me`
  - Recent Sessions → `GET /api/sessions/history`
  - Tap mic → `POST /api/sessions/start` (live Call screen) → `POST /api/sessions/end`
  - Leaderboard → `GET /api/leaderboard`
  - Invite link is built from `VITE_BOT_USERNAME` + your `telegram_id`.

Onboarding (level/goal/challenge/…) happens in the **bot**, not here. The Mini App
expects an already-onboarded user. If `initData` is missing/invalid (e.g. opened
outside Telegram) it shows an error screen instead of fake data.

## Setup
```bash
cp .env.example .env        # set VITE_BOT_USERNAME; leave VITE_API_URL empty for dev
pnpm install
pnpm dev                    # http://localhost:5173, /api proxied to :8000
```
Start the backend first (`cd ../backend && docker compose up`).

## Build / deploy
```bash
pnpm build                  # -> dist/
```
Host `dist/` over HTTPS, set `VITE_API_URL` to your API origin at build time, and
point the bot's `MINIAPP_URL` at the hosted URL.

## Notes
- `pnpm-workspace.yaml` lists both `linux` and `darwin` so native binaries
  (rollup/esbuild) install on macOS dev machines and Linux CI/containers.
- `index.html` loads `telegram-web-app.js` so `window.Telegram.WebApp` is available.
