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
  AgentBridge,
  PermissionService,
  CommandRegistryImpl,
  SessionQueue,
} from 'atlas-gateway';
import type { LarkClient, SenderFactory, CardActionEvent } from 'atlas-gateway';

export interface AppConfig {
  feishuAppId: string;
  feishuAppSecret: string;
  agentCwd: string;
  agentEnv?: Record<string, string>;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApp(config: AppConfig): App {
  // 1. Stores
  const cardStore = new CardStateStoreImpl();
  const correlationStore = new MessageCorrelationStoreImpl(cardStore);
  const sessionManager = new SessionManagerImpl();

  // 2. Card renderer + sender factory
  const cardRenderer = new FeishuCardRenderer();

  // LarkClient is created lazily inside start() (requires async SDK import).
  let larkClient: LarkClient | null = null;

  const senderFactory: SenderFactory = (chatId: string) => {
    if (!larkClient) {
      throw new Error('Cannot create sender before start() — larkClient not initialised');
    }
    return new FeishuChannelSender(larkClient, chatId, cardRenderer);
  };

  // 3. Card render pipeline
  const pipeline = new CardRenderPipeline(
    cardStore,
    cardRenderer,
    senderFactory,
    correlationStore,
  );

  // 4. Card engine
  const cardEngine = new CardEngineImpl({
    cardStore,
    correlationStore,
    toolCardBuilder: new ToolCardBuilderImpl(),
    permissionCardBuilder: new PermissionCardBuilderImpl(),
  });

  // 5. Session queue + Agent bridge
  const queue = new SessionQueue();
  const bridge = new AgentBridge({
    registry: agentRegistry,
    cardEngine,
    queue,
    agentOpts: { cwd: config.agentCwd, env: config.agentEnv },
  });

  // 6. Permission service
  const permissionService = new PermissionService({
    validator: new PermissionPayloadValidatorImpl(),
    cardEngine,
    bridge,
  });

  // 7. Command registry (registers built-in commands by default)
  const commandRegistry = new CommandRegistryImpl();

  // 8. Engine
  const engine = new EngineImpl({
    cardStore,
    correlationStore,
    pipeline,
    cardEngine,
    sessionManager,
    commandRegistry,
    permissionService,
    senderFactory,
    onPrompt: (session, event) => bridge.handlePrompt(session, event),
  });

  // 9. Feishu adapter (created inside start)
  let adapter: InstanceType<typeof FeishuAdapter> | null = null;

  return {
    async start() {
      // Dynamic import — the Lark SDK is a runtime dependency, not a direct
      // devDependency of atlas-cli.  The types are abstracted behind
      // LarkClient / LarkWSClient interfaces from atlas-gateway.
      const lark = await import('@larksuiteoapi/node-sdk' as string);

      larkClient = new lark.Client({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
      }) as unknown as LarkClient;

      adapter = new FeishuAdapter({
        config: {
          appId: config.feishuAppId,
          appSecret: config.feishuAppSecret,
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

      await engine.start();
      await adapter.start((event) => engine.handleChannelEvent(event));

      console.log('[atlas] Started — listening for Feishu messages');
    },

    async stop() {
      console.log('[atlas] Shutting down...');
      if (adapter) await adapter.stop();
      await bridge.dispose();
      queue.dispose();
      await engine.stop();
      console.log('[atlas] Stopped');
    },
  };
}
