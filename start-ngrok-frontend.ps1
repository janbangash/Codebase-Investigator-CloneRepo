# AI Repo Agent - Start Frontend with ngrok
# This script starts the frontend dev server and exposes it via ngrok
# Backend stays on localhost:4000 (not exposed)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AI Repo Agent - Frontend + ngrok" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if frontend is already running
$portInUse = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if (-not $portInUse) {
    Write-Host "Starting Next.js dev server on port 3000..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", `
        "cd '$PSScriptRoot\frontend'; Write-Host 'Starting frontend...' -ForegroundColor Green; npm run dev"
    Write-Host "Waiting 10 seconds for Next.js to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
} else {
    Write-Host "Frontend already running on port 3000" -ForegroundColor Green
}

# Start ngrok tunnel for frontend only
Write-Host ""
Write-Host "Starting ngrok tunnel for frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Write-Host '=================================' -ForegroundColor Green; `
     Write-Host 'FRONTEND URL (Share this):' -ForegroundColor Blue; `
     Write-Host '=================================' -ForegroundColor Cyan; `
     Write-Host '' ; `
     npx ngrok http 3000"

Write-Host ""
Write-Host "SETUP INSTRUCTIONS:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Wait for ngrok to show the URL (e.g., https://xxxx.ngrok-free.dev)" -ForegroundColor White
Write-Host ""
Write-Host "2. Copy the ngrok URL" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Update backend/.env:" -ForegroundColor Yellow
Write-Host "   ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://your-url.ngrok-free.dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Restart backend if it's already running:" -ForegroundColor Yellow
Write-Host "   cd backend" -ForegroundColor Gray
Write-Host "   npm run start:dev" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Open the ngrok URL in browser to test" -ForegroundColor Green
Write-Host ""
Write-Host "Note: Backend stays on localhost:4000 (not exposed to internet)" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
