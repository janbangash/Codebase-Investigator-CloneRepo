# AI Repo Agent - Quick Start Guide

## For Client Demo (Recommended: Use Cloudflare Tunnel)

ngrok free plan only allows ONE tunnel. Use Cloudflare Tunnel instead - it's free and has no restrictions.

### Step 1: Install Cloudflare Tunnel

```powershell
winget install cloudflare.cloudflared
```

Or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

### Step 2: Run Your App Locally

```powershell
cd E:\Projects\ai-repo-agent
npm run dev
```

Wait for both servers to start:
- Backend: http://localhost:4000
- Frontend: http://localhost:3000

### Step 3: Start Cloudflare Tunnel

```powershell
cloudflared tunnel --url http://localhost:3000
```

This gives you a URL like: `https://your-random-name.trycloudflare.com`

### Step 4: Share with Client

Give your client the cloudflare URL. They can access it immediately.

**Note:** The backend must also be accessible. For a complete demo, you need TWO cloudflare tunnels:

**Terminal 1:**
```powershell
cloudflared tunnel --url http://localhost:4000
```
Copy the backend URL (e.g., `https://backend-xyz.trycloudflare.com`)

**Terminal 2:**
Update `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=https://backend-xyz.trycloudflare.com
```

**Terminal 3:**
```powershell
cloudflared tunnel --url http://localhost:3000
```
Give this frontend URL to your client.

---

## Alternative: ngrok with Two Sessions

If you must use ngrok, you need to run them from completely separate directories:

### Step 1: Create Separate Folders

```powershell
mkdir C:\ngrok-frontend
mkdir C:\ngrok-backend
```

### Step 2: Copy ngrok config

```powershell
copy $env:LOCALAPPDATA\ngrok\ngrok.yml C:\ngrok-frontend\ngrok.yml
copy $env:LOCALAPPDATA\ngrok\ngrok.yml C:\ngrok-backend\ngrok.yml
```

### Step 3: Run Frontend ngrok

```powershell
cd C:\ngrok-frontend
npx ngrok http 3000
```

### Step 4: Run Backend ngrok (NEW PowerShell window)

```powershell
cd C:\ngrok-backend
npx ngrok http 4000
```

Each will give you a different URL because they use separate config files.

### Step 5: Update Frontend Config

Update `E:\Projects\ai-repo-agent\frontend\.env.local`:

```env
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND-URL.ngrok-free.dev
```

### Step 6: Restart Frontend

```powershell
cd E:\Projects\ai-repo-agent\frontend
npm run dev
```

### Step 7: Restart Frontend ngrok

The frontend ngrok needs to restart to pick up the new environment variable.

---

## Current URLs

Your current ngrok URL: `https://enrich-sappiness-aloe.ngrok-free.dev`

This is currently pointing to port 3000 (frontend).

You need a SECOND URL for the backend (port 4000).

---

## Quick Test Locally

For local testing (on your machine only):

1. Open http://localhost:3000
2. Clone a repository
3. Browse files
4. Test AI search

Everything works locally without ngrok.
