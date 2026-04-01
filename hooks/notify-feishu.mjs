#!/usr/bin/env node
/**
 * Claude Code Hook → Feishu Notification
 *
 * Sends Claude Code events (tool use, errors, completion) to a Feishu chat.
 *
 * Environment variables (set in Claude Code settings.json env or shell):
 *   FEISHU_APP_ID       — Feishu bot App ID (required)
 *   FEISHU_APP_SECRET   — Feishu bot App Secret (required)
 *   FEISHU_NOTIFY_CHAT  — Target chat_id to send notifications to (required)
 *
 * Claude Code hook environment variables (injected automatically):
 *   CLAUDE_HOOK_EVENT   — Event type (e.g. "PostToolUse", "Stop", etc.)
 *   CLAUDE_TOOL_NAME    — Tool name (for tool-use hooks)
 *   CLAUDE_TOOL_INPUT   — Tool input JSON (for tool-use hooks)
 *   CLAUDE_TOOL_OUTPUT  — Tool output (for PostToolUse)
 *   CLAUDE_SESSION_ID   — Current session ID
 *
 * Usage in Claude Code settings.json:
 *   See README section or INSTALL.md for full configuration example.
 */

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_NOTIFY_CHAT = process.env.FEISHU_NOTIFY_CHAT;

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !FEISHU_NOTIFY_CHAT) {
  // Silently exit — don't break Claude Code if not configured
  process.exit(0);
}

// ── Read hook context from stdin (Claude Code pipes JSON) ──────────────
let stdinData = '';
try {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  stdinData = Buffer.concat(chunks).toString('utf-8');
} catch {
  // stdin may not be available
}

let hookData = {};
try {
  hookData = JSON.parse(stdinData);
} catch {
  // Not JSON — use raw text
  if (stdinData.trim()) {
    hookData = { raw: stdinData.trim() };
  }
}

// ── Also read from env vars (Claude Code sets these) ───────────────────
const hookEvent = hookData.hook_event_name || process.env.CLAUDE_HOOK_EVENT || 'unknown';
const toolName = hookData.tool_name || process.env.CLAUDE_TOOL_NAME || '';
const toolInput = hookData.tool_input || process.env.CLAUDE_TOOL_INPUT || '';
const toolOutput = hookData.tool_output || process.env.CLAUDE_TOOL_OUTPUT || '';
const sessionId = hookData.session_id || process.env.CLAUDE_SESSION_ID || '';

// ── Build notification message ─────────────────────────────────────────
function buildMessage() {
  const lines = [`[Claude Code] ${hookEvent}`];

  if (sessionId) {
    lines.push(`Session: ${sessionId.slice(0, 8)}...`);
  }

  if (toolName) {
    lines.push(`Tool: ${toolName}`);
  }

  if (toolInput) {
    const input = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
    const preview = input.length > 200 ? input.slice(0, 200) + '...' : input;
    lines.push(`Input: ${preview}`);
  }

  if (toolOutput) {
    const output = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
    const preview = output.length > 300 ? output.slice(0, 300) + '...' : output;
    lines.push(`Output: ${preview}`);
  }

  // If we got raw data that wasn't parsed
  if (hookData.raw) {
    const preview = hookData.raw.length > 300 ? hookData.raw.slice(0, 300) + '...' : hookData.raw;
    lines.push(`Data: ${preview}`);
  }

  return lines.join('\n');
}

// ── Get tenant access token ────────────────────────────────────────────
async function getTenantToken() {
  const resp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    },
  );
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Feishu auth failed: ${data.msg}`);
  }
  return data.tenant_access_token;
}

// ── Send message to Feishu chat ────────────────────────────────────────
async function sendToFeishu(text) {
  const token = await getTenantToken();
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: FEISHU_NOTIFY_CHAT,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );
  const data = await resp.json();
  if (data.code !== 0) {
    console.error(`Feishu send failed: ${JSON.stringify(data)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────
try {
  const message = buildMessage();
  await sendToFeishu(message);
} catch (err) {
  // Don't let hook errors break Claude Code
  console.error(`[notify-feishu] ${err.message}`);
}
