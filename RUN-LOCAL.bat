@echo off
setlocal enabledelayedexpansion
title DealScout - running on your own connection
cd /d "%~dp0"

echo.
echo  =====================================================
echo    DEALSCOUT  -  run on your own internet connection
echo  =====================================================
echo.
echo  Running from your home connection lets the resale
echo  sites (Depop, Grailed, Preloved, etc.) through -
echo  they block cloud servers, not home broadband.
echo.

rem --- Is Node.js installed? ---
where node >nul 2>nul
if errorlevel 1 (
    echo  Node.js isn't installed yet.
    echo  Opening nodejs.org - install the green "LTS" version,
    echo  then double-click this file again.
    start https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo  Found Node.js %%v
echo.

rem --- First run: install dependencies (skip the heavy optional browser) ---
if not exist "node_modules" (
    echo  First run - downloading the building blocks ^(a minute or two^)...
    echo.
    set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
    call npm install --omit=optional
    if errorlevel 1 (
        echo.
        echo  Install hit a problem - check your internet and run this again.
        pause
        exit /b 1
    )
    echo.
)

rem --- Give eBay keys a home (optional; the app runs fine without them) ---
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul

echo  =====================================================
echo    Starting DealScout at   http://localhost:8080
echo  =====================================================
echo.
echo  A browser tab will open in a few seconds.
echo  KEEP THIS WINDOW OPEN while you use it. Ctrl+C to stop.
echo.
echo  Tip: to see exactly what your connection unblocks,
echo  run DIAGNOSE.bat instead.
echo.

start "" cmd /c "timeout /t 6 >nul & start http://localhost:8080"
call npm start
pause
