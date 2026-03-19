#!/usr/bin/env bash
#
# Hot-deploy with auto-rollback on health check timeout.
#
# Usage: ./scripts/deploy.sh [config_path]
#
# Flow:
#   1. Build new binary → bin/feishu-ai-assistant-new
#   2. Backup current binary → bin/feishu-ai-assistant-old
#   3. Stop current process (SIGTERM)
#   4. Replace binary
#   5. Start new process
#   6. Health check (30s timeout)
#   7. If health check fails → rollback to old binary and restart
#

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$PROJECT_DIR/bin/feishu-ai-assistant"
BINARY_NEW="$PROJECT_DIR/bin/feishu-ai-assistant-new"
BINARY_OLD="$PROJECT_DIR/bin/feishu-ai-assistant-old"
CONFIG="${1:-$PROJECT_DIR/config.json}"
PID_FILE="$PROJECT_DIR/.feishu-ai-assistant.pid"
HEALTH_URL="http://127.0.0.1:18790/health"
HEALTH_TIMEOUT=30
HEALTH_INTERVAL=2

log() { echo "[deploy $(date +%H:%M:%S)] $*"; }

# --- Step 1: Build new binary ---
log "Building new binary..."
cd "$PROJECT_DIR"
if ! go build -o "$BINARY_NEW" ./cmd/server/; then
    log "ERROR: Build failed. Aborting deploy."
    exit 1
fi
log "Build OK: $(ls -lh "$BINARY_NEW" | awk '{print $5}')"

# --- Step 2: Backup current binary ---
if [ -f "$BINARY" ]; then
    cp "$BINARY" "$BINARY_OLD"
    log "Backed up current binary to $BINARY_OLD"
fi

# --- Step 3: Stop current process ---
stop_current() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Stopping process $pid..."
            kill -TERM "$pid"
            # Wait up to 10s for graceful shutdown
            for i in $(seq 1 10); do
                if ! kill -0 "$pid" 2>/dev/null; then
                    log "Process $pid stopped"
                    return 0
                fi
                sleep 1
            done
            log "Force killing $pid"
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
}

stop_current

# --- Step 4: Replace binary ---
mv "$BINARY_NEW" "$BINARY"
chmod +x "$BINARY"
log "Binary replaced"

# --- Step 5: Start new process ---
log "Starting new process..."
"$BINARY" --config "$CONFIG" &
NEW_PID=$!
log "Started with PID $NEW_PID"

# --- Step 6: Health check ---
log "Waiting for health check (timeout: ${HEALTH_TIMEOUT}s)..."
ELAPSED=0
HEALTHY=false

while [ "$ELAPSED" -lt "$HEALTH_TIMEOUT" ]; do
    sleep "$HEALTH_INTERVAL"
    ELAPSED=$((ELAPSED + HEALTH_INTERVAL))

    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        log "Health check PASSED at ${ELAPSED}s"
        HEALTHY=true
        break
    fi

    # Check if process is still alive
    if ! kill -0 "$NEW_PID" 2>/dev/null; then
        log "ERROR: New process died (PID $NEW_PID)"
        break
    fi

    log "Health check pending... (${ELAPSED}s/${HEALTH_TIMEOUT}s)"
done

# --- Step 7: Rollback if unhealthy ---
if [ "$HEALTHY" = false ]; then
    log "ERROR: Health check FAILED. Rolling back..."

    # Kill the new process
    kill -TERM "$NEW_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$NEW_PID" 2>/dev/null || true

    # Restore old binary
    if [ -f "$BINARY_OLD" ]; then
        mv "$BINARY_OLD" "$BINARY"
        log "Restored old binary"

        # Start old binary
        "$BINARY" --config "$CONFIG" &
        OLD_PID=$!
        log "Rolled back: started old process with PID $OLD_PID"

        # Verify old binary health
        sleep 5
        if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            log "Rollback successful: old binary is healthy"
        else
            log "WARNING: Old binary also unhealthy. Manual intervention needed."
        fi
    else
        log "ERROR: No backup binary to rollback to!"
    fi

    exit 1
fi

# --- Success ---
log "Deploy successful! PID: $NEW_PID"

# Clean up backup
rm -f "$BINARY_OLD"
