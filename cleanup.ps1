# Kill Node processes running Next.js and NestJS for this project
$projectPath = (Get-Item $PSScriptRoot).FullName

Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmdLine -like "*$projectPath*" -or
        $cmdLine -like '*next*' -or
        $cmdLine -like '*nest*'
    } catch {
        $false
    }
} | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill processes using our ports (more reliable method)
foreach ($port in 3000, 3001, 4000) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue -State Listen
    foreach ($conn in $connections) {
        if ($conn.OwningProcess -ne 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

# Also try netsh as fallback
foreach ($port in 3000, 3001, 4000) {
    $result = netstat -ano | findstr ":$port" | findstr "LISTENING"
    if ($result) {
        $pid = ($result -split '\s+')[-1]
        if ($pid -match '^\d+$') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}

Start-Sleep -Seconds 1
Write-Host "Cleanup complete - ports 3000, 3001, 4000 freed"
