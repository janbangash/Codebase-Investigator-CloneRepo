# AI Repo Agent - Client Access Guide

## 🌐 Live Demo Access

### For Clients (No Setup Required)

Your client can access the live demo using the ngrok URLs below. No installation needed!

---

## 🔧 Developer Setup (For You to Run Locally)

### Prerequisites

Before running the project, ensure you have:

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)
- **Ollama** (for AI features) - [Download](https://ollama.com/)

### Quick Start

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd ai-repo-agent
```

2. **Install dependencies**
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. **Configure environment variables**

Create `backend/.env`:
```env
PORT=4000
FRONTEND_URL=http://localhost:3000
CLONE_TARGET_DIR=./cloned-repos
OLLAMA_MODEL=deepseek-coder:6.7b-instruct
OLLAMA_EMBED_MODEL=nomic-embed-text
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

4. **Pull Ollama models** (for AI features)
```bash
ollama pull deepseek-coder:6.7b-instruct
ollama pull nomic-embed-text
```

5. **Start the application**
```bash
# From project root
npm run dev
```

This starts:
- Backend on http://localhost:4000
- Frontend on http://localhost:3000

---

## 🌍 Sharing with Clients via ngrok

### What is ngrok?

ngrok creates a secure tunnel to your local development server, giving you a public URL that anyone can access from anywhere.

### Setup Steps

#### Step 1: Install ngrok

```powershell
npm install -g ngrok
```

#### Step 2: Create ngrok Account

1. Go to https://dashboard.ngrok.com/signup
2. Sign up for a free account
3. Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
4. Add authtoken:
```powershell
npx ngrok config add-authtoken YOUR_AUTHTOKEN
```

#### Step 3: Run Your Local Servers

```bash
# Terminal 1 - Start the app
npm run dev
```

Wait for both servers to start:
- Backend: http://localhost:4000
- Frontend: http://localhost:3000

#### Step 4: Create ngrok Tunnels

**Open TWO separate PowerShell windows:**

**Window 1 - Frontend (Client-facing URL):**
```powershell
npx ngrok http 3000
```

**Window 2 - Backend (API URL):**
```powershell
npx ngrok http 4000
```

#### Step 5: Get Your URLs

Each ngrok window will show a URL like:
```
Forwarding: https://xxxx-xxxx-xxxx.ngrok-free.dev -> http://localhost:3000
```

- **Frontend URL** (from Window 1): Give this to your client
- **Backend URL** (from Window 2): Update frontend config

#### Step 6: Update Frontend API URL

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=https://yyyy-yyyy-yyyy.ngrok-free.dev
```

Restart the frontend:
```bash
cd frontend
npm run dev
```

---

## 📋 Client Instructions

### Accessing the Demo

1. **Click the URL** provided by the developer
2. **Wait for the page to load** (first load may take 30-60 seconds)
3. **Clone a repository:**
   - Enter a GitHub URL (e.g., `https://github.com/facebook/react`)
   - Click "Clone Repository"
   - Watch the progress bar
4. **Browse files** once cloning completes
5. **Use AI Search** to ask questions about the code

### Supported Repositories

Any public GitHub repository works:
- `https://github.com/owner/repo`
- Examples: `facebook/react`, `expressjs/express`, `laravel/laravel`

---

## 🚀 Features Overview

### Repository Cloning
- Clone any public GitHub repository
- Real-time progress tracking
- Multiple repositories supported

### File Browser
- Navigate folder structure
- View file contents with line numbers
- Expandable nested folders

### AI Search
- Natural language code search
- Find functions, classes, variables
- Click results to navigate to exact location
- AI-powered code understanding

### AI Chat
- Ask questions about your codebase
- Get intelligent responses with code references
- Click references to navigate

---

## 🛠️ Troubleshooting

### Frontend shows "Cannot GET /"
- You're accessing the backend URL instead of frontend
- Use the URL from **Window 1** (port 3000)

### No repositories showing
- Ensure backend ngrok is running
- Update `NEXT_PUBLIC_API_URL` in frontend `.env.local`
- Restart frontend after changing API URL

### AI features not working
- Install Ollama: https://ollama.com
- Pull required models:
```bash
ollama pull deepseek-coder:6.7b-instruct
ollama pull nomic-embed-text
```

### ngrok connection timeout
- Free ngrok URLs expire after session
- Restart ngrok to get new URL
- Consider paid plan for persistent URLs

### Clone fails
- Ensure Git is installed
- Check repository URL is public
- Verify internet connection

---

## 📞 Support

For issues or questions:
- Check this guide's Troubleshooting section
- Ensure all prerequisites are installed
- Verify ngrok tunnels are running

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌─────────────────┐
│    Client       │         │   Developer     │
│   Browser       │         │   Machine       │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │  https://xxxx.ngrok.io    │
         │──────────────────────────>│
         │                           │
         │                           │  http://localhost:3000
         │                           │<───────┐
         │                           │        │
         │                           │  Frontend (Next.js)
         │                           │        │
         │                           │  http://localhost:4000
         │                           │<───────┐
         │                           │        │
         │                           │  Backend (NestJS)
         │                           │        │
         │                           │  Ollama AI
         │                           │  Git Clone
         │                           │
```

---

## 📄 License

ISC
