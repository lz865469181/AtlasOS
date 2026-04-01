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
import type { CardModel } from '../cards/CardModel.js';
import { CardStateStoreImpl } from './CardStateStore.js';
import { MessageCorrelationStoreImpl } from './MessageCorrelationStore.js';
import { ToolCardBuilderImpl } from './ToolCardBuilder.js';
import { PermissionCardBuilderImpl } from './PermissionCard.js';
import type { PermissionActionPayload } from './PermissionCard.js';
import { StreamingStateMachineImpl } from './StreamingStateMachine.js';
import type { StreamingStateMachine } from './StreamingStateMachine.js';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface CardEngine {
  handleMessage(sessionId: string, chatId: string, msg: AgentMessage): void;
  handlePermissionResponse(sessionId: string, payload: PermissionActionPayload): void;
  getStreamingState(sessionId: string): StreamingStateMachine | undefined;
  dispose(sessionId: string): void;
}

export interface CardEngineDeps {
  cardStore: CardStateStoreImpl;
  correlationStore: MessageCorrelationStoreImpl;
  toolCardBuilder: ToolCardBuilderImpl;
  permissionCardBuilder: PermissionCardBuilderImpl;
  /** Factory to create streaming state machines. Allows test injection. */
  createStreamingSM?: () => StreamingStateMachineImpl;
  /** Default agent type used for permission card building. */
  agentType?: 'claude' | 'codex' | 'gemini';
}

// ── Implementation ──────────────────────────────────────────────────────────

export class CardEngineImpl implements CardEngine {
  private cardStore: CardStateStoreImpl;
  private correlationStore: MessageCorrelationStoreImpl;
  private toolCardBuilder: ToolCardBuilderImpl;
  private permissionCardBuilder: PermissionCardBuilderImpl;
  private createStreamingSM: () => StreamingStateMachineImpl;
  private agentType: 'claude' | 'codex' | 'gemini';

  /** sessionId -> StreamingStateMachineImpl */
  private streamingSMs = new Map<string, StreamingStateMachineImpl>();

  /** sessionId -> status card ID */
  private statusCards = new Map<string, string>();

  /** sessionId -> active terminal tool cardId (most recent) */
  private terminalCards = new Map<string, string>();

  /** sessionId -> Map<call_id, cardId> for patch-apply cards */
  private patchCards = new Map<string, Map<string, string>>();

  constructor(deps: CardEngineDeps) {
    this.cardStore = deps.cardStore;
    this.correlationStore = deps.correlationStore;
    this.toolCardBuilder = deps.toolCardBuilder;
    this.permissionCardBuilder = deps.permissionCardBuilder;
    this.createStreamingSM = deps.createStreamingSM ?? (() => new StreamingStateMachineImpl());
    this.agentType = deps.agentType ?? 'claude';
  }

  // ── Public API ──────────────────────────────────────────────────────────

  handleMessage(sessionId: string, chatId: string, msg: AgentMessage): void {
    switch (msg.type) {
      case 'model-output':
        this.handleModelOutput(sessionId, chatId, msg);
        break;
      case 'status':
        this.handleStatus(sessionId, chatId, msg);
        break;
      case 'tool-call':
        this.handleToolCall(sessionId, chatId, msg);
        break;
      case 'tool-result':
        this.handleToolResult(sessionId, msg);
        break;
      case 'permission-request':
        this.handlePermissionRequest(sessionId, chatId, msg);
        break;
      case 'permission-response':
        this.handlePermissionResponseMsg(sessionId, msg);
        break;
      case 'fs-edit':
        this.handleFsEdit(sessionId, chatId, msg);
        break;
      case 'terminal-output':
        this.handleTerminalOutput(sessionId, chatId, msg);
        break;
      case 'event':
        this.handleEvent(sessionId, chatId, msg);
        break;
      case 'token-count':
        this.handleTokenCount(sessionId, msg);
        break;
      case 'exec-approval-request':
        this.handleExecApprovalRequest(sessionId, chatId, msg);
        break;
      case 'patch-apply-begin':
        this.handlePatchApplyBegin(sessionId, chatId, msg);
        break;
      case 'patch-apply-end':
        this.handlePatchApplyEnd(sessionId, msg);
        break;
    }
  }

  handlePermissionResponse(sessionId: string, payload: PermissionActionPayload): void {
    const entry = this.correlationStore.getByPermissionId(sessionId, payload.requestId);
    if (!entry) return;

    const card = this.cardStore.get(entry.cardId);
    if (!card) return;

    // Update card to show which action was selected
    const actionLabel = payload.action === 'approve' || payload.action === 'approve_scoped'
      ? 'Approved' : payload.action === 'deny' ? 'Denied' : 'Aborted';

    this.cardStore.update(entry.cardId, (state) => {
      state.content = {
        ...state.content,
        header: {
          ...state.content.header,
          title: state.content.header?.title ?? 'Permission',
          status: payload.action === 'approve' || payload.action === 'approve_scoped' ? 'done' : 'error',
        },
        actions: undefined, // Remove buttons
      };
      state.metadata['selectedAction'] = actionLabel;
    });

    this.cardStore.transition(entry.cardId, 'completed');
    this.correlationStore.complete(entry.cardId);

    // Resume streaming if approved
    if (payload.action === 'approve' || payload.action === 'approve_scoped') {
      const sm = this.streamingSMs.get(sessionId);
      if (sm && sm.state === 'paused') {
        sm.resume();
      }
    }
  }

  getStreamingState(sessionId: string): StreamingStateMachine | undefined {
    return this.streamingSMs.get(sessionId);
  }

  dispose(sessionId: string): void {
    const sm = this.streamingSMs.get(sessionId);
    if (sm) {
      if (sm.state !== 'completed' && sm.state !== 'cancelled' && sm.state !== 'error') {
        sm.cancel();
      }
      this.streamingSMs.delete(sessionId);
    }
    this.statusCards.delete(sessionId);
    this.terminalCards.delete(sessionId);
    this.patchCards.delete(sessionId);
  }

  // ── Private handlers ──────────────────────────────────────────────────

  private handleModelOutput(sessionId: string, chatId: string, msg: ModelOutputMessage): void {
    console.log(`[CardEngine] handleModelOutput session=${sessionId} hasDelta=${!!msg.textDelta} hasFullText=${!!msg.fullText} deltaLen=${msg.textDelta?.length ?? 0}`);
    let sm = this.streamingSMs.get(sessionId);

    if (!sm) {
      console.log(`[CardEngine] Creating new StreamingSM for session=${sessionId}`);
      sm = this.createStreamingSM();

      // Create a streaming card with a header so Feishu renders it as a proper card
      const cardState = this.cardStore.create(chatId, 'streaming', {
        header: {
          title: 'Thinking...',
          icon: '\u{1F4AD}',
          status: 'running',
        },
        sections: [{ type: 'markdown', content: '' }],
      });
      console.log(`[CardEngine] Created streaming card=${cardState.cardId} for chat=${chatId}`);

      // Wire up flush handler: update card content
      sm.onFlush(async (content, cardId) => {
        const fullText = sm!.buffer.fullContent;
        console.log(`[CardEngine] onFlush card=${cardId} contentLen=${content.length} fullTextLen=${fullText.length}`);
        this.cardStore.update(cardId, (state) => {
          // Replace the markdown section with accumulated text
          state.content = {
            ...state.content,
            sections: [{ type: 'markdown', content: fullText }],
          };
        });
        sm!.onSendComplete();
      });

      sm.start(cardState.cardId);
      this.streamingSMs.set(sessionId, sm);

      // Track in correlation store
      this.correlationStore.create({
        cardId: cardState.cardId,
        messageId: null,
        chatId,
        sessionId,
      });
    }

    // Append the text delta
    const text = msg.textDelta ?? msg.fullText ?? '';
    if (text) {
      sm.append(text);
    }
  }

  private handleStatus(sessionId: string, chatId: string, msg: StatusMessage): void {
    console.log(`[CardEngine] handleStatus session=${sessionId} status=${msg.status}`);
    // When agent goes idle, finish any active streaming state machine
    // so that remaining buffered content is flushed to the card.
    if (msg.status === 'idle' || msg.status === 'stopped') {
      const sm = this.streamingSMs.get(sessionId);
      console.log(`[CardEngine] idle/stopped: SM exists=${!!sm} state=${sm?.state}`);
      if (sm && sm.state !== 'completed' && sm.state !== 'cancelled' && sm.state !== 'error' && sm.state !== 'idle') {
        console.log(`[CardEngine] Calling sm.finish() for session=${sessionId}`);
        const cardId = sm.cardId;
        sm.finish().then(() => {
          // Update the streaming card header to "done" after final flush
          if (cardId) {
            try {
              this.cardStore.update(cardId, (state) => {
                state.content = {
                  ...state.content,
                  header: {
                    title: 'Response',
                    icon: '\u{2705}',
                    status: 'done',
                  },
                };
              });
            } catch { /* card may already be disposed */ }
          }
        }).catch((e) => console.error(`[CardEngine] sm.finish() error:`, e));
        this.streamingSMs.delete(sessionId);
      }
    }

    // Skip status cards with empty body (no detail text) — they provide no useful info
    if (!msg.detail) {
      console.log(`[CardEngine] Skipping status card for status=${msg.status} (no detail)`);
      return;
    }

    const existingCardId = this.statusCards.get(sessionId);

    if (existingCardId) {
      // Update existing status card
      this.cardStore.update(existingCardId, (state) => {
        const headerStatus = msg.status === 'running' ? 'running'
          : msg.status === 'error' ? 'error'
            : msg.status === 'idle' || msg.status === 'stopped' ? 'done'
              : undefined;

        state.content = {
          header: {
            title: `Status: ${msg.status}`,
            icon: '\u{2139}\u{FE0F}',
            status: headerStatus,
          },
          sections: [{ type: 'note' as const, content: msg.detail! }],
        };
        state.metadata['agentStatus'] = msg.status;
      });
    } else {
      // Create new status card
      const headerStatus = msg.status === 'running' ? 'running'
        : msg.status === 'error' ? 'error'
          : msg.status === 'idle' || msg.status === 'stopped' ? 'done'
            : undefined;

      const content: CardModel = {
        header: {
          title: `Status: ${msg.status}`,
          icon: '\u{2139}\u{FE0F}',
          status: headerStatus,
        },
        sections: [{ type: 'note', content: msg.detail! }],
      };

      const cardState = this.cardStore.create(chatId, 'status', content);
      cardState.metadata['agentStatus'] = msg.status;
      this.statusCards.set(sessionId, cardState.cardId);

      this.correlationStore.create({
        cardId: cardState.cardId,
        messageId: null,
        chatId,
        sessionId,
      });
    }
  }

  private handleToolCall(sessionId: string, chatId: string, msg: ToolCallMessage): void {
    // Skip hidden tools
    if (this.toolCardBuilder.isHidden(msg.toolName)) return;

    const cardModel = this.toolCardBuilder.build(msg.toolName, msg.args, undefined, 'running');
    const cardState = this.cardStore.create(chatId, 'tool', cardModel);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
      toolCallId: msg.callId,
    });

    // Track terminal tools for terminal-output appending
    const meta = this.toolCardBuilder.has(msg.toolName);
    if (meta) {
      // Check if this is a terminal-category tool (Bash, shell, etc.)
      // We track the most recent tool card per session for terminal-output
      this.terminalCards.set(sessionId, cardState.cardId);
    }
  }

  private handleToolResult(sessionId: string, msg: ToolResultMessage): void {
    const entry = this.correlationStore.getByToolCallId(sessionId, msg.callId);
    if (!entry) return;

    const resultStr = typeof msg.result === 'string'
      ? msg.result
      : JSON.stringify(msg.result, null, 2);

    this.cardStore.update(entry.cardId, (state) => {
      // Preserve the original header but update status
      state.content = {
        ...state.content,
        header: {
          ...state.content.header,
          title: state.content.header?.title ?? msg.toolName,
          status: 'done',
        },
      };

      // Append result as note if not empty
      if (resultStr) {
        const truncated = resultStr.length > 500
          ? resultStr.slice(0, 500) + '...'
          : resultStr;
        const existingSections = [...state.content.sections];
        existingSections.push({ type: 'divider' });
        existingSections.push({ type: 'note', content: truncated });
        state.content = { ...state.content, sections: existingSections };
      }
    });

    this.cardStore.transition(entry.cardId, 'completed');
    this.correlationStore.complete(entry.cardId);
  }

  private handlePermissionRequest(
    sessionId: string,
    chatId: string,
    msg: PermissionRequestMessage,
  ): void {
    // Pause streaming
    const sm = this.streamingSMs.get(sessionId);
    if (sm && sm.state !== 'paused' && sm.state !== 'completed' && sm.state !== 'cancelled' && sm.state !== 'error' && sm.state !== 'idle') {
      sm.pause('permission');
    }

    // Build permission card
    const cardModel = this.permissionCardBuilder.buildPermissionCard({
      toolName: String((msg.payload as Record<string, unknown>)?.['toolName'] ?? 'unknown'),
      toolCallId: String((msg.payload as Record<string, unknown>)?.['toolCallId'] ?? msg.id),
      sessionId,
      requestId: msg.id,
      agentType: this.agentType,
      description: msg.reason,
    });

    const cardState = this.cardStore.create(chatId, 'permission', cardModel);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
      permissionRequestId: msg.id,
    });
  }

  private handlePermissionResponseMsg(sessionId: string, msg: PermissionResponseMessage): void {
    const entry = this.correlationStore.getByPermissionId(sessionId, msg.id);
    if (!entry) return;

    const actionLabel = msg.approved ? 'Approved' : 'Denied';
    const headerStatus = msg.approved ? 'done' : 'error';

    this.cardStore.update(entry.cardId, (state) => {
      state.content = {
        ...state.content,
        header: {
          ...state.content.header,
          title: state.content.header?.title ?? 'Permission',
          status: headerStatus,
        },
        actions: undefined,
      };
      state.metadata['selectedAction'] = actionLabel;
    });

    this.cardStore.transition(entry.cardId, 'completed');
    this.correlationStore.complete(entry.cardId);

    // Resume streaming if approved
    if (msg.approved) {
      const sm = this.streamingSMs.get(sessionId);
      if (sm && sm.state === 'paused') {
        sm.resume();
      }
    }
  }

  private handleFsEdit(sessionId: string, chatId: string, msg: FsEditMessage): void {
    const sections: CardModel['sections'] = [];

    if (msg.diff) {
      sections.push({ type: 'markdown', content: '```diff\n' + msg.diff + '\n```' });
    } else {
      sections.push({ type: 'note', content: msg.description });
    }

    const content: CardModel = {
      header: {
        title: msg.path ? `Edit: ${msg.path}` : 'File Edit',
        subtitle: msg.path,
        icon: '\u{270F}\u{FE0F}',
        status: 'done',
      },
      sections,
    };

    const cardState = this.cardStore.create(chatId, 'tool', content);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
    });
  }

  private handleTerminalOutput(sessionId: string, chatId: string, msg: TerminalOutputMessage): void {
    const terminalCardId = this.terminalCards.get(sessionId);

    if (terminalCardId) {
      // Append to existing terminal card
      const cardState = this.cardStore.get(terminalCardId);
      if (cardState && cardState.status === 'active') {
        this.cardStore.update(terminalCardId, (state) => {
          // Find existing output section or append new one
          const existingSections = [...state.content.sections];
          const lastSection = existingSections[existingSections.length - 1];

          if (lastSection && lastSection.type === 'markdown' && lastSection.content.startsWith('```\n')) {
            // Append to existing output code block
            const existingContent = lastSection.content.slice(4, -4); // Remove ``` markers
            existingSections[existingSections.length - 1] = {
              type: 'markdown',
              content: '```\n' + existingContent + msg.data + '\n```',
            };
          } else {
            existingSections.push({
              type: 'markdown',
              content: '```\n' + msg.data + '\n```',
            });
          }

          state.content = { ...state.content, sections: existingSections };
        });
        return;
      }
    }

    // No active terminal card; create a standalone one
    const content: CardModel = {
      header: {
        title: 'Terminal Output',
        icon: '\u{1F4BB}',
      },
      sections: [{ type: 'markdown', content: '```\n' + msg.data + '\n```' }],
    };

    const cardState = this.cardStore.create(chatId, 'tool', content);
    this.terminalCards.set(sessionId, cardState.cardId);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
    });
  }

  private handleEvent(sessionId: string, chatId: string, msg: EventMessage): void {
    const payloadStr = msg.payload
      ? (typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload))
      : '';

    const sections: CardModel['sections'] = [];
    if (payloadStr) {
      sections.push({ type: 'note', content: payloadStr });
    }

    const content: CardModel = {
      header: {
        title: `Event: ${msg.name}`,
        icon: '\u{1F4CB}',
      },
      sections,
    };

    const cardState = this.cardStore.create(chatId, 'status', content);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
    });
  }

  private handleTokenCount(sessionId: string, msg: TokenCountMessage): void {
    const statusCardId = this.statusCards.get(sessionId);
    if (!statusCardId) return;

    // Store token count data as metadata on the status card
    this.cardStore.update(statusCardId, (state) => {
      // Merge all token count keys into metadata
      for (const [key, value] of Object.entries(msg)) {
        if (key !== 'type') {
          state.metadata[key] = value;
        }
      }
    });
  }

  private handleExecApprovalRequest(
    sessionId: string,
    chatId: string,
    msg: ExecApprovalRequestMessage,
  ): void {
    // Build a permission card specifically for exec approval
    const cardModel = this.permissionCardBuilder.buildPermissionCard({
      toolName: 'exec',
      toolCallId: msg.call_id,
      sessionId,
      requestId: msg.call_id,
      agentType: this.agentType,
      description: 'Execution approval requested',
    });

    const cardState = this.cardStore.create(chatId, 'permission', cardModel);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
      permissionRequestId: msg.call_id,
    });
  }

  private handlePatchApplyBegin(
    sessionId: string,
    chatId: string,
    msg: PatchApplyBeginMessage,
  ): void {
    // Build a multi-file diff card
    const changeEntries = Object.entries(msg.changes);
    const sections: CardModel['sections'] = [];

    if (changeEntries.length > 0) {
      const fileList = changeEntries.map(([path]) => `- ${path}`).join('\n');
      sections.push({ type: 'markdown', content: fileList });
    } else {
      sections.push({ type: 'note', content: 'Applying patch...' });
    }

    const content: CardModel = {
      header: {
        title: `Patch: ${changeEntries.length} file(s)`,
        icon: '\u{1F529}',
        status: 'running',
      },
      sections,
    };

    const cardState = this.cardStore.create(chatId, 'tool', content);

    this.correlationStore.create({
      cardId: cardState.cardId,
      messageId: null,
      chatId,
      sessionId,
      toolCallId: msg.call_id,
    });

    // Track patch card for patch-apply-end
    let sessionPatches = this.patchCards.get(sessionId);
    if (!sessionPatches) {
      sessionPatches = new Map();
      this.patchCards.set(sessionId, sessionPatches);
    }
    sessionPatches.set(msg.call_id, cardState.cardId);
  }

  private handlePatchApplyEnd(sessionId: string, msg: PatchApplyEndMessage): void {
    const sessionPatches = this.patchCards.get(sessionId);
    const cardId = sessionPatches?.get(msg.call_id);

    if (!cardId) {
      // Fallback: try correlation store by tool call id
      const entry = this.correlationStore.getByToolCallId(sessionId, msg.call_id);
      if (!entry) return;

      this.cardStore.update(entry.cardId, (state) => {
        state.content = {
          ...state.content,
          header: {
            ...state.content.header,
            title: state.content.header?.title ?? 'Patch',
            status: msg.success ? 'done' : 'error',
          },
        };
      });

      this.cardStore.transition(entry.cardId, msg.success ? 'completed' : 'error');
      this.correlationStore.complete(entry.cardId);
      return;
    }

    this.cardStore.update(cardId, (state) => {
      state.content = {
        ...state.content,
        header: {
          ...state.content.header,
          title: state.content.header?.title ?? 'Patch',
          status: msg.success ? 'done' : 'error',
        },
      };

      // Add stdout/stderr if present
      if (msg.stderr) {
        state.content = {
          ...state.content,
          sections: [
            ...state.content.sections,
            { type: 'note', content: msg.stderr },
          ],
        };
      }
    });

    this.cardStore.transition(cardId, msg.success ? 'completed' : 'error');

    // Clean up patch card tracking
    sessionPatches?.delete(msg.call_id);

    // Also complete in correlation store
    const entry = this.correlationStore.getByToolCallId(sessionId, msg.call_id);
    if (entry) {
      this.correlationStore.complete(entry.cardId);
    }
  }
}
