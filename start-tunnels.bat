@echo off
echo ========================================
echo AI Repo Agent - ngrok Tunnel Launcher
echo ========================================
echo.
echo Starting FRONTEND tunnel (port 3000)...
start "ngrok - Frontend (3000)" powershell -NoExit -Command "npx ngrok http 3000 --config=E:\Projects\ai-repo-agent\ngrok-frontend.yml"
timeout /t 2 /nobreak >nul
echo Starting BACKEND tunnel (port 4000)...
start "ngrok - Backend (4000)" powershell -NoExit -Command "npx ngrok http 4000 --config=E:\Projects\ai-repo-agent\ngrok-backend.yml"
echo.
echo Two windows opened. Wait for URLs to appear.
echo.
echo FRONTEND URL (give to client) - from window 1
echo BACKEND URL (update .env.local) - from window 2
echo.
pause
