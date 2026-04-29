# AI Repo Agent - Start Backend localtunnel (WebSocket only)
# This script exposes the backend on localhost:4000 via localtunnel
# Used for WebSocket connections when frontend is on ngrok

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AI Repo Agent - Backend localtunnel" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Starting localtunnel for backend (WebSocket)..." -ForegroundColor Cyan
Write-Host "This exposes localhost:4000 for WebSocket connections" -ForegroundColor Yellow
Write-Host ""

# Start localtunnel for backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "npx localtunnel --port 4000"

Write-Host ""
Write-Host "SETUP INSTRUCTIONS:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Wait for localtunnel to show the URL (e.g., https://xxxx.loca.lt)" -ForegroundColor White
Write-Host ""
Write-Host "2. Copy the localtunnel URL" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Update frontend/.env.local:" -ForegroundColor Yellow
Write-Host "   NEXT_PUBLIC_BACKEND_URL=https://your-url.loca.lt" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Update backend/.env:" -ForegroundColor Yellow
Write-Host "   ALLOWED_ORIGINS=...,https://your-url.loca.lt" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: This tunnel is only needed for WebSocket connections" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
