@echo off
setlocal
title Jarvis-OS launcher
cd /d "%~dp0"

echo.
echo   ==========================================
echo    JARVIS-OS  -  local-first agentic OS
echo   ==========================================
echo.

REM --- 1. install deps on first run --------------------------------
if not exist "orchestrator\node_modules" (
  echo [setup] installing orchestrator dependencies...
  call npm --prefix orchestrator install || goto :fail
)
if not exist "frontend\node_modules" (
  echo [setup] installing frontend dependencies...
  call npm --prefix frontend install || goto :fail
)

REM --- 2. free the ports if a previous run is still holding them ----
for %%P in (3030 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo [cleanup] freeing port %%P (pid %%A)
    taskkill /pid %%A /f >nul 2>&1
  )
)

REM --- 3. launch the two core services -----------------------------
echo [start] orchestrator  ->  http://localhost:3030
start "Jarvis Orchestrator" cmd /k "cd /d %~dp0orchestrator && npm start"

echo [start] frontend       ->  http://localhost:5173
start "Jarvis Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

REM --- 4. wait for the UI, then open the browser -------------------
echo [wait] giving the dev server a moment to boot...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo   Jarvis is starting in two terminal windows.
echo   Close those windows (or run stop.bat) to shut it down.
echo.
goto :eof

:fail
echo.
echo [error] dependency install failed. Make sure Node.js is installed
echo         and on your PATH, then run start.bat again.
pause
