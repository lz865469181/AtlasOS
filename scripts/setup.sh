#!/usr/bin/env bash
# One-click setup: install, build, configure, and run as background service
set -e

echo "========================================="
echo "  Feishu AI Assistant - Quick Setup"
echo "========================================="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js not found. Install from https://nodejs.org/"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm not found."; exit 1; }

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found v$NODE_VER)"
  exit 1
fi

# Install dependencies and build
echo ""
echo "[1/5] Installing dependencies..."
npm install --production=false

echo ""
echo "[2/5] Building..."
npm run build

# First run to bootstrap ~/.atlasOS/config.json and .env
echo ""
echo "[3/5] Bootstrapping config..."
node dist/index.js &
BOOT_PID=$!
sleep 3
kill $BOOT_PID 2>/dev/null || true
wait $BOOT_PID 2>/dev/null || true

ATLAS_HOME="$HOME/.atlasOS"
echo ""
echo "Config files created at:"
echo "  $ATLAS_HOME/config.json"
echo "  $ATLAS_HOME/.env"

# Prompt for Feishu credentials if not set
ENV_FILE="$ATLAS_HOME/.env"
if grep -q "^FEISHU_APP_ID=$" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo "[4/5] Configure Feishu credentials"
  echo "Get them from: https://open.feishu.cn/app > Your App > Credentials"
  echo ""
  read -p "  FEISHU_APP_ID: " APP_ID
  read -p "  FEISHU_APP_SECRET: " APP_SECRET

  if [ -n "$APP_ID" ] && [ -n "$APP_SECRET" ]; then
    sed -i.bak "s/^FEISHU_APP_ID=$/FEISHU_APP_ID=$APP_ID/" "$ENV_FILE"
    sed -i.bak "s/^FEISHU_APP_SECRET=$/FEISHU_APP_SECRET=$APP_SECRET/" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    echo "  Credentials saved to $ENV_FILE"
  else
    echo "  Skipped. Edit $ENV_FILE manually before starting."
  fi
else
  echo "[4/5] Feishu credentials already configured."
fi

# Install PM2 and start as service
echo ""
echo "[5/5] Starting background service..."

if ! command -v pm2 >/dev/null 2>&1; then
  echo "  Installing PM2..."
  npm install -g pm2
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pm2 delete feishu-ai-assistant 2>/dev/null || true
pm2 start "$PROJECT_DIR/dist/index.js" --name feishu-ai-assistant
pm2 save

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Service:  pm2 status"
echo "  Logs:     pm2 logs feishu-ai-assistant"
echo "  Restart:  pm2 restart feishu-ai-assistant"
echo "  Stop:     pm2 stop feishu-ai-assistant"
echo ""
echo "  WebUI:    http://127.0.0.1:20263"
echo "  Config:   $ATLAS_HOME/config.json"
echo "  Secrets:  $ATLAS_HOME/.env"
echo ""
echo "  beam-flow CLI: ~/.atlasOS/bin/beam-flow --help"
echo "  (restart your terminal if beam-flow is not found)"
echo ""
echo "  Auto-start on boot: pm2 startup"
echo ""
