@echo off
setlocal
title Jarvis-OS shutdown

echo.
echo   Stopping Jarvis-OS...
echo.

for %%P in (3030 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo   freeing port %%P (pid %%A)
    taskkill /pid %%A /t /f >nul 2>&1
  )
)

echo.
echo   Jarvis-OS stopped.
timeout /t 2 /nobreak >nul
