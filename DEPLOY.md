# Deploy: Railway (API) + Vercel (UI)

## 1. Backend — Railway

1. Push this repo to GitHub (or connect the repo in Railway).
2. **New project → Deploy from repo → set root directory to `backend`** (important for a monorepo).
3. **Variables** (same names as your local `.env`):

   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `GEMINI_API_KEY`
   - Optional: `GEMINI_MODEL`
   - Railway sets `PORT` automatically — do not hardcode it.

4. Deploy. Copy the **public HTTPS URL** (e.g. `https://daily-standup-production.up.railway.app`).

5. **Register Telegram webhook** to point at Railway (not ngrok):

   - In your **local** project root `.env`, set  
     `PUBLIC_WEBHOOK_URL=https://YOUR-RAILWAY-URL`  
     (no path, no trailing slash).
   - Run:  
     `npm run register-webhook --workspace=backend`

6. **State file:** `state.json` lives on the container disk. It can **reset on redeploy** unless you add a Railway **volume** and mount it where `backend/state.json` is written. For a hackathon, ephemeral state is often fine.

## 2. Frontend — Vercel

1. **New project → import repo → set root directory to `frontend`** (Framework: Vite).
2. **Environment variable** (Production):

   - `VITE_API_URL` = your Railway URL, e.g. `https://YOUR-RAILWAY-URL.up.railway.app`  
     (no trailing slash)

3. Deploy. Open the Vercel URL; the app will call `VITE_API_URL` for `/api/state` and `/api/telegram-status`.

## 3. CORS

The API uses permissive CORS so the Vercel origin can call Railway. If you lock this down later, restrict `cors()` to your Vercel domain.

## 4. Local dev (unchanged)

- Backend: `npm run dev --workspace=backend`
- Frontend: `npm run dev --workspace=frontend`
- Do **not** set `VITE_API_URL` locally so `/api` is proxied to port 3001.
