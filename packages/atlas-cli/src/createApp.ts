import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { agentRegistry } from 'codelink-agent';
import {
  BindingStoreImpl,
  CardEngineImpl,
  CardRenderPipeline,
  CardStateStoreImpl,
  CommandRegistryImpl,
  DingTalkAdapter,
  DingTalkCardRenderer,
  DingTalkChannelSender,
  DingTalkClientImpl,
  TmuxRuntimeAdapter,
  EngineImpl,
  FeishuAdapter,
  FeishuCardRenderer,
  FeishuChannelSender,
  IdleWatcher,
  MessageCorrelationStoreImpl,
  ExternalRuntimeAdapter,
  PermissionCardBuilderImpl,
  PermissionPayloadValidatorImpl,
  PermissionService,
  RuntimeBridgeImpl,
  RuntimeRegistryImpl,
  RuntimeRouterImpl,
  SessionQueue,
  ToolCardBuilderImpl,
  ManagedRuntimeAdapter,
} from 'codelink-gateway';
import type {
  AtlasConfig,
  CodeLinkConfig,
  CardActionEvent,
  ChannelAdapter,
  DingTalkClient,
  LarkClient,
  RuntimeCapabilities,
  RuntimeSession,
  SenderFactory,
} from 'codelink-gateway';

export type { AtlasConfig, CodeLinkConfig };

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

function normalizeConfig(config: AppConfig | CodeLinkConfig | AtlasConfig): {
  feishu?: { appId: string; appSecret: string; verificationToken?: string };
  dingtalk?: { appKey: string; appSecret: string; mode: 'stream' | 'webhook' };
  agentCwd: string;
  agentEnv?: Record<string, string>;
  defaultAgent: string;
  defaultModel?: string;
  defaultPermissionMode: 'auto' | 'confirm' | 'deny';
  idleTimeoutMs: number;
} {
  if ('channels' in config) {
    const c = config as CodeLinkConfig;
    return {
      feishu: c.channels.feishu,
      dingtalk: c.channels.dingtalk,
      agentCwd: c.agent.cwd,
      agentEnv: c.agent.env,
      defaultAgent: c.agent.defaultAgent,
      defaultModel: c.agent.defaultModel,
      defaultPermissionMode: c.agent.defaultPermissionMode,
      idleTimeoutMs: c.idleTimeoutMs,
    };
  }

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
    defaultAgent: 'claude',
    defaultPermissionMode: 'auto',
    idleTimeoutMs: 10 * 60 * 1000,
  };
}

function defaultCapabilities(overrides?: Partial<RuntimeCapabilities>): RuntimeCapabilities {
  return {
    streaming: true,
    permissionCards: true,
    fileAccess: false,
    imageInput: false,
    terminalOutput: false,
    patchEvents: false,
    ...overrides,
  };
}

export function createApp(config: AppConfig | CodeLinkConfig | AtlasConfig): App {
  const normalized = normalizeConfig(config);

  const cardStore = new CardStateStoreImpl();
  const correlationStore = new MessageCorrelationStoreImpl(cardStore);
  const runtimeRegistry = new RuntimeRegistryImpl();
  const bindingStore = new BindingStoreImpl();
  const runtimeRouter = new RuntimeRouterImpl({ bindingStore, runtimeRegistry });

  const adapters = new Map<string, ChannelAdapter>();
  const feishuRenderer = new FeishuCardRenderer();
  const dingtalkRenderer = new DingTalkCardRenderer();

  let larkClient: LarkClient | null = null;
  let dingtalkClient: DingTalkClient | null = null;
  let httpServer: Server | null = null;

  const senderFactory: SenderFactory = (chatId: string, channelIdHint?: string) => {
    const channelId = channelIdHint
      ?? bindingStore.list().find((binding) => binding.chatId === chatId)?.channelId
      ?? runtimeRegistry.list().find((runtime) => runtime.metadata.lastChatId === chatId)?.metadata.lastChannelId
      ?? 'feishu';

    switch (channelId) {
      case 'dingtalk':
        if (!dingtalkClient) {
          throw new Error('Cannot create DingTalk sender - client not initialised');
        }
        return new DingTalkChannelSender(dingtalkClient, chatId, dingtalkRenderer);
      case 'feishu':
      default:
        if (!larkClient) {
          throw new Error('Cannot create Feishu sender - larkClient not initialised');
        }
        return new FeishuChannelSender(larkClient, chatId, feishuRenderer);
    }
  };

  const pipeline = new CardRenderPipeline(
    cardStore,
    feishuRenderer,
    senderFactory,
    correlationStore,
  );

  const cardEngine = new CardEngineImpl({
    cardStore,
    correlationStore,
    toolCardBuilder: new ToolCardBuilderImpl(),
    permissionCardBuilder: new PermissionCardBuilderImpl(),
  });

  const queue = new SessionQueue();
  const managedAdapter = new ManagedRuntimeAdapter({
    registry: agentRegistry,
    cardEngine,
    queue,
    agentOpts: { cwd: normalized.agentCwd, env: normalized.agentEnv },
    runtimeRegistry,
  });
  const externalAdapter = new ExternalRuntimeAdapter({
    cardEngine,
    runtimeRegistry,
  });
  const tmuxAdapter = new TmuxRuntimeAdapter({
    cardEngine,
    runtimeRegistry,
  });

  const runtimeBridge = new RuntimeBridgeImpl({
    runtimeRegistry,
    adapters: {
      resolve(runtime: RuntimeSession) {
        if (runtime.transport === 'tmux') {
          return tmuxAdapter;
        }
        if (runtime.source === 'external' || runtime.transport === 'bridge') {
          return externalAdapter;
        }
        return managedAdapter;
      },
    },
  });

  const permissionService = new PermissionService({
    validator: new PermissionPayloadValidatorImpl(),
    cardEngine,
    bridge: runtimeBridge,
  });

  const commandRegistry = new CommandRegistryImpl();

  const idleWatcher = new IdleWatcher({
    timeoutMs: normalized.idleTimeoutMs,
    onIdle: async (runtimeId, chatId) => {
      try {
        const runtime = runtimeRegistry.get(runtimeId);
        const sender = senderFactory(chatId, runtime?.metadata.lastChannelId);
        const minutes = Math.round(normalized.idleTimeoutMs / 60000);

        if (runtime) {
          const age = Math.round((Date.now() - runtime.createdAt) / 60000);
          const preview = runtime.metadata.lastPromptPreview ?? '(no message)';

          await sender.sendCard({
            header: {
              title: `Runtime Idle - ${minutes} min`,
              icon: '\u{23F3}',
              status: 'waiting',
            },
            sections: [
              {
                type: 'fields',
                fields: [
                  { label: 'Runtime', value: runtime.displayName ?? runtime.id.slice(0, 8), short: true },
                  { label: 'Provider', value: runtime.provider, short: true },
                  { label: 'Runtime Age', value: `${age} min`, short: true },
                  { label: 'Last Prompt', value: preview },
                ],
              },
              { type: 'divider' },
              {
                type: 'markdown',
                content: `Use \`/attach ${runtime.id.slice(0, 8)}\` to reconnect this thread to the runtime.`,
              },
            ],
          });
          return;
        }

        await sender.sendText(`Runtime idle for ${minutes} minutes.`);
      } catch (err) {
        console.error(
          JSON.stringify({
            time: new Date().toISOString(),
            level: 'error',
            msg: 'IdleWatcher.onIdle notification failed',
            runtimeId,
            chatId,
            error: String(err),
          }),
        );
      }
    },
  });

  const engine = new EngineImpl({
    cardStore,
    correlationStore,
    pipeline,
    cardEngine,
    runtimeRegistry,
    bindingStore,
    runtimeRouter,
    runtimeBridge,
    commandRegistry,
    permissionService,
    senderFactory,
    defaultAgentId: normalized.defaultAgent,
    defaultPermissionMode: normalized.defaultPermissionMode,
    idleWatcher,
  });

  const messageHandler = (event: Parameters<typeof engine.handleChannelEvent>[0]) =>
    engine.handleChannelEvent(event);

  return {
    async start() {
      await engine.start();

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
          onCardAction: (event: CardActionEvent) => engine.handleCardAction(event),
        });

        adapters.set('feishu', feishuAdapter);
        await feishuAdapter.start(messageHandler);
        console.log('[codelink] Feishu adapter started');
      }

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

        let streamClientFactory: ((appKey: string, appSecret: string) => { start(h: Record<string, (d: unknown) => Promise<unknown>>): Promise<void>; close(): void }) | undefined;
        if (normalized.dingtalk.mode === 'stream') {
          try {
            const sdk = await import('dingtalk-stream' as string);
            streamClientFactory = (appKey: string, appSecret: string) =>
              new sdk.default({ clientId: appKey, clientSecret: appSecret });
          } catch {
            console.warn('[codelink] dingtalk-stream package not installed - falling back to webhook mode. Install with: npm install dingtalk-stream');
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
          onCardAction: (event: CardActionEvent) => engine.handleCardAction(event),
        });

        adapters.set('dingtalk', dingtalkAdapter);
        await dingtalkAdapter.start(messageHandler);
        console.log('[codelink] DingTalk adapter started');
      }

      const apiApp = express();
      apiApp.use(express.json());

      apiApp.get('/api/status', (_req, res) => {
        res.json({ ok: true });
      });

      apiApp.post('/api/runtimes/register', async (req, res) => {
        try {
          const {
            runtimeId,
            source,
            provider,
            transport,
            displayName,
            workspaceId,
            projectId,
            resumeHandle,
            capabilities,
            metadata,
          } = req.body ?? {};

          if (!source || !provider || !transport || !displayName) {
            res.status(400).json({ error: 'source, provider, transport, and displayName are required' });
            return;
          }

          const now = Date.now();
          const runtime: RuntimeSession = {
            id: runtimeId ?? randomUUID(),
            source,
            provider,
            transport,
            status: 'idle',
            displayName,
            workspaceId,
            projectId,
            resumeHandle,
            capabilities: defaultCapabilities(capabilities),
            metadata: {
              agentId: normalized.defaultAgent,
              permissionMode: normalized.defaultPermissionMode,
              ...(normalized.defaultModel ? { model: normalized.defaultModel } : {}),
              ...(metadata ?? {}),
            },
            createdAt: now,
            lastActiveAt: now,
          };

          await runtimeRegistry.registerExternal(runtime);
          res.json({
            ok: true,
            runtime: {
              id: runtime.id,
              source: runtime.source,
              provider: runtime.provider,
              transport: runtime.transport,
              displayName: runtime.displayName,
            },
          });
        } catch (err) {
          res.status(500).json({ error: String(err) });
        }
      });

      apiApp.get('/api/runtimes', (req, res) => {
        const source = typeof req.query.source === 'string' ? req.query.source : undefined;
        const runtimes = runtimeRegistry
          .list()
          .filter((runtime) => !source || runtime.source === source)
          .map((runtime) => ({
            id: runtime.id,
            source: runtime.source,
            provider: runtime.provider,
            transport: runtime.transport,
            displayName: runtime.displayName,
            status: runtime.status,
            createdAt: runtime.createdAt,
            lastActiveAt: runtime.lastActiveAt,
            workspaceId: runtime.workspaceId,
            projectId: runtime.projectId,
            resumeHandle: runtime.resumeHandle,
          }));
        res.json(runtimes);
      });

      apiApp.get('/api/runtimes/:runtimeId/inbox', (req, res) => {
        const runtimeId = req.params.runtimeId;
        const runtime = runtimeRegistry.get(runtimeId);
        if (!runtime) {
          res.status(404).json({ error: 'runtime not found' });
          return;
        }

        res.json({
          ok: true,
          items: externalAdapter.drainInbox(runtimeId),
        });
      });

      apiApp.post('/api/runtimes/:runtimeId/events', (req, res) => {
        const runtimeId = req.params.runtimeId;
        const runtime = runtimeRegistry.get(runtimeId);
        if (!runtime) {
          res.status(404).json({ error: 'runtime not found' });
          return;
        }

        const messages = Array.isArray(req.body?.messages)
          ? req.body.messages
          : (req.body?.message ? [req.body.message] : []);

        if (messages.length === 0) {
          res.status(400).json({ error: 'message or messages is required' });
          return;
        }

        for (const message of messages) {
          externalAdapter.ingest(runtime, message, {
            chatId: typeof req.body?.chatId === 'string' ? req.body.chatId : undefined,
          });
        }

        res.json({
          ok: true,
          accepted: messages.length,
        });
      });

      apiApp.delete('/api/runtimes/:runtimeId', async (req, res) => {
        try {
          const runtimeId = req.params.runtimeId;
          const runtime = runtimeRegistry.get(runtimeId);
          if (!runtime) {
            res.json({ ok: false, message: 'not found' });
            return;
          }

          await runtimeBridge.dispose(runtimeId);
          runtimeRegistry.remove(runtimeId);
          for (const binding of bindingStore.list()) {
            if (binding.attachedRuntimeIds.includes(runtimeId)) {
              bindingStore.detach(binding.bindingId, runtimeId);
            }
            if (binding.activeRuntimeId === runtimeId) {
              bindingStore.setActive(binding.bindingId, null);
            }
          }

          res.json({ ok: true });
        } catch (err) {
          res.status(500).json({ error: String(err) });
        }
      });

      const apiPort = parseInt(
        process.env.CODELINK_RUNTIME_API_PORT
          ?? process.env.ATLAS_RUNTIME_API_PORT
          ?? '20263',
        10,
      );
      httpServer = apiApp.listen(apiPort, () => {
        console.log(`[codelink] Runtime API listening on port ${apiPort}`);
      });

      const channels = Array.from(adapters.keys()).join(', ') || 'none';
      console.log(`[codelink] Started - active channels: ${channels}`);
    },

    async stop() {
      console.log('[codelink] Shutting down...');
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
      for (const [id, adapter] of adapters) {
        await adapter.stop();
        console.log(`[codelink] ${id} adapter stopped`);
      }
      for (const runtime of runtimeRegistry.list()) {
        await runtimeBridge.dispose(runtime.id);
      }
      queue.dispose();
      await engine.stop();
      console.log('[codelink] Stopped');
    },
  };
}
