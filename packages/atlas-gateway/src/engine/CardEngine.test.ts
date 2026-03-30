import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CardEngineImpl } from './CardEngine.js';
import type { CardEngineDeps } from './CardEngine.js';
import { CardStateStoreImpl } from './CardStateStore.js';
import { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import { ToolCardBuilderImpl } from './ToolCardBuilder.js';
import { PermissionCardBuilderImpl, PermissionPayloadValidatorImpl } from './PermissionCard.js';
import type { PermissionActionPayload } from './PermissionCard.js';
import { StreamingStateMachineImpl } from './StreamingStateMachine.js';
import type {
  AgentMessage,
  ModelOutputMessage,
  StatusMessage,
  ToolCallMessage,
  ToolResultMessage,
  PermissionRequestMessage,
  PermissionResponseMessage,
  FsEditMessage,
  TerminalOutputMessage,
  EventMessage,
  TokenCountMessage,
  ExecApprovalRequestMessage,
  PatchApplyBeginMessage,
  PatchApplyEndMessage,
} from 'atlas-agent';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createDeps(overrides?: Partial<CardEngineDeps>): CardEngineDeps {
  const cardStore = new CardStateStoreImpl({ maxRenderRateMs: 0, coalesceWindowMs: 0 });
  const correlationStore = new MessageCorrelationStoreImpl(cardStore);
  const toolCardBuilder = new ToolCardBuilderImpl();
  const permissionCardBuilder = new PermissionCardBuilderImpl();

  return {
    cardStore,
    correlationStore,
    toolCardBuilder,
    permissionCardBuilder,
    agentType: 'claude',
    ...overrides,
  };
}

const SESSION = 'session-1';
const CHAT = 'chat-1';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CardEngine', () => {
  let deps: CardEngineDeps;
  let engine: CardEngineImpl;

  beforeEach(() => {
    deps = createDeps();
    engine = new CardEngineImpl(deps);
  });

  // ── model-output ────────────────────────────────────────────────────────

  describe('model-output', () => {
    it('creates a streaming card on first model-output', () => {
      const msg: ModelOutputMessage = { type: 'model-output', textDelta: 'Hello' };
      engine.handleMessage(SESSION, CHAT, msg);

      const sm = engine.getStreamingState(SESSION);
      expect(sm).toBeDefined();
      expect(sm!.state).not.toBe('idle');

      // Card should exist in the store
      const card = deps.cardStore.get(sm!.cardId);
      expect(card).toBeDefined();
      expect(card!.type).toBe('streaming');
      expect(card!.chatId).toBe(CHAT);
    });

    it('reuses existing streaming SM for same session', () => {
      const msg1: ModelOutputMessage = { type: 'model-output', textDelta: 'Hello' };
      const msg2: ModelOutputMessage = { type: 'model-output', textDelta: ' World' };

      engine.handleMessage(SESSION, CHAT, msg1);
      const sm1 = engine.getStreamingState(SESSION);

      engine.handleMessage(SESSION, CHAT, msg2);
      const sm2 = engine.getStreamingState(SESSION);

      expect(sm1).toBe(sm2);
    });

    it('appends text delta to the streaming buffer', () => {
      const msg: ModelOutputMessage = { type: 'model-output', textDelta: 'Hello' };
      engine.handleMessage(SESSION, CHAT, msg);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.buffer.fullContent).toBe('Hello');
    });

    it('handles fullText when textDelta is absent', () => {
      const msg: ModelOutputMessage = { type: 'model-output', fullText: 'Complete text' };
      engine.handleMessage(SESSION, CHAT, msg);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.buffer.fullContent).toBe('Complete text');
    });

    it('does not append when both textDelta and fullText are absent', () => {
      const msg: ModelOutputMessage = { type: 'model-output' };
      engine.handleMessage(SESSION, CHAT, msg);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.buffer.fullContent).toBe('');
    });
  });

  // ── status ──────────────────────────────────────────────────────────────

  describe('status', () => {
    it('creates a status card on first status message', () => {
      const msg: StatusMessage = { type: 'status', status: 'running', detail: 'Starting up' };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCard = cards.find((c) => c.type === 'status');
      expect(statusCard).toBeDefined();
      expect(statusCard!.content.header?.title).toBe('Status: running');
      expect(statusCard!.content.header?.status).toBe('running');
      expect(statusCard!.content.sections).toHaveLength(1);
      expect(statusCard!.content.sections[0]).toEqual({ type: 'note', content: 'Starting up' });
    });

    it('updates existing status card on subsequent messages', () => {
      const msg1: StatusMessage = { type: 'status', status: 'running' };
      const msg2: StatusMessage = { type: 'status', status: 'idle', detail: 'Done' };

      engine.handleMessage(SESSION, CHAT, msg1);
      engine.handleMessage(SESSION, CHAT, msg2);

      // Should still only have one status card
      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCards = cards.filter((c) => c.type === 'status');
      expect(statusCards).toHaveLength(1);
      expect(statusCards[0]!.content.header?.title).toBe('Status: idle');
      expect(statusCards[0]!.content.header?.status).toBe('done');
    });

    it('maps error status correctly', () => {
      const msg: StatusMessage = { type: 'status', status: 'error' };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCard = cards.find((c) => c.type === 'status');
      expect(statusCard!.content.header?.status).toBe('error');
    });

    it('creates empty sections when no detail', () => {
      const msg: StatusMessage = { type: 'status', status: 'running' };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCard = cards.find((c) => c.type === 'status');
      expect(statusCard!.content.sections).toHaveLength(0);
    });

    it('stores agentStatus in metadata', () => {
      const msg: StatusMessage = { type: 'status', status: 'running' };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCard = cards.find((c) => c.type === 'status');
      expect(statusCard!.metadata['agentStatus']).toBe('running');
    });
  });

  // ── tool-call ───────────────────────────────────────────────────────────

  describe('tool-call', () => {
    it('creates a tool card with running status', () => {
      const msg: ToolCallMessage = {
        type: 'tool-call',
        toolName: 'Bash',
        args: { command: 'ls -la' },
        callId: 'call-1',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const toolCard = cards.find((c) => c.type === 'tool');
      expect(toolCard).toBeDefined();
      expect(toolCard!.content.header?.status).toBe('running');
    });

    it('registers correlation entry with toolCallId', () => {
      const msg: ToolCallMessage = {
        type: 'tool-call',
        toolName: 'Edit',
        args: { file_path: '/src/foo.ts' },
        callId: 'call-2',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const entry = deps.correlationStore.getByToolCallId(SESSION, 'call-2');
      expect(entry).toBeDefined();
      expect(entry!.sessionId).toBe(SESSION);
      expect(entry!.chatId).toBe(CHAT);
    });
  });

  // ── tool-result ─────────────────────────────────────────────────────────

  describe('tool-result', () => {
    it('updates tool card to completed status', () => {
      // First create a tool call
      const callMsg: ToolCallMessage = {
        type: 'tool-call',
        toolName: 'Bash',
        args: { command: 'echo hi' },
        callId: 'call-r1',
      };
      engine.handleMessage(SESSION, CHAT, callMsg);

      // Then send result
      const resultMsg: ToolResultMessage = {
        type: 'tool-result',
        toolName: 'Bash',
        result: 'hi',
        callId: 'call-r1',
      };
      engine.handleMessage(SESSION, CHAT, resultMsg);

      const entry = deps.correlationStore.getByToolCallId(SESSION, 'call-r1');
      expect(entry).toBeDefined();
      expect(entry!.status).toBe('completed');

      const card = deps.cardStore.get(entry!.cardId);
      expect(card!.status).toBe('completed');
      expect(card!.content.header?.status).toBe('done');
    });

    it('ignores result for unknown callId', () => {
      const msg: ToolResultMessage = {
        type: 'tool-result',
        toolName: 'Bash',
        result: 'output',
        callId: 'unknown-call',
      };
      // Should not throw
      engine.handleMessage(SESSION, CHAT, msg);
    });
  });

  // ── permission-request ──────────────────────────────────────────────────

  describe('permission-request', () => {
    it('creates a permission card with buttons', () => {
      const msg: PermissionRequestMessage = {
        type: 'permission-request',
        id: 'perm-1',
        reason: 'Tool needs approval',
        payload: { toolName: 'Bash', toolCallId: 'tc-1' },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const permCard = cards.find((c) => c.type === 'permission');
      expect(permCard).toBeDefined();
      expect(permCard!.content.header?.status).toBe('waiting');
      expect(permCard!.content.actions).toBeDefined();
      expect(permCard!.content.actions!.length).toBeGreaterThan(0);
    });

    it('registers correlation with permissionRequestId', () => {
      const msg: PermissionRequestMessage = {
        type: 'permission-request',
        id: 'perm-2',
        reason: 'Needs approval',
        payload: { toolName: 'Edit', toolCallId: 'tc-2' },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const entry = deps.correlationStore.getByPermissionId(SESSION, 'perm-2');
      expect(entry).toBeDefined();
      expect(entry!.sessionId).toBe(SESSION);
    });

    it('pauses streaming when active', () => {
      // Start streaming first
      engine.handleMessage(SESSION, CHAT, { type: 'model-output', textDelta: 'Text' } as ModelOutputMessage);
      const sm = engine.getStreamingState(SESSION);
      expect(sm!.state).not.toBe('paused');

      // Now permission request
      const msg: PermissionRequestMessage = {
        type: 'permission-request',
        id: 'perm-3',
        reason: 'Approval needed',
        payload: { toolName: 'Write', toolCallId: 'tc-3' },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      expect(sm!.state).toBe('paused');
      expect(sm!.pauseReason).toBe('permission');
    });
  });

  // ── permission-response ─────────────────────────────────────────────────

  describe('permission-response', () => {
    it('updates permission card and resumes streaming on approve', () => {
      // Start streaming
      engine.handleMessage(SESSION, CHAT, { type: 'model-output', textDelta: 'X' } as ModelOutputMessage);

      // Request permission (pauses streaming)
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-request',
        id: 'perm-4',
        reason: 'Approve?',
        payload: { toolName: 'Bash', toolCallId: 'tc-4' },
      } as PermissionRequestMessage);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.state).toBe('paused');

      // Approve
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-response',
        id: 'perm-4',
        approved: true,
      } as PermissionResponseMessage);

      // Streaming should resume
      expect(sm!.state).not.toBe('paused');

      // Permission card should be completed
      const entry = deps.correlationStore.getByPermissionId(SESSION, 'perm-4');
      expect(entry!.status).toBe('completed');
    });

    it('does not resume streaming on deny', () => {
      // Start streaming
      engine.handleMessage(SESSION, CHAT, { type: 'model-output', textDelta: 'X' } as ModelOutputMessage);

      // Request permission
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-request',
        id: 'perm-5',
        reason: 'Approve?',
        payload: { toolName: 'Write', toolCallId: 'tc-5' },
      } as PermissionRequestMessage);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.state).toBe('paused');

      // Deny
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-response',
        id: 'perm-5',
        approved: false,
      } as PermissionResponseMessage);

      // Streaming should still be paused
      expect(sm!.state).toBe('paused');
    });
  });

  // ── fs-edit ─────────────────────────────────────────────────────────────

  describe('fs-edit', () => {
    it('creates a diff card with diff content', () => {
      const msg: FsEditMessage = {
        type: 'fs-edit',
        description: 'Fix typo',
        diff: '- old line\n+ new line',
        path: '/src/app.ts',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const diffCard = cards.find((c) => c.type === 'tool');
      expect(diffCard).toBeDefined();
      expect(diffCard!.content.header?.title).toBe('Edit: /src/app.ts');
      expect(diffCard!.content.sections[0]).toEqual({
        type: 'markdown',
        content: '```diff\n- old line\n+ new line\n```',
      });
    });

    it('creates a note card when no diff provided', () => {
      const msg: FsEditMessage = {
        type: 'fs-edit',
        description: 'Created new file',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const editCard = cards.find((c) => c.type === 'tool');
      expect(editCard).toBeDefined();
      expect(editCard!.content.header?.title).toBe('File Edit');
      expect(editCard!.content.sections[0]).toEqual({
        type: 'note',
        content: 'Created new file',
      });
    });
  });

  // ── terminal-output ─────────────────────────────────────────────────────

  describe('terminal-output', () => {
    it('creates a terminal card when no active terminal card', () => {
      const msg: TerminalOutputMessage = {
        type: 'terminal-output',
        data: 'line 1\nline 2',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const termCard = cards.find((c) => c.type === 'tool');
      expect(termCard).toBeDefined();
      expect(termCard!.content.header?.title).toBe('Terminal Output');
      expect(termCard!.content.sections[0]).toEqual({
        type: 'markdown',
        content: '```\nline 1\nline 2\n```',
      });
    });

    it('appends to active terminal card created by tool-call', () => {
      // Create a tool card first
      engine.handleMessage(SESSION, CHAT, {
        type: 'tool-call',
        toolName: 'Bash',
        args: { command: 'ls' },
        callId: 'tc-term-1',
      } as ToolCallMessage);

      // Send terminal output
      engine.handleMessage(SESSION, CHAT, {
        type: 'terminal-output',
        data: 'output data',
      } as TerminalOutputMessage);

      // Should have updated the existing tool card (not created a new one)
      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const toolCards = cards.filter((c) => c.type === 'tool');
      expect(toolCards).toHaveLength(1);
    });
  });

  // ── event ───────────────────────────────────────────────────────────────

  describe('event', () => {
    it('creates a note card for events', () => {
      const msg: EventMessage = {
        type: 'event',
        name: 'agent_started',
        payload: { version: '1.0' },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const eventCard = cards.find((c) => c.type === 'status');
      expect(eventCard).toBeDefined();
      expect(eventCard!.content.header?.title).toBe('Event: agent_started');
      expect(eventCard!.content.sections[0]).toEqual({
        type: 'note',
        content: '{"version":"1.0"}',
      });
    });

    it('creates card with empty sections for null payload', () => {
      const msg: EventMessage = {
        type: 'event',
        name: 'ping',
        payload: null,
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const eventCard = cards.find((c) => c.type === 'status');
      expect(eventCard).toBeDefined();
      expect(eventCard!.content.sections).toHaveLength(0);
    });
  });

  // ── token-count ─────────────────────────────────────────────────────────

  describe('token-count', () => {
    it('updates status card metadata with token counts', () => {
      // First create a status card
      engine.handleMessage(SESSION, CHAT, {
        type: 'status',
        status: 'running',
      } as StatusMessage);

      // Then send token count
      const msg: TokenCountMessage = {
        type: 'token-count',
        inputTokens: 1000,
        outputTokens: 500,
        contextPercentage: 42,
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const statusCard = cards.find((c) => c.type === 'status');
      expect(statusCard!.metadata['inputTokens']).toBe(1000);
      expect(statusCard!.metadata['outputTokens']).toBe(500);
      expect(statusCard!.metadata['contextPercentage']).toBe(42);
    });

    it('ignores token-count when no status card exists', () => {
      const msg: TokenCountMessage = {
        type: 'token-count',
        inputTokens: 100,
      };
      // Should not throw
      engine.handleMessage(SESSION, CHAT, msg);
    });
  });

  // ── exec-approval-request ───────────────────────────────────────────────

  describe('exec-approval-request', () => {
    it('creates a permission card for exec approval', () => {
      const msg: ExecApprovalRequestMessage = {
        type: 'exec-approval-request',
        call_id: 'exec-1',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const permCard = cards.find((c) => c.type === 'permission');
      expect(permCard).toBeDefined();
      expect(permCard!.content.header?.status).toBe('waiting');
      expect(permCard!.content.actions).toBeDefined();
    });

    it('registers correlation with permissionRequestId', () => {
      const msg: ExecApprovalRequestMessage = {
        type: 'exec-approval-request',
        call_id: 'exec-2',
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const entry = deps.correlationStore.getByPermissionId(SESSION, 'exec-2');
      expect(entry).toBeDefined();
    });
  });

  // ── patch-apply-begin ───────────────────────────────────────────────────

  describe('patch-apply-begin', () => {
    it('creates a multi-file diff card', () => {
      const msg: PatchApplyBeginMessage = {
        type: 'patch-apply-begin',
        call_id: 'patch-1',
        changes: {
          '/src/a.ts': { action: 'modify' },
          '/src/b.ts': { action: 'create' },
        },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const cards = deps.cardStore.getActiveByChatId(CHAT);
      const patchCard = cards.find((c) => c.type === 'tool');
      expect(patchCard).toBeDefined();
      expect(patchCard!.content.header?.title).toBe('Patch: 2 file(s)');
      expect(patchCard!.content.header?.status).toBe('running');
    });

    it('registers correlation with toolCallId', () => {
      const msg: PatchApplyBeginMessage = {
        type: 'patch-apply-begin',
        call_id: 'patch-2',
        changes: { '/src/c.ts': {} },
      };
      engine.handleMessage(SESSION, CHAT, msg);

      const entry = deps.correlationStore.getByToolCallId(SESSION, 'patch-2');
      expect(entry).toBeDefined();
    });
  });

  // ── patch-apply-end ─────────────────────────────────────────────────────

  describe('patch-apply-end', () => {
    it('updates patch card to done on success', () => {
      // Begin
      engine.handleMessage(SESSION, CHAT, {
        type: 'patch-apply-begin',
        call_id: 'patch-e1',
        changes: { '/src/x.ts': {} },
      } as PatchApplyBeginMessage);

      // End with success
      engine.handleMessage(SESSION, CHAT, {
        type: 'patch-apply-end',
        call_id: 'patch-e1',
        success: true,
      } as PatchApplyEndMessage);

      const entry = deps.correlationStore.getByToolCallId(SESSION, 'patch-e1');
      expect(entry!.status).toBe('completed');

      const card = deps.cardStore.get(entry!.cardId);
      expect(card!.content.header?.status).toBe('done');
      expect(card!.status).toBe('completed');
    });

    it('updates patch card to error on failure', () => {
      // Begin
      engine.handleMessage(SESSION, CHAT, {
        type: 'patch-apply-begin',
        call_id: 'patch-e2',
        changes: { '/src/y.ts': {} },
      } as PatchApplyBeginMessage);

      // End with failure
      engine.handleMessage(SESSION, CHAT, {
        type: 'patch-apply-end',
        call_id: 'patch-e2',
        success: false,
        stderr: 'patch failed',
      } as PatchApplyEndMessage);

      const entry = deps.correlationStore.getByToolCallId(SESSION, 'patch-e2');
      const card = deps.cardStore.get(entry!.cardId);
      expect(card!.content.header?.status).toBe('error');
      expect(card!.status).toBe('error');
    });

    it('ignores patch-apply-end for unknown call_id', () => {
      // Should not throw
      engine.handleMessage(SESSION, CHAT, {
        type: 'patch-apply-end',
        call_id: 'unknown-patch',
        success: true,
      } as PatchApplyEndMessage);
    });
  });

  // ── handlePermissionResponse (public API) ──────────────────────────────

  describe('handlePermissionResponse', () => {
    it('updates permission card and completes correlation', () => {
      // Create permission card
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-request',
        id: 'perm-hr-1',
        reason: 'Needs approval',
        payload: { toolName: 'Bash', toolCallId: 'tc-hr-1' },
      } as PermissionRequestMessage);

      const validator = new PermissionPayloadValidatorImpl();
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: SESSION,
        requestId: 'perm-hr-1',
        toolName: 'Bash',
        toolCallId: 'tc-hr-1',
        agentType: 'claude',
      });

      engine.handlePermissionResponse(SESSION, payload);

      const entry = deps.correlationStore.getByPermissionId(SESSION, 'perm-hr-1');
      expect(entry!.status).toBe('completed');

      const card = deps.cardStore.get(entry!.cardId);
      expect(card!.status).toBe('completed');
      expect(card!.content.header?.status).toBe('done');
      expect(card!.content.actions).toBeUndefined();
      expect(card!.metadata['selectedAction']).toBe('Approved');
    });

    it('marks as denied and does not resume streaming', () => {
      // Start streaming
      engine.handleMessage(SESSION, CHAT, {
        type: 'model-output',
        textDelta: 'content',
      } as ModelOutputMessage);

      // Permission request (pauses streaming)
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-request',
        id: 'perm-hr-2',
        reason: 'Approve?',
        payload: { toolName: 'Write', toolCallId: 'tc-hr-2' },
      } as PermissionRequestMessage);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.state).toBe('paused');

      const validator = new PermissionPayloadValidatorImpl();
      const payload = validator.createPayload({
        action: 'deny',
        sessionId: SESSION,
        requestId: 'perm-hr-2',
        toolName: 'Write',
        toolCallId: 'tc-hr-2',
        agentType: 'claude',
      });

      engine.handlePermissionResponse(SESSION, payload);

      expect(sm!.state).toBe('paused');
      const entry = deps.correlationStore.getByPermissionId(SESSION, 'perm-hr-2');
      expect(entry!.status).toBe('completed');
      const card = deps.cardStore.get(entry!.cardId);
      expect(card!.metadata['selectedAction']).toBe('Denied');
    });

    it('resumes streaming on approve', () => {
      // Start streaming
      engine.handleMessage(SESSION, CHAT, {
        type: 'model-output',
        textDelta: 'text',
      } as ModelOutputMessage);

      // Permission request (pauses)
      engine.handleMessage(SESSION, CHAT, {
        type: 'permission-request',
        id: 'perm-hr-3',
        reason: 'Approve?',
        payload: { toolName: 'Bash', toolCallId: 'tc-hr-3' },
      } as PermissionRequestMessage);

      const sm = engine.getStreamingState(SESSION);
      expect(sm!.state).toBe('paused');

      const validator = new PermissionPayloadValidatorImpl();
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: SESSION,
        requestId: 'perm-hr-3',
        toolName: 'Bash',
        toolCallId: 'tc-hr-3',
        agentType: 'claude',
      });

      engine.handlePermissionResponse(SESSION, payload);
      expect(sm!.state).not.toBe('paused');
    });
  });

  // ── dispose ─────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('cancels streaming and clears session data', () => {
      // Create some state
      engine.handleMessage(SESSION, CHAT, {
        type: 'model-output',
        textDelta: 'hello',
      } as ModelOutputMessage);

      engine.handleMessage(SESSION, CHAT, {
        type: 'status',
        status: 'running',
      } as StatusMessage);

      const sm = engine.getStreamingState(SESSION);
      expect(sm).toBeDefined();

      engine.dispose(SESSION);

      expect(engine.getStreamingState(SESSION)).toBeUndefined();
      expect(sm!.state).toBe('cancelled');
    });

    it('is safe to call on non-existent session', () => {
      // Should not throw
      engine.dispose('nonexistent');
    });
  });

  // ── All 13 message types routed ───────────────────────────────────────

  describe('all 13 message types routed', () => {
    const messages: AgentMessage[] = [
      { type: 'model-output', textDelta: 'hi' },
      { type: 'status', status: 'running' },
      { type: 'tool-call', toolName: 'Bash', args: {}, callId: 'c1' },
      { type: 'tool-result', toolName: 'Bash', result: '', callId: 'c1' },
      { type: 'permission-request', id: 'p1', reason: 'r', payload: { toolName: 'Bash', toolCallId: 'tc1' } },
      { type: 'permission-response', id: 'p1', approved: true },
      { type: 'fs-edit', description: 'edit', diff: '+a' },
      { type: 'terminal-output', data: 'output' },
      { type: 'event', name: 'e', payload: null },
      { type: 'token-count', inputTokens: 1 },
      { type: 'exec-approval-request', call_id: 'ea1' },
      { type: 'patch-apply-begin', call_id: 'pa1', changes: {} },
      { type: 'patch-apply-end', call_id: 'pa1', success: true },
    ];

    for (const msg of messages) {
      it(`handles "${msg.type}" without throwing`, () => {
        expect(() => engine.handleMessage(SESSION, CHAT, msg)).not.toThrow();
      });
    }
  });
});
