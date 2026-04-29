# Frontend on ngrok Only (Backend on Localhost)

This setup exposes only the frontend via ngrok while keeping the backend secure on localhost.

**Note:** For WebSocket and SSE streaming to work, you also need to run a localtunnel for the backend.

## Quick Start

### Step 1: Start Frontend with ngrok

```powershell
.\start-ngrok-frontend.ps1
```

This will:
1. Start the frontend dev server (if not running)
2. Open ngrok tunnel for port 3000

### Step 2: Start Backend localtunnel (for WebSocket/SSE)

```powershell
.\start-localtunnel-backend.ps1
```

Wait for the localtunnel URL to appear:
```
your url is: https://xxxx.loca.lt
```

### Step 3: Copy the URLs

- ngrok URL (frontend): `https://xxxx.ngrok-free.dev`
- localtunnel URL (backend): `https://xxxx.loca.lt`

### Step 4: Update Configuration Files

**frontend/.env.local:**
```env
NEXT_PUBLIC_BACKEND_URL=https://xxxx.loca.lt
```

**backend/.env:**
```env
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://xxxx.ngrok-free.dev,https://xxxx.loca.lt
```

### Step 5: Restart Backend

If the backend is already running, restart it:

```powershell
cd backend
npm run start:dev
```

### Step 6: Test

Open your ngrok URL in a browser:
```
https://xxxx.ngrok-free.dev
```

## How It Works

### Regular API Requests (REST)
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

### WebSocket & SSE Streaming
```
Internet User
     ↓
https://xxxx.loca.lt (localtunnel → localhost:4000)
     ↓
Direct connection to backend WebSocket/SSE endpoints
     ↓
Backend on localhost:4000 handles real-time connection
```

**Key Points:**
- Frontend (HTTP/REST) is exposed via ngrok
- Backend WebSocket/SSE is exposed via localtunnel
- Next.js rewrites handle REST API routing
- CORS allows requests from both ngrok and localtunnel URLs

## Troubleshooting

### CORS Errors in Browser Console

Make sure you:
1. Updated `backend/.env` with the correct ngrok URL
2. Restarted the backend after updating `.env`
3. The ngrok URL matches exactly (including `https://`)

### "Failed to Fetch" Errors

Check:
1. Backend is running on port 4000
2. Next.js rewrites are working (check `frontend/next.config.ts`)
3. No firewall blocking localhost connections

### ngrok URL Changes After Restart

ngrok free tier gives random URLs each session. If the URL changes:
1. Copy the new URL
2. Update `backend/.env` with new URL
3. Restart backend

## Files Modified

- `start-ngrok-frontend.ps1` - Script to start frontend + ngrok
- `start-localtunnel-backend.ps1` - Script to start backend localtunnel
- `frontend/.env.local` - Added `NEXT_PUBLIC_BACKEND_URL` for WebSocket/SSE
- `frontend/next.config.ts` - Added `allowedDevOrigins` for ngrok domain
- `frontend/app/page.tsx` - Uses direct backend URL for SSE streaming
- `backend/.env` - Added ngrok and localtunnel URLs to `ALLOWED_ORIGINS`

## Security Notes

- Anyone with the ngrok URL can access your frontend
- Backend is NOT exposed to internet (only accessible locally)
- For production use, consider adding authentication
- ngrok free tier URLs change on restart
