import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistryImpl, type Command, type CommandContext } from './CommandRegistry.js';
import { PairCommand } from './commands/PairCommand.js';
import type { ChannelSender } from '../channel/ChannelSender.js';
import { BindingStoreImpl } from '../runtime/BindingStore.js';
import { RuntimeRegistryImpl } from '../runtime/RuntimeRegistry.js';
import type { RuntimeSession } from '../runtime/RuntimeModels.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistryImpl;

  beforeEach(() => {
    registry = new CommandRegistryImpl();
  });

  describe('register', () => {
    it('should register a custom command', () => {
      const cmd: Command = {
        name: 'deploy',
        description: 'Deploy the app',
        execute: async () => 'deployed',
      };
      registry.register(cmd);
      const result = registry.resolve('/deploy');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('deploy');
    });

    it('should register a command with aliases', () => {
      const cmd: Command = {
        name: 'deploy',
        aliases: ['d', 'dep'],
        description: 'Deploy the app',
        execute: async () => 'deployed',
      };
      registry.register(cmd);
      expect(registry.resolve('/d')!.command.name).toBe('deploy');
      expect(registry.resolve('/dep')!.command.name).toBe('deploy');
    });
  });

  describe('resolve - exact match', () => {
    it('should resolve a built-in command by exact name', () => {
      const result = registry.resolve('/help');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
      expect(result!.args).toBe('');
    });

    it('should resolve with args', () => {
      const result = registry.resolve('/agent claude-3');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('agent');
      expect(result!.args).toBe('claude-3');
    });

    it('should resolve with multiple args', () => {
      const result = registry.resolve('/model gpt-4 --fast');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('model');
      expect(result!.args).toBe('gpt-4 --fast');
    });
  });

  describe('resolve - case-insensitive', () => {
    it('should match regardless of case', () => {
      const result = registry.resolve('/HELP');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should match mixed case', () => {
      const result = registry.resolve('/Help');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should match mixed case for custom command', () => {
      registry.register({
        name: 'Deploy',
        description: 'Deploy the app',
        execute: async () => 'ok',
      });
      expect(registry.resolve('/deploy')).not.toBeNull();
      expect(registry.resolve('/DEPLOY')).not.toBeNull();
    });
  });

  describe('resolve - aliases', () => {
    it('should resolve built-in help by alias "h"', () => {
      const result = registry.resolve('/h');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should resolve built-in help by alias "?"', () => {
      const result = registry.resolve('/?');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should resolve alias case-insensitively', () => {
      const result = registry.resolve('/H');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });
  });

  describe('resolve - prefix matching', () => {
    it('should match unambiguous prefix', () => {
      const result = registry.resolve('/he');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should match single-char unambiguous prefix', () => {
      const result = registry.resolve('/ag');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('agent');
    });

    it('should return null for ambiguous prefix', () => {
      const result = registry.resolve('/mo');
      expect(result).toBeNull();
    });

    it('should resolve longer unambiguous prefix', () => {
      expect(registry.resolve('/mod')).toBeNull();
      expect(registry.resolve('/mode')).not.toBeNull();
      expect(registry.resolve('/mode')!.command.name).toBe('mode');
      expect(registry.resolve('/model')).not.toBeNull();
      expect(registry.resolve('/model')!.command.name).toBe('model');
    });

    it('should pass args through prefix match', () => {
      const result = registry.resolve('/he some args');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
      expect(result!.args).toBe('some args');
    });

    it('should prefix-match case-insensitively', () => {
      const result = registry.resolve('/HE');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });
  });

  describe('resolve - non-slash and edge cases', () => {
    it('should return null for non-slash input', () => {
      expect(registry.resolve('hello')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(registry.resolve('')).toBeNull();
    });

    it('should return null for just a slash', () => {
      expect(registry.resolve('/')).toBeNull();
    });

    it('should return null for unknown command', () => {
      expect(registry.resolve('/unknown')).toBeNull();
    });

    it('should return null for unknown prefix', () => {
      expect(registry.resolve('/xyz')).toBeNull();
    });

    it('should handle leading/trailing whitespace', () => {
      const result = registry.resolve('  /help  ');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });
  });

  describe('listCommands', () => {
    it('should list all built-in commands', () => {
      const commands = registry.listCommands();
      const names = commands.map((c) => c.name);
      expect(names).toContain('agent');
      expect(names).toContain('model');
      expect(names).toContain('mode');
      expect(names).toContain('cancel');
      expect(names).toContain('status');
      expect(names).toContain('new');
      expect(names).toContain('help');
      expect(names).toContain('list');
      expect(names).toContain('attach');
      expect(names).toContain('focus');
      expect(names).toContain('watch');
      expect(names).toContain('unwatch');
      expect(names).toContain('detach');
      expect(names).toContain('sessions');
      expect(names).toContain('destroy');
      expect(names).toContain('tmux');
      expect(names).toContain('discover');
      expect(names).toContain('adopt');
      expect(names).toContain('pair');
      expect(commands).toHaveLength(19);
    });

    it('should include custom commands after registration', () => {
      registry.register({
        name: 'deploy',
        description: 'Deploy the app',
        execute: async () => 'ok',
      });
      const names = registry.listCommands().map((c) => c.name);
      expect(names).toContain('deploy');
      expect(names).toHaveLength(20);
    });
  });

  describe('no builtins mode', () => {
    it('should start empty when registerBuiltins is false', () => {
      const empty = new CommandRegistryImpl({ registerBuiltins: false });
      expect(empty.listCommands()).toHaveLength(0);
      expect(empty.resolve('/help')).toBeNull();
    });

    it('should allow registering commands on empty registry', () => {
      const empty = new CommandRegistryImpl({ registerBuiltins: false });
      empty.register({
        name: 'ping',
        description: 'Pong!',
        execute: async () => 'pong',
      });
      expect(empty.resolve('/ping')!.command.name).toBe('ping');
    });
  });

  describe('built-in help', () => {
    it('should return a string listing commands', async () => {
      const result = registry.resolve('/help');
      expect(result).not.toBeNull();
      const output = await result!.command.execute('', {} as never);
      expect(typeof output).toBe('string');
      expect(output as string).toContain('Available commands');
      expect(output as string).toContain('/focus');
      expect(output as string).toContain('/watch');
      expect(output as string).toContain('/unwatch');
      expect(output as string).toContain('/tmux');
    });
  });

  describe('real command implementations', () => {
    function makeRuntime(overrides?: Partial<RuntimeSession>): RuntimeSession {
      const now = Date.now() - 60_000;
      return {
        id: 'runtime-1',
        source: 'atlas-managed',
        provider: 'claude',
        transport: 'sdk',
        status: 'idle',
        displayName: 'main',
        capabilities: {
          streaming: true,
          permissionCards: true,
          fileAccess: false,
          imageInput: false,
          terminalOutput: false,
          patchEvents: false,
        },
        metadata: {
          model: 'opus',
          permissionMode: 'auto',
        },
        createdAt: now,
        lastActiveAt: now,
        ...overrides,
      };
    }

    async function makeContext(overrides?: {
      runtimes?: RuntimeSession[];
      activeRuntimeId?: string | null;
      attachedRuntimeIds?: string[];
      watchRuntimeId?: string | null;
      watchRuntimeIds?: string[];
      defaultAgentId?: string;
      defaultPermissionMode?: string;
      localRuntimeManager?: {
        startTmuxRuntime: ReturnType<typeof vi.fn>;
        discoverTmuxSessions: ReturnType<typeof vi.fn>;
        adoptTmuxRuntime: ReturnType<typeof vi.fn>;
      };
    }): Promise<CommandContext & {
      runtimeBridge: { cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
      localRuntimeManager: {
        startTmuxRuntime: ReturnType<typeof vi.fn>;
        discoverTmuxSessions: ReturnType<typeof vi.fn>;
        adoptTmuxRuntime: ReturnType<typeof vi.fn>;
      };
    }> {
      const runtimeRegistry = new RuntimeRegistryImpl();
      const bindingStore = new BindingStoreImpl();
      const binding = bindingStore.getOrCreate('feishu', 'chat-1', 'chat-1');
      const runtimes = overrides?.runtimes ?? [makeRuntime()];

      for (const runtime of runtimes) {
        await runtimeRegistry.registerExternal(runtime);
      }

      for (const runtimeId of overrides?.attachedRuntimeIds ?? runtimes.map((runtime) => runtime.id)) {
        bindingStore.attach(binding.bindingId, runtimeId);
      }

      if (overrides?.activeRuntimeId !== undefined) {
        bindingStore.setActive(binding.bindingId, overrides.activeRuntimeId);
      } else if (runtimes[0]) {
        bindingStore.setActive(binding.bindingId, runtimes[0].id);
      }

      if (overrides?.watchRuntimeId !== undefined) {
        bindingStore.setWatching(binding.bindingId, overrides.watchRuntimeId);
      }
      for (const runtimeId of overrides?.watchRuntimeIds ?? []) {
        bindingStore.addWatching(binding.bindingId, runtimeId);
      }

      const runtimeBridge = {
        sendPrompt: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined),
        respondToPermission: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      const localRuntimeManager = overrides?.localRuntimeManager ?? {
        startTmuxRuntime: vi.fn().mockImplementation(async ({
          provider,
          name,
        }: {
          provider: 'claude' | 'codex';
          name: string;
        }) => {
          const sessionName = `codelink-${name || provider}`;
          const runtime: RuntimeSession = makeRuntime({
            id: `runtime-tmux-${provider}-1`,
            displayName: name || `${provider}-tmux`,
            provider,
            source: 'external',
            transport: 'tmux',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
            resumeHandle: { kind: 'tmux-session', value: sessionName },
            metadata: {
              agentId: provider,
              permissionMode: 'auto',
              tmuxSessionName: sessionName,
              tmuxTarget: `${sessionName}:0.0`,
            },
          });
          await runtimeRegistry.registerExternal(runtime);
          return {
            runtime,
            sessionName,
            tmuxTarget: `${sessionName}:0.0`,
          };
        }),
        discoverTmuxSessions: vi.fn().mockResolvedValue([
          { sessionName: 'claude-main', registeredRuntime: null },
          {
            sessionName: 'codex-lab',
            registeredRuntime: {
              id: 'runtime-tmux-codex-existing',
              displayName: 'codex-live',
              provider: 'codex',
              transport: 'tmux',
            },
          },
        ]),
        adoptTmuxRuntime: vi.fn().mockImplementation(async ({
          provider,
          sessionName,
          displayName,
        }: {
          provider: 'claude' | 'codex';
          sessionName: string;
          displayName?: string;
        }) => {
          const runtime: RuntimeSession = makeRuntime({
            id: `runtime-adopt-${provider}-1`,
            displayName: displayName || sessionName,
            provider,
            source: 'external',
            transport: 'tmux',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
            resumeHandle: { kind: 'tmux-session', value: sessionName },
            metadata: {
              agentId: provider,
              permissionMode: 'auto',
              tmuxSessionName: sessionName,
              tmuxTarget: `${sessionName}:0.0`,
              tmuxAdopted: 'true',
            },
          });
          await runtimeRegistry.registerExternal(runtime);
          return {
            runtime,
            sessionName,
            tmuxTarget: `${sessionName}:0.0`,
            reused: false,
          };
        }),
      };

      return {
        binding,
        runtimeRegistry,
        bindingStore,
        runtimeBridge: runtimeBridge as never,
        localRuntimeManager,
        defaultAgentId: overrides?.defaultAgentId,
        defaultPermissionMode: overrides?.defaultPermissionMode,
        sender: {
          sendText: vi.fn().mockResolvedValue(undefined),
          sendCard: vi.fn().mockResolvedValue(undefined),
          updateCard: vi.fn().mockResolvedValue(undefined),
        } as unknown as ChannelSender,
      } as CommandContext & {
        runtimeBridge: { cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
        localRuntimeManager: {
          startTmuxRuntime: ReturnType<typeof vi.fn>;
          discoverTmuxSessions: ReturnType<typeof vi.fn>;
          adoptTmuxRuntime: ReturnType<typeof vi.fn>;
        };
      };
    }

    it('/cancel calls runtimeBridge.cancel', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/cancel');
      const output = await result!.command.execute('', ctx);
      expect(ctx.runtimeBridge.cancel).toHaveBeenCalledWith('runtime-1');
      expect(output).toBe('Task cancelled.');
    });

    it('/cancel with no active runtime', async () => {
      const ctx = await makeContext({ runtimes: [], activeRuntimeId: null, attachedRuntimeIds: [] });
      const result = registry.resolve('/cancel');
      const output = await result!.command.execute('', ctx);
      expect(output).toBe('No active runtime to cancel.');
    });

    it('/status returns runtime info', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Provider: claude');
      expect(output).toContain('Transport: sdk');
      expect(output).toContain('Model: opus');
      expect(output).toContain('Mode: auto');
    });

    it('/status highlights tmux-backed runtimes', async () => {
      const ctx = await makeContext({
        runtimes: [makeRuntime({
          id: 'runtime-tmux-1',
          displayName: 'local-claude',
          source: 'external',
          transport: 'tmux',
          resumeHandle: { kind: 'tmux-session', value: 'atlas-local-claude' },
          capabilities: {
            streaming: true,
            permissionCards: false,
            fileAccess: true,
            imageInput: false,
            terminalOutput: true,
            patchEvents: false,
          },
        })],
      });
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Runtime: local-claude [claude/tmux]');
      expect(output).toContain('Resume: tmux-session atlas-local-claude');
    });

    it('/status includes the watching runtime summary when present', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-sdk-1', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-watch-1',
            displayName: 'lab',
            status: 'running',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-sdk-1',
        watchRuntimeId: 'runtime-watch-1',
      });
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Watching: lab [claude/tmux] - running');
    });

    it('/status includes multiple watching runtimes when present', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-sdk-1', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-watch-1',
            displayName: 'lab',
            status: 'running',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
          makeRuntime({
            id: 'runtime-watch-2',
            displayName: 'ops',
            status: 'idle',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-sdk-1',
        watchRuntimeIds: ['runtime-watch-1', 'runtime-watch-2'],
      });
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Watching: lab [claude/tmux] - running');
      expect(output).toContain('Watching: ops [claude/tmux] - idle');
    });

    it('/status with no active runtime', async () => {
      const ctx = await makeContext({ runtimes: [], activeRuntimeId: null, attachedRuntimeIds: [] });
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toBe('No active runtime.');
    });

    it('/agent with no args lists current provider', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/agent');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current agent: claude');
    });

    it('/agent with arg creates and switches runtime', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/agent');
      const output = await result!.command.execute('gemini', ctx);

      const activeRuntimeId = ctx.binding.activeRuntimeId;
      expect(activeRuntimeId).toBeTruthy();
      expect(activeRuntimeId).not.toBe('runtime-1');
      expect(ctx.runtimeRegistry.get(activeRuntimeId!)).toMatchObject({
        displayName: 'gemini',
        provider: 'gemini',
      });
      expect(output).toBe('Switched to agent: gemini');
    });

    it('/agent codex creates a managed codex runtime', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/agent');
      const output = await result!.command.execute('codex', ctx);

      const activeRuntimeId = ctx.binding.activeRuntimeId;
      expect(activeRuntimeId).toBeTruthy();
      expect(ctx.runtimeRegistry.get(activeRuntimeId!)).toMatchObject({
        displayName: 'codex',
        provider: 'codex',
        transport: 'sdk',
        metadata: expect.objectContaining({
          agentId: 'codex',
        }),
      });
      expect(output).toBe('Switched to agent: codex');
    });

    it('/model with no args shows current', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/model');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current model: opus');
    });

    it('/model with arg sets model', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/model');
      const output = await result!.command.execute('sonnet', ctx);
      expect(ctx.runtimeRegistry.get('runtime-1')?.metadata.model).toBe('sonnet');
      expect(output).toBe('Model set to: sonnet');
    });

    it('/mode with no args shows current', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current mode: auto');
    });

    it('/mode with valid arg sets mode', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('deny', ctx);
      expect(ctx.runtimeRegistry.get('runtime-1')?.metadata.permissionMode).toBe('deny');
      expect(output).toBe('Permission mode set to: deny');
    });

    it('/mode with invalid arg returns error', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('yolo', ctx);
      expect(output).toContain('Invalid mode');
    });

    it('/new creates and switches to a fresh tmux runtime when local tmux management is available', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/new');
      const output = await result!.command.execute('', ctx);
      expect(ctx.localRuntimeManager.startTmuxRuntime).toHaveBeenCalledWith({
        provider: 'claude',
        name: 'main',
        binding: expect.objectContaining({ bindingId: ctx.binding.bindingId }),
        displayName: 'main',
        sessionName: expect.any(String),
      });
      expect(ctx.binding.activeRuntimeId).toBeTruthy();
      expect(ctx.binding.activeRuntimeId).not.toBe('runtime-1');
      expect(ctx.runtimeRegistry.get(ctx.binding.activeRuntimeId!)).toMatchObject({
        displayName: 'main',
        provider: 'claude',
        transport: 'tmux',
      });
      expect(output).toContain('Started new runtime: main [claude/tmux]');
    });

    it('/new honors the configured default agent when provided and uses tmux for codex', async () => {
      const ctx = await makeContext({
        defaultAgentId: 'codex',
        defaultPermissionMode: 'deny',
      });
      const result = registry.resolve('/new');
      const output = await result!.command.execute('', ctx);
      const runtime = ctx.runtimeRegistry.get(ctx.binding.activeRuntimeId!);

      expect(runtime).toMatchObject({
        displayName: 'main',
        provider: 'codex',
        transport: 'tmux',
        metadata: expect.objectContaining({
          agentId: 'codex',
        }),
      });
      expect(output).toContain('Started new runtime: main [codex/tmux]');
    });

    it('/new falls back to a managed runtime when the default agent has no tmux transport', async () => {
      const ctx = await makeContext({
        defaultAgentId: 'gemini',
        defaultPermissionMode: 'deny',
      });
      const result = registry.resolve('/new');
      const output = await result!.command.execute('', ctx);
      const runtime = ctx.runtimeRegistry.get(ctx.binding.activeRuntimeId!);

      expect(ctx.localRuntimeManager.startTmuxRuntime).not.toHaveBeenCalled();
      expect(runtime).toMatchObject({
        displayName: 'main',
        provider: 'gemini',
        transport: 'sdk',
        metadata: expect.objectContaining({
          agentId: 'gemini',
          permissionMode: 'deny',
        }),
      });
      expect(output).toContain('Started new runtime: main');
    });

    it('/attach reports tmux-backed runtime routing', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-sdk-1', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-tmux-1',
            displayName: 'local-claude',
            source: 'external',
            transport: 'tmux',
            resumeHandle: { kind: 'tmux-session', value: 'atlas-local-claude' },
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
      });
      const result = registry.resolve('/attach');
      const output = await result!.command.execute('local-claude', ctx);

      expect(ctx.binding.activeRuntimeId).toBe('runtime-tmux-1');
      expect(output).toContain('Attached to **local-claude** [claude/tmux]');
      expect(output).toContain('tmux-backed runtime');
    });

    it('/attach reports codex tmux runtimes the same way', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({
            id: 'runtime-codex-1',
            displayName: 'codex-local',
            source: 'external',
            provider: 'codex',
            transport: 'tmux',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
      });
      const result = registry.resolve('/attach');
      const output = await result!.command.execute('codex-local', ctx);

      expect(ctx.binding.activeRuntimeId).toBe('runtime-codex-1');
      expect(output).toContain('Attached to **codex-local** [codex/tmux]');
      expect(output).toContain('tmux-backed runtime');
    });

    it('/pair attaches two runtimes, focuses the first, watches the second', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'ops', transport: 'tmux', source: 'external' }),
        ],
      });

      ctx.runtimeRegistry.registerExternal = vi.fn();
      ctx.bindingStore.attach = vi.fn(ctx.bindingStore.attach.bind(ctx.bindingStore));
      ctx.bindingStore.setActive = vi.fn(ctx.bindingStore.setActive.bind(ctx.bindingStore));
      ctx.bindingStore.addWatching = vi.fn(ctx.bindingStore.addWatching.bind(ctx.bindingStore));

      registry.register(PairCommand);
      const result = registry.resolve('/pair main ops');
      const output = await result!.command.execute(result!.args, ctx);

      expect(output).toContain('Active: **main**');
      expect(output).toContain('Watching: **ops**');
      expect(ctx.bindingStore.setActive).toHaveBeenCalledWith(ctx.binding.bindingId, 'runtime-a');
      expect(ctx.bindingStore.addWatching).toHaveBeenCalledWith(ctx.binding.bindingId, 'runtime-b');
    });

    it('/sessions shows provider and transport for attached tmux runtimes', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-sdk-1', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-tmux-1',
            displayName: 'local-claude',
            source: 'external',
            transport: 'tmux',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-tmux-1',
      });
      const result = registry.resolve('/sessions');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('**main** [claude/sdk]');
      expect(output).toContain('**local-claude** [claude/tmux]');
    });

    it('/sessions separates active and watching runtimes', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-b',
            displayName: 'lab',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeId: 'runtime-b',
      });
      const result = registry.resolve('/sessions');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('Active: **main** [claude/sdk]');
      expect(output).toContain('Watching: **lab** [claude/tmux]');
    });

    it('/sessions lists multiple watching runtimes separately', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-b',
            displayName: 'lab',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
          makeRuntime({
            id: 'runtime-c',
            displayName: 'ops',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeIds: ['runtime-b', 'runtime-c'],
      });
      ctx.binding.watchState['runtime-b'] = {
        unreadCount: 2,
        lastStatus: 'running',
        lastSummary: 'npm test failed',
      };
      ctx.binding.watchState['runtime-c'] = {
        unreadCount: 1,
        lastStatus: 'idle',
        lastSummary: 'done',
      };

      const result = registry.resolve('/sessions');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('Watching 1: **ops** [claude/tmux] - unread 1 - idle - done');
      expect(output).toContain('Watching 2: **lab** [claude/tmux] - unread 2 - running - npm test failed');
    });

    it('/sessions shows unread watch state when available', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-b',
            displayName: 'lab',
            status: 'running',
          }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeId: 'runtime-b',
      });
      ctx.binding.watchState['runtime-b'] = {
        unreadCount: 2,
        lastStatus: 'running',
        lastSummary: 'npm test failed',
      };

      const result = registry.resolve('/sessions');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('unread 2');
      expect(output).toContain('npm test failed');
    });

    it('/watch marks a non-active runtime as watching', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
        ],
        activeRuntimeId: 'runtime-a',
      });
      const result = registry.resolve('/watch');
      const output = await result!.command.execute('lab', ctx);

      expect(ctx.binding.activeRuntimeId).toBe('runtime-a');
      expect(ctx.binding.watchRuntimeId).toBe('runtime-b');
      expect(output).toContain('Watching **lab**');
    });

    it('/watch can add multiple watching runtimes without replacing existing ones', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
          makeRuntime({ id: 'runtime-c', displayName: 'ops' }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeIds: ['runtime-b'],
      });
      const result = registry.resolve('/watch');
      const output = await result!.command.execute('ops', ctx);

      expect(ctx.binding.watchRuntimeIds).toEqual(['runtime-c', 'runtime-b']);
      expect(ctx.binding.watchRuntimeId).toBe('runtime-c');
      expect(output).toContain('Watching **ops**');
    });

    it('/watch rejects the active runtime', async () => {
      const ctx = await makeContext({
        runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' })],
        activeRuntimeId: 'runtime-a',
      });
      const result = registry.resolve('/watch');
      const output = await result!.command.execute('main', ctx);

      expect(output).toContain('already the active runtime');
    });

    it('/focus promotes the watching runtime to active and demotes the previous active runtime to watching', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeId: 'runtime-b',
      });
      const result = registry.resolve('/focus');
      const output = await result!.command.execute('lab', ctx);

      expect(ctx.binding.activeRuntimeId).toBe('runtime-b');
      expect(ctx.binding.watchRuntimeId).toBe('runtime-a');
      expect(output).toContain('Focused **lab**');
    });

    it('/focus preserves the other watching runtimes when promoting one of them', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
          makeRuntime({ id: 'runtime-c', displayName: 'ops' }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeIds: ['runtime-b', 'runtime-c'],
      });
      const result = registry.resolve('/focus');
      const output = await result!.command.execute('lab', ctx);

      expect(ctx.binding.activeRuntimeId).toBe('runtime-b');
      expect(ctx.binding.watchRuntimeIds).toEqual(['runtime-a', 'runtime-c']);
      expect(output).toContain('Focused **lab**');
    });

    it('/switch resolves to the focus command', () => {
      const result = registry.resolve('/switch lab');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('focus');
      expect(result!.args).toBe('lab');
    });

    it('/unwatch clears the watching runtime', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeId: 'runtime-b',
      });
      const result = registry.resolve('/unwatch');
      const output = await result!.command.execute('', ctx);

      expect(ctx.binding.watchRuntimeId).toBeNull();
      expect(output).toContain('Stopped watching **lab**');
    });

    it('/unwatch can remove one watching runtime while keeping the others', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({ id: 'runtime-b', displayName: 'lab' }),
          makeRuntime({ id: 'runtime-c', displayName: 'ops' }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeIds: ['runtime-b', 'runtime-c'],
      });
      const result = registry.resolve('/unwatch');
      const output = await result!.command.execute('lab', ctx);

      expect(ctx.binding.watchRuntimeIds).toEqual(['runtime-c']);
      expect(ctx.binding.watchRuntimeId).toBe('runtime-c');
      expect(output).toContain('Stopped watching **lab**');
    });

    it('/list shows tmux transport on bindings and runtimes', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({
            id: 'runtime-tmux-1',
            displayName: 'local-claude',
            source: 'external',
            transport: 'tmux',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
      });
      const result = registry.resolve('/list');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('active: local-claude [claude/tmux]');
      expect(output).toContain('**local-claude** [claude/tmux]');
    });

    it('/list shows the current watching runtime on the binding summary', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-b',
            displayName: 'lab',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeId: 'runtime-b',
      });
      const result = registry.resolve('/list');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('active: main [claude/sdk]');
      expect(output).toContain('watching: lab [claude/tmux]');
    });

    it('/list shows multiple watching runtimes on the binding summary', async () => {
      const ctx = await makeContext({
        runtimes: [
          makeRuntime({ id: 'runtime-a', displayName: 'main' }),
          makeRuntime({
            id: 'runtime-b',
            displayName: 'lab',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
          makeRuntime({
            id: 'runtime-c',
            displayName: 'ops',
            transport: 'tmux',
            source: 'external',
            capabilities: {
              streaming: true,
              permissionCards: false,
              fileAccess: true,
              imageInput: false,
              terminalOutput: true,
              patchEvents: false,
            },
          }),
        ],
        activeRuntimeId: 'runtime-a',
        watchRuntimeIds: ['runtime-b', 'runtime-c'],
      });
      const result = registry.resolve('/list');
      const output = await result!.command.execute('', ctx);

      expect(output).toContain('active: main [claude/sdk]');
      expect(output).toContain('watching: ops [claude/tmux], lab [claude/tmux]');
    });

    it('/tmux starts a tmux-backed runtime from chat and attaches the thread to it', async () => {
      const ctx = await makeContext({
        runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' })],
        activeRuntimeId: 'runtime-a',
      });
      const result = registry.resolve('/tmux');
      const output = await result!.command.execute('feature-lab', ctx);

      expect(ctx.localRuntimeManager.startTmuxRuntime).toHaveBeenCalledWith({
        provider: 'claude',
        name: 'feature-lab',
        binding: expect.objectContaining({ bindingId: ctx.binding.bindingId }),
      });
      expect(ctx.binding.activeRuntimeId).toBe('runtime-tmux-claude-1');
      expect(ctx.runtimeRegistry.get('runtime-tmux-claude-1')).toMatchObject({
        displayName: 'feature-lab',
        provider: 'claude',
        transport: 'tmux',
      });
      expect(output).toContain('Started tmux runtime: feature-lab [claude/tmux]');
      expect(output).toContain('tmux attach -t codelink-feature-lab');
    });

    it('/tmux supports starting a codex tmux runtime from chat', async () => {
      const ctx = await makeContext({
        runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' })],
        activeRuntimeId: 'runtime-a',
      });
      const result = registry.resolve('/tmux');
      const output = await result!.command.execute('--provider codex spec-review', ctx);

      expect(ctx.localRuntimeManager.startTmuxRuntime).toHaveBeenCalledWith({
        provider: 'codex',
        name: 'spec-review',
        binding: expect.objectContaining({ bindingId: ctx.binding.bindingId }),
      });
      expect(ctx.binding.activeRuntimeId).toBe('runtime-tmux-codex-1');
      expect(output).toContain('Started tmux runtime: spec-review [codex/tmux]');
    });

    it('/tmux returns install guidance when tmux is missing locally', async () => {
      const ctx = await makeContext({
        localRuntimeManager: {
          startTmuxRuntime: vi.fn().mockRejectedValue(Object.assign(
            new Error('spawn tmux ENOENT'),
            { code: 'ENOENT' },
          )),
          discoverTmuxSessions: vi.fn(),
          adoptTmuxRuntime: vi.fn(),
        },
      });
      const result = registry.resolve('/tmux');
      const output = await result!.command.execute('feature-lab', ctx);

      expect(output).toContain('tmux is not installed or not reachable');
      expect(output).toContain('brew install tmux');
      expect(output).toContain('apt-get install tmux');
      expect(output).toContain('CODELINK_TMUX_BIN');
    });

    it('/discover lists local tmux sessions and flags registered ones', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/discover');
      const output = await result!.command.execute('', ctx);

      expect(ctx.localRuntimeManager.discoverTmuxSessions).toHaveBeenCalled();
      expect(output).toContain('Local tmux sessions');
      expect(output).toContain('1. claude-main');
      expect(output).toContain('/adopt claude-main');
      expect(output).toContain('2. codex-lab');
      expect(output).toContain('already registered as **codex-live**');
    });

    it('/adopt registers a local tmux session and attaches this thread to it', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/adopt');
      const output = await result!.command.execute('--provider codex codex-lab spec-review', ctx);

      expect(ctx.localRuntimeManager.adoptTmuxRuntime).toHaveBeenCalledWith({
        provider: 'codex',
        sessionName: 'codex-lab',
        displayName: 'spec-review',
        binding: expect.objectContaining({ bindingId: ctx.binding.bindingId }),
      });
      expect(ctx.binding.activeRuntimeId).toBe('runtime-adopt-codex-1');
      expect(output).toContain('Adopted tmux runtime: spec-review [codex/tmux]');
      expect(output).toContain('This thread is now attached to the adopted tmux runtime.');
    });
  });

  describe('prefix match deduplication', () => {
    it('should not double-count a command matched by both name and alias prefix', () => {
      const reg = new CommandRegistryImpl({ registerBuiltins: false });
      reg.register({
        name: 'hello',
        aliases: ['hey'],
        description: 'Greet',
        execute: async () => 'hi',
      });
      const result = reg.resolve('/he');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('hello');
    });

    it('should be ambiguous when prefix matches different commands via aliases', () => {
      const reg = new CommandRegistryImpl({ registerBuiltins: false });
      reg.register({
        name: 'alpha',
        aliases: ['aaa'],
        description: 'Alpha',
        execute: async () => 'a',
      });
      reg.register({
        name: 'beta',
        aliases: ['ab'],
        description: 'Beta',
        execute: async () => 'b',
      });
      expect(reg.resolve('/a')).toBeNull();
    });
  });
});
