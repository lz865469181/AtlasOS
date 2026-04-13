#!/usr/bin/env bash
set -euo pipefail

echo "========================================="
echo "  CodeLink - Quick Setup"
echo "========================================="

command -v node >/dev/null 2>&1 || { echo "Error: Node.js not found."; exit 1; }
command -v yarn >/dev/null 2>&1 || { echo "Error: Yarn not found."; exit 1; }

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found v$NODE_VER)"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo
echo "[1/4] Installing dependencies..."
yarn install

echo
echo "[2/4] Building..."
yarn build

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo
  echo "[3/4] Creating .env from .env.example..."
  cp .env.example .env
else
  echo
  echo "[3/4] .env already exists or no template found."
fi

echo
echo "[4/4] Starting background service..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "  Installing PM2..."
  npm install -g pm2
fi

pm2 delete codelink 2>/dev/null || true
pm2 start "yarn start" --name codelink --cwd "$PROJECT_DIR"
pm2 save

echo
echo "========================================="
echo "  Setup Complete"
echo "========================================="
echo
echo "  Service:  pm2 status"
echo "  Logs:     pm2 logs codelink"
echo "  Restart:  pm2 restart codelink"
echo "  Stop:     pm2 stop codelink"
echo
echo "  Edit credentials in: $PROJECT_DIR/.env"
echo "  Optional structured config: $PROJECT_DIR/codelink.config.json"
echo "  Runtime helper: yarn runtime --help"
