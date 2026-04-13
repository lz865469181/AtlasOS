@echo off
setlocal

echo =========================================
echo   CodeLink - Quick Setup
echo =========================================

where node >nul 2>&1 || (echo Error: Node.js not found.&& exit /b 1)
where yarn >nul 2>&1 || (echo Error: Yarn not found.&& exit /b 1)

set "PROJECT_DIR=%~dp0.."
pushd "%PROJECT_DIR%"

echo.
echo [1/4] Installing dependencies...
call yarn install
if errorlevel 1 (popd & exit /b 1)

echo.
echo [2/4] Building...
call yarn build
if errorlevel 1 (popd & exit /b 1)

if not exist ".env" if exist ".env.example" (
  echo.
  echo [3/4] Creating .env from .env.example...
  copy /Y ".env.example" ".env" >nul
) else (
  echo.
  echo [3/4] .env already exists or no template found.
)

echo.
echo [4/4] Starting background service...
where pm2 >nul 2>&1 || (
  echo   Installing PM2...
  call npm install -g pm2
)

pm2 delete codelink >nul 2>&1
pm2 start "yarn start" --name codelink --cwd "%PROJECT_DIR%"
pm2 save

echo.
echo =========================================
echo   Setup Complete
echo =========================================
echo.
echo   Service:  pm2 status
echo   Logs:     pm2 logs codelink
echo   Restart:  pm2 restart codelink
echo   Stop:     pm2 stop codelink
echo.
echo   Edit credentials in: %PROJECT_DIR%\.env
echo   Optional structured config: %PROJECT_DIR%\codelink.config.json
echo   Runtime helper: yarn runtime --help

popd
