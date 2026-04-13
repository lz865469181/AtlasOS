import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionService } from './PermissionService.js';
import type { CardActionEvent } from './Engine.js';
import type { PermissionPayloadValidatorImpl, PermissionActionPayload } from './PermissionCard.js';
import type { CardEngineImpl } from './CardEngine.js';
import type { RuntimeBridgeImpl } from '../runtime/RuntimeBridge.js';

function makeValidator(overrides?: Partial<PermissionPayloadValidatorImpl>): PermissionPayloadValidatorImpl {
  return {
    validate: vi.fn(),
    createPayload: vi.fn(),
    cleanup: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as PermissionPayloadValidatorImpl;
}

function makeCardEngine(): CardEngineImpl {
  return {
    handleMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    getStreamingState: vi.fn(),
    setReplyTarget: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CardEngineImpl;
}

function makeBridge(): Pick<RuntimeBridgeImpl, 'respondToPermission'> {
  return {
    respondToPermission: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEvent(value: Record<string, unknown> = {}): CardActionEvent {
  return {
    messageId: 'msg-1',
    chatId: 'chat-1',
    userId: 'user-1',
    value,
  };
}

function makePayload(overrides?: Partial<PermissionActionPayload>): PermissionActionPayload {
  return {
    v: 1,
    nonce: '550e8400-e29b-41d4-a716-446655440000',
    iat: Date.now(),
    exp: Date.now() + 300_000,
    action: 'approve',
    sessionId: 'runtime-1',
    requestId: 'req-1',
    toolName: 'Bash',
    toolCallId: 'tc-1',
    agentType: 'claude',
    ...overrides,
  };
}

describe('PermissionService', () => {
  let validator: PermissionPayloadValidatorImpl;
  let cardEngine: CardEngineImpl;
  let bridge: Pick<RuntimeBridgeImpl, 'respondToPermission'>;
  let service: PermissionService;

  beforeEach(() => {
    validator = makeValidator();
    cardEngine = makeCardEngine();
    bridge = makeBridge();
    service = new PermissionService({ validator, cardEngine, bridge });
  });

  it('approve validates, updates card UI, notifies runtime with approved=true', async () => {
    const payload = makePayload({ action: 'approve', requestId: 'req-approve' });
    vi.mocked(validator.validate).mockReturnValue({ ok: true, data: payload });

    const event = makeEvent({ someKey: 'someValue' });
    await service.handleAction(event);

    expect(validator.validate).toHaveBeenCalledWith(event.value);
    expect(cardEngine.handlePermissionResponse).toHaveBeenCalledWith(payload.sessionId, payload);
    expect(bridge.respondToPermission).toHaveBeenCalledWith(
      payload.sessionId,
      'req-approve',
      true,
    );
  });

  it('deny notifies runtime with approved=false', async () => {
    const payload = makePayload({ action: 'deny', requestId: 'req-deny' });
    vi.mocked(validator.validate).mockReturnValue({ ok: true, data: payload });

    await service.handleAction(makeEvent());

    expect(cardEngine.handlePermissionResponse).toHaveBeenCalledWith(payload.sessionId, payload);
    expect(bridge.respondToPermission).toHaveBeenCalledWith(
      payload.sessionId,
      'req-deny',
      false,
    );
  });

  it('approve_scoped notifies runtime with approved=true', async () => {
    const payload = makePayload({
      action: 'approve_scoped',
      requestId: 'req-scoped',
      scope: { type: 'this_tool', toolIdentifier: 'Bash' },
    });
    vi.mocked(validator.validate).mockReturnValue({ ok: true, data: payload });

    await service.handleAction(makeEvent());

    expect(cardEngine.handlePermissionResponse).toHaveBeenCalledWith(payload.sessionId, payload);
    expect(bridge.respondToPermission).toHaveBeenCalledWith(
      payload.sessionId,
      'req-scoped',
      true,
    );
  });

  it('abort notifies runtime with approved=false', async () => {
    const payload = makePayload({ action: 'abort', requestId: 'req-abort' });
    vi.mocked(validator.validate).mockReturnValue({ ok: true, data: payload });

    await service.handleAction(makeEvent());

    expect(cardEngine.handlePermissionResponse).toHaveBeenCalledWith(payload.sessionId, payload);
    expect(bridge.respondToPermission).toHaveBeenCalledWith(
      payload.sessionId,
      'req-abort',
      false,
    );
  });

  it('invalid payload ignores the action', async () => {
    vi.mocked(validator.validate).mockReturnValue({ ok: false, error: 'bad payload' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await service.handleAction(makeEvent({ garbage: true }));

    expect(cardEngine.handlePermissionResponse).not.toHaveBeenCalled();
    expect(bridge.respondToPermission).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[PermissionService] Invalid payload:',
      'bad payload',
    );

    consoleSpy.mockRestore();
  });
});
