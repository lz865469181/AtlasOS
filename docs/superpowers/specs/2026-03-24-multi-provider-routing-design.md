# Multi-Provider Routing Design

**Date**: 2026-03-24
**Status**: Approved
**Goal**: Best-model-per-task routing — different models for different request types
**Approach**: Hybrid — CLI for Claude, direct API for other providers

---

## 1. Strategic Context

### Problem
Currently feishu-ai-assistant routes all requests through either Claude CLI or OpenCode CLI (global config switch). Users can select models within one backend, but cannot dynamically route requests to the best-fit provider (e.g., fast/cheap model for simple Q&A, capable model for complex reasoning, long-context model for deep conversations).

### Decision: Hybrid Provider Abstraction (not sidecar, not full port)
- **Keep Claude CLI** for Anthropic models (preserves MCP, session features, --add-dir)
- **Add direct API clients** for non-Claude providers (OpenAI, DeepSeek, Gemini, etc.)
- **Port only the routing decision logic** from claude-code-router, NOT the transformer pipeline
- **No new npm dependencies** — use native `fetch` for HTTP calls

### What we take from claude-code-router
- Scenario-based routing concept (map request characteristics to provider+model)
- Fallback list per scenario (sequential retry on provider errors)
- Config structure for providers (id, api_key, base_url, models)

### What we explicitly do NOT take
- Transformer pipeline (20 transformers — exists to impersonate Anthropic API, not needed)
- SSE stream rewriting between formats
- Token counting service (use simple heuristics for routing)
- Agent system, preset/namespace system, auth middleware

---

## 2. Provider Abstraction Layer

### Core Types (`src/provider/types.ts`)

```typescript
export interface ProviderConfig {
  id: string;                          // "claude-cli", "openai", "deepseek", "gemini"
  name: string;                        // Human-readable display name
  type: "cli" | "api";                 // Execution model
  api_base_url?: string;               // For API providers
  api_key?: string;                    // ${ENV_VAR} expanded from config
  models: Record<string, string>;      // modelId → display name
  default_model?: string;              // Default model for this provider
  cli_path?: string;                   // For CLI providers: path to binary
}

export interface ProviderAskOptions {
  prompt: string;
  systemPrompt?: string;
  conversationHistory?: Message[];     // For API providers (stateless)
  model: string;
  workDir?: string;
  addDirs?: string[];
  sessionId?: string;                  // CLI providers only
  recentHistory?: string;              // For session recovery
}

export interface ProviderResult {
  text: string;
  is_error?: boolean;
  duration_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface StreamChunk {
  type: "assistant_text" | "result" | "error";
  text: string;
}

export interface Provider {
  readonly config: ProviderConfig;
  ask(options: ProviderAskOptions): Promise<ProviderResult>;
  askStreaming(options: ProviderAskOptions): AsyncGenerator<StreamChunk>;
}
```

### Provider Implementations

| Provider | File | Type | Covers |
|----------|------|------|--------|
| `ClaudeCliProvider` | `src/provider/claude-cli.ts` | cli | Wraps existing `src/claude/client.ts` |
| `OpenAICompatProvider` | `src/provider/openai-compat.ts` | api | OpenAI, DeepSeek, OpenRouter, Groq, Ollama |
| `GeminiProvider` | `src/provider/gemini.ts` | api | Google Gemini (non-OpenAI format) |

### Provider Registry (`src/provider/registry.ts`)

```typescript
class ProviderRegistry {
  private providers: Map<string, Provider>;

  constructor(configs: ProviderConfig[]);
  resolve(route: string): { provider: Provider; model: string };
  getAllModels(): Record<string, { provider: string; name: string }>;
}
```

Route format: `"providerId/modelId"` (e.g., `"claude-cli/claude-sonnet-4-6"`).

---

## 3. Routing Engine

### Routing Signals

| Signal | Source | Detection |
|--------|--------|-----------|
| User explicit choice | `/model` command, card button | `session.route` is non-empty |
| Conversation depth | `session.conversation` | Sum of character lengths / 4 ≈ tokens |
| Message complexity | Prompt text | Code blocks, length, numbered lists |

### Routing Decision (`src/routing/engine.ts`)

```
resolveRoute(session, prompt, config):
  1. If session.route is set → return it (user choice always wins)
  2. Estimate total tokens = (conversation history chars + prompt chars) / 4
     - If > routing.long_context_threshold → return routing.long_context
  3. Estimate complexity:
     - Has ``` (code blocks) → complex
     - prompt.length > routing.complexity_threshold → complex
     - Has 3+ numbered items → complex
  4. If complex → return routing.complex
  5. Return routing.default
```

### Complexity Heuristic (`src/routing/heuristics.ts`)

```typescript
function estimateComplexity(prompt: string): "simple" | "complex" {
  if (prompt.includes("```")) return "complex";
  if (prompt.length > threshold) return "complex";
  if ((prompt.match(/\d+\.\s/g) || []).length >= 3) return "complex";
  return "simple";
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough heuristic, good enough for routing
}
```

### Fallback Logic

On provider error, try each route in `routing.fallback[]` sequentially. First success wins.

---

## 4. Config Schema Changes

### New sections added to `config.json`

```json
{
  "providers": [
    {
      "id": "claude-cli",
      "name": "Claude (CLI)",
      "type": "cli",
      "cli_path": "claude",
      "models": {
        "claude-haiku-4-5-20251001": "Haiku (Fast)",
        "claude-sonnet-4-6": "Sonnet (Balanced)",
        "claude-opus-4-6": "Opus (Most Capable)"
      },
      "default_model": "claude-haiku-4-5-20251001"
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "api",
      "api_base_url": "https://api.deepseek.com/v1",
      "api_key": "${DEEPSEEK_API_KEY}",
      "models": {
        "deepseek-chat": "DeepSeek Chat (Fast)",
        "deepseek-reasoner": "DeepSeek Reasoner (Thinking)"
      },
      "default_model": "deepseek-chat"
    }
  ],
  "routing": {
    "default": "claude-cli/claude-haiku-4-5-20251001",
    "complex": "claude-cli/claude-sonnet-4-6",
    "long_context": "deepseek/deepseek-chat",
    "long_context_threshold": 4000,
    "complexity_threshold": 500,
    "fallback": ["deepseek/deepseek-chat"]
  }
}
```

### Fields removed from `agent` section
- `backend` → replaced by `providers[]`
- `opencode_cli_path` → replaced by provider-level `cli_path`
- `claude_cli_path` → moved to claude-cli provider's `cli_path`
- `default_model` → moved to per-provider `default_model`

### Fields kept in `agent` section
- `anthropic_api_key`, `claude_api_key` → still needed for Claude CLI environment
- `timeout`, `max_retries`, `max_concurrent_per_agent` → still global
- `bash`, `workspace_root` → unchanged

---

## 5. Session Changes

### Session class

```diff
  class Session {
-   model: string = DEFAULT_MODEL;
+   /** Provider + model route. Format: "providerId/modelId" or "" for auto-routing. */
+   route: string = "";
  }
```

When `route` is empty → auto-routing via the routing engine.
When `route` is set → explicit user choice.

### /model command updated

```
/model                    → show card with ALL models grouped by provider
/model haiku              → alias for claude-cli/claude-haiku-4-5-20251001
/model deepseek           → alias for deepseek/deepseek-chat
/model gpt4o              → alias for openai/gpt-4o
/model auto               → clear route, re-enable auto-routing
```

### Conversation history for API providers

API providers are stateless. When routing to an API provider, the system converts `session.conversation` to the provider's message format and includes it in the request body.

For Claude CLI, conversation history continues to be managed by CLI sessions (no change).

---

## 6. File Structure

### New files

```
src/
├── provider/
│   ├── types.ts              # Provider, ProviderConfig, ProviderResult interfaces
│   ├── registry.ts           # ProviderRegistry: load configs, resolve routes
│   ├── claude-cli.ts         # ClaudeCliProvider (wraps claude/client.ts)
│   ├── openai-compat.ts      # OpenAICompatProvider (DeepSeek, OpenRouter, etc.)
│   └── gemini.ts             # GeminiProvider (Google's format)
├── routing/
│   ├── engine.ts             # resolveRoute(): scenario detection + model selection
│   └── heuristics.ts         # estimateComplexity(), estimateTokens()
```

### Modified files

| File | Change |
|------|--------|
| `src/config.ts` | Add `ProviderConfig[]`, `RoutingConfig` types |
| `src/session/session.ts` | `model` → `route`, remove `BACKEND_MODELS` |
| `src/backend/index.ts` | Rewrite to delegate to ProviderRegistry |
| `src/router/router.ts` | Call `resolveRoute()` before ask, pass resolved route |
| `src/router/commands.ts` | Update `/model` for multi-provider listing |
| `src/platform/feishu/cards.ts` | Update `modelSelectionCard()` to group by provider |
| `src/index.ts` | Initialize ProviderRegistry on startup |
| `config.json` | Add `providers[]` and `routing` sections |

---

## 7. API Provider Implementation

### OpenAI-Compatible Client

Uses native `fetch`. No npm dependencies.

**Buffered mode**: POST to `/chat/completions`, parse JSON response.
**Streaming mode**: POST with `stream: true`, parse SSE lines (`data: {...}`) from response body.

**Message format conversion**:
```typescript
function toOpenAIMessages(history: Message[], systemPrompt?: string): OpenAIMessage[] {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const msg of history) messages.push({ role: msg.role, content: msg.content });
  return messages;
}
```

**Scope limitation**: Text-only for API providers in v1. No tool calls, images, or multimodal. Chat text only.

### Gemini Client

Similar to OpenAI-compat but with Google's API format:
- Different URL structure (`/v1beta/models/{model}:generateContent`)
- Auth via `x-goog-api-key` header
- Different message format (`contents[].parts[].text`)

---

## 8. Error Handling

### Fallback Chain

```typescript
async function askWithFallback(route, options, fallbackRoutes):
  try:
    return provider.ask(options)
  catch:
    for each fallbackRoute:
      try: return fallbackProvider.ask(options)
      catch: continue
    throw original error
```

### Error classification

Existing `src/error/classifier.ts` handles CLI errors. Extended to handle API errors:
- HTTP 429 → rate_limited
- HTTP 401/403 → auth_error
- HTTP 5xx → provider_error
- Network error → connection_error
- Timeout → timeout

---

## 9. Scope Boundaries (v1)

### In scope
- Provider abstraction (CLI + API types)
- ClaudeCliProvider (wrapping existing code)
- OpenAICompatProvider (covers DeepSeek, OpenRouter, Groq, Ollama)
- Routing engine with 3 scenarios (default, complex, long_context)
- Fallback on provider errors
- /model command updated for multi-provider
- Config schema migration

### Out of scope (future)
- GeminiProvider (add when needed)
- Tool calls / function calling for API providers
- Image / multimodal support for API providers
- Per-user routing rules
- Cost tracking / token usage dashboards
- Load balancing (round-robin, weighted)
- Admin-configured routing rules per user group
