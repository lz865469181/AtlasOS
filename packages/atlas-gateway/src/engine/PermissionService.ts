import type { RuntimeBridgeImpl } from '../runtime/RuntimeBridge.js';
import type { CardActionEvent } from './Engine.js';
import type { PermissionPayloadValidatorImpl } from './PermissionCard.js';
import type { CardEngineImpl } from './CardEngine.js';

export interface PermissionServiceDeps {
  validator: PermissionPayloadValidatorImpl;
  cardEngine: CardEngineImpl;
  bridge: Pick<RuntimeBridgeImpl, 'respondToPermission'>;
}

export class PermissionService {
  private readonly validator: PermissionPayloadValidatorImpl;
  private readonly cardEngine: CardEngineImpl;
  private readonly bridge: Pick<RuntimeBridgeImpl, 'respondToPermission'>;

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
    this.cardEngine.handlePermissionResponse(payload.sessionId, payload);

    const approved = payload.action !== 'deny' && payload.action !== 'abort';
    await this.bridge.respondToPermission(payload.sessionId, payload.requestId, approved);
  }
}
