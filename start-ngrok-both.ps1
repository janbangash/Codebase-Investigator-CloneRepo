# AI Repo Agent - Start Both Frontend and Backend with ngrok (Pooling Enabled)
# Both tunnels share the SAME URL - frontend and backend accessible from one domain
# Frontend: https://xxxx.ngrok-free.dev
# Backend: https://xxxx.ngrok-free.dev/api/* (same URL, different port)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "AI Repo Agent - Full ngrok Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check and kill existing ngrok processes
$ngrokProcesses = Get-Process ngrok -ErrorAction SilentlyContinue
if ($ngrokProcesses) {
    Write-Host "Stopping existing ngrok processes..." -ForegroundColor Yellow
    $ngrokProcesses | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Start ngrok with config for both tunnels (same URL with pooling)
Write-Host "Starting ngrok with both tunnels (same URL)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "cd '$PSScriptRoot'; npx ngrok start --all"

Write-Host ""
Write-Host "SETUP INSTRUCTIONS:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Wait for ngrok to show TWO URLs (they should be THE SAME)" -ForegroundColor White
Write-Host "   - Forwarding http://localhost:3000 (frontend)" -ForegroundColor Gray
Write-Host "   - Forwarding http://localhost:4000 (backend)" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Copy the ngrok URL (e.g., https://xxxx.ngrok-free.dev)" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Update frontend/.env.local:" -ForegroundColor Yellow
Write-Host "   NEXT_PUBLIC_BACKEND_URL=https://xxxx.ngrok-free.dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Update backend/.env:" -ForegroundColor Yellow
Write-Host "   ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://xxxx.ngrok-free.dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Restart both servers if they're already running" -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: Both frontend and backend share the SAME ngrok URL" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
