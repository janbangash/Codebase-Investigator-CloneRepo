@echo off
echo ========================================
echo AI Repo Agent - Cloudflare Tunnel Setup
echo ========================================
echo.
echo This will open TWO tunnels:
echo   1. Backend (port 4000) - API
echo   2. Frontend (port 3000) - Client URL
echo.
echo Press Ctrl+C in each window to stop tunnels
echo.
pause

:: Start backend tunnel
echo Starting BACKEND tunnel...
start "Cloudflare - Backend (4000)" cmd /k "cd /d E:\Projects\ai-repo-agent && E:\Projects\ai-repo-agent\cloudflared.exe tunnel --url http://localhost:4000"
timeout /t 3 /nobreak >nul

:: Start frontend tunnel
echo Starting FRONTEND tunnel...
start "Cloudflare - Frontend (3000)" cmd /k "cd /d E:\Projects\ai-repo-agent && E:\Projects\ai-repo-agent\cloudflared.exe tunnel --url http://localhost:3000"
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo SETUP INSTRUCTIONS:
echo ========================================
echo.
echo 1. Wait for both tunnels to start (you'll see URLs like https://xxx.trycloudflare.com)
echo.
echo 2. Copy the BACKEND URL (from port 4000 window)
echo.
echo 3. Update frontend\.env.local:
echo    NEXT_PUBLIC_API_URL=https://YOUR-BACKEND-URL.trycloudflare.com
echo.
echo 4. Restart frontend: npm run dev (in frontend folder)
echo.
echo 5. Restart FRONTEND tunnel to pick up new API URL
echo.
echo 6. Give client the FRONTEND URL (from port 3000 window)
echo.
echo ========================================
pause
