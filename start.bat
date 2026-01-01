@echo off
setlocal EnableDelayedExpansion

echo Starting AutoPing...

:: Start Backend
echo Launching Backend Server...
start "AutoPing Backend" cmd /k "cd server && npm start"

:: Start Frontend
echo Launching Frontend Client...
start "AutoPing Frontend" cmd /k "cd client && npm run dev"

:: Wait for frontend to start, then open Chrome
echo Waiting for frontend to start...

set "maxAttempts=30"
set "attempt=0"
set "frontendPort="

:CHECK_LOOP
if !attempt! GEQ !maxAttempts! (
    echo.
    echo ERROR: Frontend failed to start within !maxAttempts! seconds.
    echo Please check the frontend terminal window for errors.
    echo Possible causes:
    echo   - npm dependencies are not installed (run 'npm install' in client folder)
    echo   - Vite configuration error
    pause
    exit /b 1
)

set /a attempt+=1

:: Check ports 5173 to 5180
for /L %%p in (5173,1,5180) do (
    :: Use curl to fetch the page and find string to verify it is up
    curl -s http://localhost:%%p | findstr /C:"<title>AutoPing</title>" >nul 2>&1
    if !errorlevel! EQU 0 (
        echo.
        echo Found AutoPing on port %%p
        set "frontendPort=%%p"
        goto :FOUND
    )
)

:: Print a dot without newline (hacky in batch, just printing dot is easier)
<nul set /p=.
timeout /t 1 >nul
goto :CHECK_LOOP

:FOUND
echo.
echo Frontend is ready on port !frontendPort!! Opening Chrome...
start chrome http://localhost:!frontendPort!

echo AutoPing started successfully!
pause
