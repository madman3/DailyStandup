# Deploy: Fly.io (API) + Vercel (UI)

## 1. Backend — Fly.io

1. **Deploy** from the repo root:

   ```bash
   npm run fly:deploy --workspace=backend
   ```

2. **Secrets** (set via `fly secrets set …`):

   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `GEMINI_API_KEY`
   - `USER_TIMEZONE` (e.g. `America/Los_Angeles`)
   - `DATABASE_URL` (Supabase pooler URL with `sslmode=require`)
   - Optional: `GEMINI_MODEL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`, `GOOGLE_SERVICE_ACCOUNT_JSON_B64`

3. `PORT=3001` is set in `fly.toml [env]` — no need to add it as a secret.

4. **Register Telegram webhook** (once, after first deploy):

   ```bash
   npm run fly:set-webhook --workspace=backend
   ```

   Or locally:

   ```bash
   PUBLIC_WEBHOOK_URL=https://<your-app>.fly.dev npm run register-webhook --workspace=backend
   ```

## 2. Frontend — Vercel

1. **New project → import repo → set root directory to `frontend`** (Framework: Vite).
2. **Environment variable** (Production):

   - `VITE_API_URL` = `https://<your-app>.fly.dev` (no trailing slash)

3. Deploy. Open the Vercel URL; the app will call `VITE_API_URL` for `/api/state` and `/api/telegram-status`.

## 3. CORS

The API uses permissive CORS so the Vercel origin can call Fly. If you lock this down later, restrict `cors()` to your Vercel domain.

## 4. Local dev (unchanged)

- Backend: `npm run dev --workspace=backend`
- Frontend: `npm run dev --workspace=frontend`
- Do **not** set `VITE_API_URL` locally so `/api` is proxied to port 3001.
