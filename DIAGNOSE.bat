@echo off
setlocal
title DealScout - which sources work from here?
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo  Install Node.js first from nodejs.org, then run RUN-LOCAL.bat once.
    start https://nodejs.org
    pause
    exit /b 1
)
if not exist "node_modules" (
    echo  Run RUN-LOCAL.bat once first ^(it installs what's needed^), then come back.
    pause
    exit /b 1
)

echo.
echo  =====================================================
echo    DEALSCOUT  -  source diagnosis (from THIS connection)
echo  =====================================================
echo.
set "Q="
set /p Q=  Search term to test [Enter for "nike air max 90"]:
if "%Q%"=="" set "Q=nike air max 90"
echo.
echo  Hitting every marketplace live... a green "OK" means your
echo  connection can reach it; "403" means that site blocked it.
echo.
call npm run diagnose "%Q%"
echo.
pause
