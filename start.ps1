Write-Host "Starting AutoPing..." -ForegroundColor Cyan

# Start Backend
Write-Host "Launching Backend Server..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd server; npm start"

# Start Frontend
Write-Host "Launching Frontend Client..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd client; npm run dev"

# Wait for frontend to start, then open Chrome
Write-Host "Waiting for frontend to start..." -ForegroundColor Yellow

$maxAttempts = 30  # 30 seconds timeout
$attempt = 0
$frontendPort = $null
$portsToCheck = 5173..5180  # Vite tries these ports in order

while ($attempt -lt $maxAttempts -and -not $frontendPort) {
    $attempt++
    foreach ($port in $portsToCheck) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
            # Look for AutoPing specifically (not just any Vite app)
            if ($response.Content -match "<title>AutoPing</title>") {
                Write-Host "`nFound AutoPing on port $port" -ForegroundColor Cyan
                $frontendPort = $port
                break
            }
        }
        catch {
            # Port not ready or not responding
        }
    }
    if (-not $frontendPort) {
        Write-Host "." -NoNewline -ForegroundColor Yellow
        Start-Sleep -Seconds 1
    }
}

Write-Host ""  # New line after dots

if (-not $frontendPort) {
    Write-Host "ERROR: Frontend failed to start within 30 seconds." -ForegroundColor Red
    Write-Host "Please check the frontend terminal window for errors." -ForegroundColor Red
    Write-Host "Possible causes:" -ForegroundColor Yellow
    Write-Host "  - npm dependencies are not installed (run 'npm install' in client folder)" -ForegroundColor Yellow
    Write-Host "  - Vite configuration error" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Frontend is ready on port $frontendPort! Opening Chrome..." -ForegroundColor Green
Start-Process "chrome" "http://localhost:$frontendPort"

Write-Host "AutoPing started successfully!" -ForegroundColor Cyan
