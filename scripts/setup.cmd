@echo off
setlocal enabledelayedexpansion
:: One-click setup: install, build, configure, and run as background service

echo =========================================
echo   Feishu AI Assistant - Quick Setup
echo =========================================

:: Check prerequisites
where node >nul 2>&1 || (echo Error: Node.js not found. Install from https://nodejs.org/ && exit /b 1)
where npm >nul 2>&1 || (echo Error: npm not found. && exit /b 1)

:: Install dependencies and build
echo.
echo [1/5] Installing dependencies...
call npm install --production=false
if errorlevel 1 (echo Failed to install dependencies && exit /b 1)

echo.
echo [2/5] Building...
call npm run build
if errorlevel 1 (echo Failed to build && exit /b 1)

:: Bootstrap config
echo.
echo [3/5] Bootstrapping config...
start /b node dist\index.js
timeout /t 4 /nobreak >nul
taskkill /f /im node.exe /fi "WINDOWTITLE eq *index.js*" >nul 2>&1

set "ATLAS_HOME=%USERPROFILE%\.atlasOS"
echo.
echo Config files created at:
echo   %ATLAS_HOME%\config.json
echo   %ATLAS_HOME%\.env

:: Check if credentials need to be set
findstr /c:"FEISHU_APP_ID=" "%ATLAS_HOME%\.env" | findstr /v /c:"FEISHU_APP_ID=cli_" >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo [4/5] Configure Feishu credentials
    echo Get them from: https://open.feishu.cn/app ^> Your App ^> Credentials
    echo.
    set /p APP_ID="  FEISHU_APP_ID: "
    set /p APP_SECRET="  FEISHU_APP_SECRET: "

    if defined APP_ID if defined APP_SECRET (
        powershell -Command "(Get-Content '%ATLAS_HOME%\.env') -replace '^FEISHU_APP_ID=$', 'FEISHU_APP_ID=!APP_ID!' -replace '^FEISHU_APP_SECRET=$', 'FEISHU_APP_SECRET=!APP_SECRET!' | Set-Content '%ATLAS_HOME%\.env'"
        echo   Credentials saved.
    ) else (
        echo   Skipped. Edit %ATLAS_HOME%\.env manually.
    )
) else (
    echo [4/5] Feishu credentials already configured.
)

:: Install PM2 and start
echo.
echo [5/5] Starting background service...

where pm2 >nul 2>&1 || (
    echo   Installing PM2...
    call npm install -g pm2
)

pm2 delete feishu-ai-assistant >nul 2>&1
pm2 start "%~dp0..\dist\index.js" --name feishu-ai-assistant
pm2 save

echo.
echo =========================================
echo   Setup Complete!
echo =========================================
echo.
echo   Service:  pm2 status
echo   Logs:     pm2 logs feishu-ai-assistant
echo   Restart:  pm2 restart feishu-ai-assistant
echo   Stop:     pm2 stop feishu-ai-assistant
echo.
echo   WebUI:    http://127.0.0.1:20263
echo   Config:   %ATLAS_HOME%\config.json
echo   Secrets:  %ATLAS_HOME%\.env
echo.
echo   beam-flow CLI: %ATLAS_HOME%\bin\beam-flow --help
echo   (restart your terminal if beam-flow is not found)
echo.
echo   Auto-start on boot: pm2-startup install
echo.
