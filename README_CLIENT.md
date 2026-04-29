# AI Repo Agent - Share with Clients

## Quick Setup (Using Cloudflare Tunnel - FREE, No Account)

### Prerequisites

1. **Install Cloudflare Tunnel:**
```powershell
winget install cloudflare.cloudflared
```

2. **Make sure your app is running:**
```powershell
cd E:\Projects\ai-repo-agent
npm run dev
```

### Start Tunnels

**Option A: Use the batch file (Easiest)**

Double-click: `start-cloudflare-tunnels.bat`

This opens two windows with both tunnels.

**Option B: Manual Setup**

**Terminal 1 (Backend):**
```powershell
cloudflared tunnel --url http://localhost:4000
```
Copy the URL (e.g., `https://abc-123.trycloudflare.com`)

**Terminal 2 (Frontend):**
First update `frontend\.env.local`:
```env
NEXT_PUBLIC_API_URL=https://abc-123.trycloudflare.com
```

Then restart frontend:
```powershell
cd frontend
npm run dev
```

Then start frontend tunnel:
```powershell
cloudflared tunnel --url http://localhost:3000
```

### URLs You Get

| Tunnel | URL | Use |
|--------|-----|-----|
| Backend | `https://abc-123.trycloudflare.com` | Put in `.env.local` |
| Frontend | `https://xyz-789.trycloudflare.com` | **Give this to client** |

### Share with Client

Send your client the **Frontend URL**. They can access it from any device.

**Example email to client:**

```
Hi [Client Name],

You can access the live demo of the AI Repo Agent here:

https://xyz-789.trycloudflare.com

Instructions:
1. Enter a GitHub repository URL (e.g., https://github.com/expressjs/express)
2. Click "Clone Repository"
3. Wait for cloning to complete (progress bar shows status)
4. Browse files and use AI search to explore the code

The session will remain active for [X hours]. Let me know if you have any questions.

Best regards,
[Your Name]
```

---

## Alternative: Using ngrok (Requires Paid Plan for 2 Tunnels)

ngrok free plan only allows ONE tunnel. To run two tunnels you need:

- **Paid ngrok plan**, OR
- **Two different ngrok accounts** with different authtokens

If you have two ngrok accounts:

**Terminal 1:**
```powershell
npx ngrok config add-authtoken FIRST_ACCOUNT_TOKEN
npx ngrok http 3000
```

**Terminal 2:**
```powershell
npx ngrok config add-authtoken SECOND_ACCOUNT_TOKEN
npx ngrok http 4000
```

---

## Troubleshooting

### Frontend shows "Cannot connect to API"

- Backend tunnel is not running
- `.env.local` has wrong URL
- Frontend needs restart after changing `.env.local`

### Client sees blank page

- Frontend tunnel stopped
- Cloudflare URL expired (they change each session)
- Need to restart tunnels

### Clone fails

- Backend needs Ollama running
- Check backend logs for errors
- Ensure Git is installed

---

## Files Reference

| File | Purpose |
|------|---------|
| `start-cloudflare-tunnels.bat` | One-click tunnel launcher |
| `frontend\.env.local` | Backend API URL config |
| `README.md` | Full project documentation |
| `CLIENT_SETUP.md` | Detailed client setup guide |
