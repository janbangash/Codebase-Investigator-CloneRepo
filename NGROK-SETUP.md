# ngrok Setup for AI Repo Agent

This setup exposes the **frontend only** via ngrok while keeping the backend on localhost.

## Quick Start

### Step 1: Start ngrok for Frontend

```powershell
npx ngrok http 3000
```

Copy the ngrok URL (e.g., `https://enrich-sappiness-aloe.ngrok-free.dev`)

### Step 2: Update Backend CORS

Open `backend/.env` and add the ngrok URL to `ALLOWED_ORIGINS`:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://enrich-sappiness-aloe.ngrok-free.dev
```

### Step 3: Restart Backend

```powershell
cd backend
npm run start:dev
```

### Step 4: Test

Open your ngrok URL in a browser and test:
- Browse repositories ✓
- View files ✓
- AI Chat Search ✓

## How It Works

```
Internet User
     ↓
https://xxxx.ngrok-free.dev (ngrok → localhost:3000)
     ↓
Frontend makes request to /api/*
     ↓
Next.js rewrites /api/* → http://localhost:4000/api/*
     ↓
Backend on localhost:4000 processes request
     ↓
Response returns to user
```

**Key Points:**
- Frontend is exposed to internet via ngrok
- Backend stays on localhost (secure, not exposed)
- Next.js rewrites handle routing API requests locally
- CORS allows requests from the ngrok URL

## What Works

| Feature | Localhost | ngrok |
|---------|-----------|-------|
| Browse UI | ✓ | ✓ |
| View Files | ✓ | ✓ |
| AI Chat SSE | ✓ | ✓ |
| WebSocket (clone progress) | ✓ | ✗ |

**Note:** WebSocket connections for real-time clone progress require a separate backend tunnel. Without it, clone progress updates won't show in real-time when accessed via ngrok.

## Troubleshooting

### AI Chat Not Working on ngrok

1. Make sure backend CORS includes the ngrok URL
2. Restart backend after updating `.env`
3. Check browser console for errors

### CORS Errors

Ensure `backend/.env` has the correct ngrok URL in `ALLOWED_ORIGINS`:
```env
ALLOWED_ORIGINS=...,https://your-url.ngrok-free.dev
```

### WebSocket Not Connecting (Expected)

WebSocket connections to `localhost:4000` won't work via ngrok without a separate backend tunnel. This is a known limitation of the single-tunnel setup.

## Files Modified

- `backend/.env` - Added ngrok URL to `ALLOWED_ORIGINS`
- `frontend/app/page.tsx` - Uses `/api` path for SSE streaming (works through Next.js rewrites)
