import { agentRegistry } from 'atlas-agent';
import {
  CardStateStoreImpl,
  MessageCorrelationStoreImpl,
  SessionManagerImpl,
  CardRenderPipeline,
  CardEngineImpl,
  EngineImpl,
  ToolCardBuilderImpl,
  PermissionCardBuilderImpl,
  PermissionPayloadValidatorImpl,
  FeishuAdapter,
  FeishuChannelSender,
  FeishuCardRenderer,
  DingTalkAdapter,
  DingTalkChannelSender,
  DingTalkCardRenderer,
  DingTalkClientImpl,
  AgentBridge,
  PermissionService,
  CommandRegistryImpl,
  SessionQueue,
  IdleWatcher,
} from 'atlas-gateway';
import type {
  LarkClient,
  ChannelAdapter,
  SenderFactory,
  CardActionEvent,
  DingTalkClient,
  AtlasConfig,
} from 'atlas-gateway';

export type { AtlasConfig };

/**
 * Legacy config shape — still accepted for backward compatibility.
 * Prefer AtlasConfig for new code.
 */
export interface AppConfig {
  feishuAppId?: string;
  feishuAppSecret?: string;
  dingtalkAppKey?: string;
  dingtalkAppSecret?: string;
  dingtalkMode?: 'stream' | 'webhook';
  agentCwd: string;
  agentEnv?: Record<string, string>;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Normalize AppConfig or AtlasConfig into a unified internal shape.
 */
function normalizeConfig(config: AppConfig | AtlasConfig): {
  feishu?: { appId: string; appSecret: string; verificationToken?: string };
  dingtalk?: { appKey: string; appSecret: string; mode: 'stream' | 'webhook' };
  agentCwd: string;
  agentEnv?: Record<string, string>;
  idleTimeoutMs: number;
} {
  // Detect AtlasConfig by checking for 'channels' key
  if ('channels' in config) {
    const c = config as AtlasConfig;
    return {
      feishu: c.channels.feishu,
      dingtalk: c.channels.dingtalk,
      agentCwd: c.agent.cwd,
      agentEnv: c.agent.env,
      idleTimeoutMs: c.idleTimeoutMs,
    };
  }

  // Legacy AppConfig
  const c = config as AppConfig;
  return {
    feishu: c.feishuAppId && c.feishuAppSecret
      ? { appId: c.feishuAppId, appSecret: c.feishuAppSecret }
      : undefined,
    dingtalk: c.dingtalkAppKey && c.dingtalkAppSecret
      ? { appKey: c.dingtalkAppKey, appSecret: c.dingtalkAppSecret, mode: c.dingtalkMode ?? 'webhook' }
      : undefined,
    agentCwd: c.agentCwd,
    agentEnv: c.agentEnv,
    idleTimeoutMs: 10 * 60 * 1000,
  };
}

export function createApp(config: AppConfig | AtlasConfig): App {
  const normalized = normalizeConfig(config);

  // 1. Stores
  const cardStore = new CardStateStoreImpl();
  const correlationStore = new MessageCorrelationStoreImpl(cardStore);
  const sessionManager = new SessionManagerImpl();

  // 2. Adapter registry — maps channelId → adapter
  const adapters = new Map<string, ChannelAdapter>();

  // 3. Renderers
  const feishuRenderer = new FeishuCardRenderer();
  const dingtalkRenderer = new DingTalkCardRenderer();

  // Clients created lazily inside start().
  let larkClient: LarkClient | null = null;
  let dingtalkClient: DingTalkClient | null = null;

  // 4. Channel-aware sender factory
  const senderFactory: SenderFactory = (chatId: string, channelIdHint?: string) => {
    const session = sessionManager.get(chatId);
    const channelId = session?.channelId ?? channelIdHint ?? 'feishu';

    switch (channelId) {
      case 'dingtalk': {
        if (!dingtalkClient) {
          throw new Error('Cannot create DingTalk sender — client not initialised');
        }
        return new DingTalkChannelSender(dingtalkClient, chatId, dingtalkRenderer);
      }
      case 'feishu':
      default: {
        if (!larkClient) {
          throw new Error('Cannot create Feishu sender — larkClient not initialised');
        }
        return new FeishuChannelSender(larkClient, chatId, feishuRenderer);
      }
    }
  };

  // 5. Card render pipeline
  const pipeline = new CardRenderPipeline(
    cardStore,
    feishuRenderer,
    senderFactory,
    correlationStore,
  );

  // 6. Card engine
  const cardEngine = new CardEngineImpl({
    cardStore,
    correlationStore,
    toolCardBuilder: new ToolCardBuilderImpl(),
    permissionCardBuilder: new PermissionCardBuilderImpl(),
  });

  // 7. Session queue + Agent bridge
  const queue = new SessionQueue();
  const bridge = new AgentBridge({
    registry: agentRegistry,
    cardEngine,
    queue,
    agentOpts: { cwd: normalized.agentCwd, env: normalized.agentEnv },
  });

  // 8. Permission service
  const permissionService = new PermissionService({
    validator: new PermissionPayloadValidatorImpl(),
    cardEngine,
    bridge,
  });

  // 9. Command registry
  const commandRegistry = new CommandRegistryImpl();

  // 10. Idle watcher
  const idleWatcher = new IdleWatcher({
    timeoutMs: normalized.idleTimeoutMs,
    onIdle: async (sessionId, chatId) => {
      try {
        const sender = senderFactory(chatId);
        const session = sessionManager.get(chatId);
        const minutes = Math.round(normalized.idleTimeoutMs / 60000);

        if (session) {
          const age = Math.round((Date.now() - session.createdAt) / 60000);
          const preview = session.lastPrompt
            ? session.lastPrompt.length > 60
              ? session.lastPrompt.slice(0, 60) + '...'
              : session.lastPrompt
            : '(no message)';

          await sender.sendCard({
            header: {
              title: `Session Idle — ${minutes} min`,
              icon: '\u{23F3}',
              status: 'waiting',
            },
            sections: [
              {
                type: 'fields',
                fields: [
                  { label: 'Agent', value: session.agentId, short: true },
                  { label: 'Session Age', value: `${age} min`, short: true },
                  { label: 'Last Message', value: preview },
                ],
              },
              { type: 'divider' },
              {
                type: 'markdown',
                content: `Reply \`/takeover ${sessionId}\` to take over.`,
              },
            ],
          });
        } else {
          await sender.sendText(`Session idle for ${minutes} minutes.`);
        }
      } catch (err) {
        console.error(
          JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'IdleWatcher.onIdle notification failed', sessionId, chatId, error: String(err) }),
        );
      }
    },
  });

  // 11. Engine
  const engine = new EngineImpl({
    cardStore,
    correlationStore,
    pipeline,
    cardEngine,
    sessionManager,
    commandRegistry,
    permissionService,
    senderFactory,
    bridge,
    idleWatcher,
    onPrompt: (session, event) => bridge.handlePrompt(session, event),
  });

  const messageHandler = (event: Parameters<typeof engine.handleChannelEvent>[0]) =>
    engine.handleChannelEvent(event);

  return {
    async start() {
      // Restore persisted sessions before adapters start accepting messages
      await engine.start();

      // ── Feishu adapter ──────────────────────────────────────────────
      if (normalized.feishu) {
        const lark = await import('@larksuiteoapi/node-sdk' as string);

        larkClient = new lark.Client({
          appId: normalized.feishu.appId,
          appSecret: normalized.feishu.appSecret,
        }) as unknown as LarkClient;

        const feishuAdapter = new FeishuAdapter({
          config: {
            appId: normalized.feishu.appId,
            appSecret: normalized.feishu.appSecret,
          },
          larkClient,
          wsClientFactory: (appId: string, appSecret: string) =>
            new lark.WSClient({
              appId,
              appSecret,
              loggerLevel: lark.LoggerLevel?.warn,
            }) as any,
          eventDispatcherFactory: (handlers) => {
            const dispatcher = new lark.EventDispatcher({});
            for (const [key, handler] of Object.entries(handlers)) {
              dispatcher.register({ [key]: handler });
            }
            return dispatcher as any;
          },
          onCardAction: (event: CardActionEvent) =>
            engine.handleCardAction(event),
        });

        adapters.set('feishu', feishuAdapter);
        await feishuAdapter.start(messageHandler);
        console.log('[atlas] Feishu adapter started');
      }

      // ── DingTalk adapter ────────────────────────────────────────────
      if (normalized.dingtalk) {
        const httpPost = async (url: string, body: unknown, headers?: Record<string, string>) => {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          });
          const data = await resp.json();
          return { status: resp.status, data };
        };

        dingtalkClient = new DingTalkClientImpl(
          { appKey: normalized.dingtalk.appKey, appSecret: normalized.dingtalk.appSecret },
          httpPost,
        );

        // Provide streamClientFactory when stream mode is configured
        let streamClientFactory: ((appKey: string, appSecret: string) => { start(h: Record<string, (d: unknown) => Promise<unknown>>): Promise<void>; close(): void }) | undefined;
        if (normalized.dingtalk.mode === 'stream') {
          try {
            const sdk = await import('dingtalk-stream' as string);
            streamClientFactory = (appKey: string, appSecret: string) =>
              new sdk.default({ clientId: appKey, clientSecret: appSecret });
          } catch {
            console.warn('[atlas] dingtalk-stream package not installed — falling back to webhook mode. Install with: npm install dingtalk-stream');
          }
        }

        const dingtalkAdapter = new DingTalkAdapter({
          config: {
            appKey: normalized.dingtalk.appKey,
            appSecret: normalized.dingtalk.appSecret,
            mode: normalized.dingtalk.mode,
          },
          client: dingtalkClient,
          streamClientFactory,
          onCardAction: (event: CardActionEvent) =>
            engine.handleCardAction(event),
        });

        adapters.set('dingtalk', dingtalkAdapter);
        await dingtalkAdapter.start(messageHandler);
        console.log('[atlas] DingTalk adapter started');
      }

      const channels = Array.from(adapters.keys()).join(', ') || 'none';
      console.log(`[atlas] Started — active channels: ${channels}`);
    },

    async stop() {
      console.log('[atlas] Shutting down...');
      for (const [id, adapter] of adapters) {
        await adapter.stop();
        console.log(`[atlas] ${id} adapter stopped`);
      }
      await bridge.dispose();
      queue.dispose();
      await engine.stop();
      console.log('[atlas] Stopped');
    },
  };
}
