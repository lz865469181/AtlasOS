import type { CardActionEvent } from './Engine.js';
import type { PermissionPayloadValidatorImpl } from './PermissionCard.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { AgentBridge } from './AgentBridge.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PermissionServiceDeps {
  validator: PermissionPayloadValidatorImpl;
  cardEngine: CardEngineImpl;
  bridge: AgentBridge;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class PermissionService {
  private readonly validator: PermissionPayloadValidatorImpl;
  private readonly cardEngine: CardEngineImpl;
  private readonly bridge: AgentBridge;

  constructor(deps: PermissionServiceDeps) {
    this.validator = deps.validator;
    this.cardEngine = deps.cardEngine;
    this.bridge = deps.bridge;
  }

  async handleAction(event: CardActionEvent): Promise<void> {
    const result = this.validator.validate(event.value);
    if (!result.ok) {
      console.error('[PermissionService] Invalid payload:', result.error);
      return;
    }

    const payload = result.data;

    // Update card UI (show approved/denied state)
    this.cardEngine.handlePermissionResponse(payload.sessionId, payload);

    // Notify agent backend
    // 'deny' and 'abort' → approved=false; 'approve' and 'approve_scoped' → approved=true
    const approved = payload.action !== 'deny' && payload.action !== 'abort';
    await this.bridge.respondToPermission(payload.sessionId, payload.requestId, approved);
  }
}
