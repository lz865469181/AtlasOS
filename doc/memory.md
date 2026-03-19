# Local Configuration Web Console — Change Log

## Overview

Added a local web UI console (http://127.0.0.1:18791) for configuring `config.json` and managing secrets (API keys, tokens). Starts automatically with the main program.

---

## New Files

### `internal/webui/secrets.go`

Cross-platform persistent environment variable management.

- `SetEnvPersistent(key, value)` — Sets env var that survives reboot
  - Windows: `setx` command (HKCU registry)
  - Linux/macOS: appends `export KEY='VALUE'` to `~/.profile`
- `RemoveEnvPersistent(key)` — Removes persistent env var
  - Windows: `reg delete HKCU\Environment /v KEY /f`
  - Linux/macOS: removes matching line from `~/.profile`
- `GetSecretKeys()` — Returns known secret keys with masked values
  - Known keys: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`, `CLAUDE_CLI_PATH`, `CLAUDE_API_KEY`, `ANTHROPIC_API_KEY`
- `MaskValue(v)` — Shows first 4 + last 4 chars, masks middle with `****`
  - Empty → `(not set)`, ≤8 chars → all `*`, longer → `sk-a****cdef`
- `SecretEntry` struct: `Key`, `Masked`, `IsSet`
- `isValidEnvKey(key)` — Only allows `[A-Z][A-Z0-9_]*`, max 256 chars
- `appendToProfile(key, value)` — Single-quote escaping to prevent shell expansion
- `removeFromProfile(key)` — Filters out `export KEY=...` lines

### `internal/webui/static/index.html`

Single-page application with embedded CSS/JS. Dark theme UI.

- **3 tabs**: Configuration, Secrets, Status
- **Configuration tab**: Hierarchical tree editor with collapsible sections, per-field type-aware inputs (string/number/bool/array), secret fields highlighted in orange, array fields as tag chips with add/remove, "Raw JSON" toggle for fallback editing
- **Secrets tab**: Lists all known env keys with masked values, SET/NOT SET badges, remove buttons; form to set new secrets
- **Status tab**: Grid display of system info (uptime, config path, platform, etc.)
- CSRF: reads `csrf_token` cookie, sends as `X-CSRF-Token` header on POST/DELETE
- Auto-refreshes status every 15 seconds
- Input validation: secret key must match `^[A-Z][A-Z0-9_]*$`
- XSS protection: all dynamic content escaped via `esc()` helper

### `internal/webui/static.go`

Go embed directive:

```go
//go:embed static/*
var staticFS embed.FS
```

### `internal/webui/server.go`

HTTP server with API handlers.

- `Server` struct: `configPath`, `addr`, `startTime`, `srv`, `mu` (RWMutex)
- `NewServer(configPath, port)` — Creates server bound to `127.0.0.1:port`
- `Start()` — Listens and serves in goroutine (non-blocking)
- `Stop()` — Graceful shutdown

**Middleware:**
- `localhostOnly(next)` — Rejects `RemoteAddr` not from `127.0.0.1` or `::1` with 403
- `csrfMiddleware(next)`:
  - Sets `csrf_token` cookie (HttpOnly=false for JS, SameSite=Strict) on first request
  - Validates `X-CSRF-Token` header matches cookie on POST/DELETE/PUT
  - Adds `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`

**API Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/` | FileServer | Serves embedded SPA |
| GET | `/api/config` | `getConfig` | Returns raw config.json (with `${VAR}` placeholders intact) |
| POST | `/api/config` | `postConfig` | Validates JSON, sanitizes secrets, writes config.json |
| GET | `/api/secrets` | `getSecrets` | Returns key names + masked values, never full values |
| POST | `/api/secrets` | `postSecret` | Calls `SetEnvPersistent(key, value)` |
| DELETE | `/api/secrets` | `deleteSecret` | Calls `RemoveEnvPersistent(key)` |
| GET | `/api/status` | `handleStatus` | Returns uptime, config path, platform, time |

**Secret Sanitization:**
- `sanitizeSecrets(v)` — Recursively walks JSON, replaces raw values in secret-named fields with `${UPPER_KEY}` placeholders
- `isSecretField(name)` — Matches fields containing: `secret`, `token`, `password`, `api_key`, `apikey`
- Preserves existing `${VAR}` placeholders (no double-replacement)

### `internal/webui/server_test.go`

13 test cases:

| Test | What it verifies |
|------|------------------|
| `TestMaskValue` | 6 cases: empty, short, exact-8, long, boundary |
| `TestIsValidEnvKey` | 8 cases: valid keys, empty, leading digit, lowercase, spaces, dashes |
| `TestSanitizeSecrets` | Nested JSON: secret fields replaced, non-secret fields preserved |
| `TestSanitizeSecretsPreservesPlaceholders` | `${VAR}` values not double-replaced |
| `TestGetSecretKeys` | Returns entries, FEISHU_APP_ID masked correctly |
| `TestHandleGetConfig` | GET /api/config returns 200 with gateway config |
| `TestHandlePostConfig` | POST /api/config writes file, verified on disk |
| `TestHandlePostConfigInvalidJSON` | Invalid JSON returns 400 |
| `TestHandleGetSecrets` | GET /api/secrets returns non-empty entries |
| `TestHandleStatus` | GET /api/status returns "running" |
| `TestCSRFValidation` | POST without CSRF → 403; POST with matching token → passes |
| `TestLocalhostOnly` | 127.0.0.1 → 200; 192.168.1.1 → 403 |
| `TestPostConfigSanitizesSecrets` | Raw secret in POST body → saved as `${APP_SECRET}` placeholder |

---

## Modified Files

### `internal/config/config.go`

**Added `WebUIConfig` struct:**

```go
type WebUIConfig struct {
    Enabled bool `json:"enabled"`
    Port    int  `json:"port"`
}
```

**Added `WebUI` field to `Config` struct:**

```go
type Config struct {
    // ... existing fields ...
    WebUI WebUIConfig `json:"webui"`
}
```

**Added default in `applyDefaults()`:**

```go
if cfg.WebUI.Port == 0 { cfg.WebUI.Port = 18791 }
```

### `config.json`

Added webui section:

```json
"webui": { "enabled": true, "port": 18791 }
```

### `cmd/server/main.go`

**Added import:**

```go
"github.com/user/feishu-ai-assistant/internal/webui"
```

**Added WebUI startup (step 8, after health check):**

```go
var webuiServer *webui.Server
if cfg.WebUI.Enabled {
    webuiServer = webui.NewServer(*cfgPath, cfg.WebUI.Port)
    if err := webuiServer.Start(); err != nil {
        log.Printf("WebUI start warning: %v", err)
    }
}
```

**Added WebUI shutdown (before health server shutdown):**

```go
if webuiServer != nil {
    webuiServer.Stop()
}
```

---

## Security Design

| Measure | Implementation |
|---------|---------------|
| Localhost only | Bind `127.0.0.1`, middleware rejects non-local `RemoteAddr` |
| CSRF protection | Cookie + `X-CSRF-Token` header validation on mutating requests |
| Secret sanitization | Auto-replace raw secrets with `${VAR}` on config save |
| Masked display | `GET /api/secrets` returns `sk-a****cdef`, never full values |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` |
| Embedded static | `go:embed`, no filesystem serving, no path traversal |
| Input validation | Env key must match `[A-Z][A-Z0-9_]*`, JSON validated before write |
| Persistent secrets | System env vars via `setx` (Windows) / `~/.profile` (Linux) |

## Architecture

```
Browser (localhost:18791)
    |
    v
+--------------------------------------+
|  Config Web Server (Go, embedded)    |
|  127.0.0.1:18791 only               |
|                                      |
|  GET  /              -> SPA          |
|  GET  /api/config    -> read config  |
|  POST /api/config    -> write config |
|  GET  /api/secrets   -> list masked  |
|  POST /api/secrets   -> set env var  |
|  DEL  /api/secrets   -> remove env   |
|  GET  /api/status    -> system info  |
+--------------------------------------+
```
