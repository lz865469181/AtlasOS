# Multi-Platform Deployment Guide

## 1. Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| Claude CLI | Latest | AI model backend |
| Go | 1.22+ | Build from source (optional) |
| Network | — | Feishu API (open.feishu.cn) |

## 2. Linux (Direct)

```bash
# Build
make build-linux

# Configure
cp config.json config.local.json
# Edit config.local.json with your Feishu credentials

# Run
export FEISHU_APP_ID="cli_xxxx"
export FEISHU_APP_SECRET="xxxx"
./bin/feishu-ai-assistant-linux-amd64 --config config.local.json

# Systemd service
sudo cp deploy/feishu-ai-assistant.service /etc/systemd/system/
sudo systemctl enable --now feishu-ai-assistant
```

## 3. Windows

```powershell
make build-windows

$env:FEISHU_APP_ID = "cli_xxxx"
$env:FEISHU_APP_SECRET = "xxxx"
.\bin\feishu-ai-assistant.exe --config config.json
```

## 4. Docker

```bash
# Build image
docker build -t feishu-ai-assistant:latest .

# Run
docker run -d \
  --name feishu-ai-assistant \
  -p 18789:18789 -p 18790:18790 \
  -e FEISHU_APP_ID=cli_xxxx \
  -e FEISHU_APP_SECRET=xxxx \
  -v $(pwd)/workspace:/app/workspace \
  feishu-ai-assistant:latest
```

## 5. Docker Compose

```yaml
version: '3.8'
services:
  feishu-ai-assistant:
    build: .
    ports:
      - "18789:18789"
      - "18790:18790"
    environment:
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
    volumes:
      - ./workspace:/app/workspace
    restart: unless-stopped
```

## 6. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| FEISHU_APP_ID | Yes | — | Feishu app ID |
| FEISHU_APP_SECRET | Yes | — | Feishu app secret |
| CLAUDE_CLI_PATH | No | claude | Path to Claude CLI |
| LOG_LEVEL | No | info | Log level |

## 7. Health Check

```bash
curl http://localhost:18790/health
# {"status":"healthy","time":"2026-03-19T15:00:00+08:00"}
```

## 8. Project Structure

```
feishu-ai-assistant/
├── cmd/server/main.go
├── internal/
│   ├── agent/          # Agent interface, Claude CLI, context builder, scheduler
│   ├── channel/        # Channel interface + feishu/ implementation
│   ├── config/         # JSON config loader
│   ├── gateway/        # Gateway, router, commands, WebSocket server
│   ├── heartbeat/      # Periodic task scheduler
│   ├── memory/         # Daily log, compaction
│   ├── session/        # Session model (tree), manager, store, compressor
│   ├── skill/          # Skill model, loader, lifecycle
│   ├── tools/          # Read/Write/Edit/Bash + security sandbox
│   ├── types/          # Shared types (ToolCall, ToolResult)
│   └── workspace/      # Agent workspace directory management
├── config.json
├── Makefile
├── Dockerfile
└── docs/
```

## 9. Makefile Targets

```
make build          # Build for current platform
make build-linux    # Cross-compile for Linux
make build-windows  # Cross-compile for Windows
make test           # Run all tests (verbose)
make clean          # Remove binaries
make run            # Build and run
```
