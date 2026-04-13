import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistryImpl, type Command, type CommandContext } from './CommandRegistry.js';
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
      expect(names).toContain('switch');
      expect(names).toContain('detach');
      expect(names).toContain('sessions');
      expect(names).toContain('destroy');
      expect(commands).toHaveLength(13);
    });

    it('should include custom commands after registration', () => {
      registry.register({
        name: 'deploy',
        description: 'Deploy the app',
        execute: async () => 'ok',
      });
      const names = registry.listCommands().map((c) => c.name);
      expect(names).toContain('deploy');
      expect(names).toHaveLength(14);
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
    }): Promise<CommandContext & { runtimeBridge: { cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } }> {
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

      const runtimeBridge = {
        sendPrompt: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined),
        respondToPermission: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      return {
        binding,
        runtimeRegistry,
        bindingStore,
        runtimeBridge: runtimeBridge as never,
        sender: {
          sendText: vi.fn().mockResolvedValue(undefined),
          sendCard: vi.fn().mockResolvedValue(undefined),
          updateCard: vi.fn().mockResolvedValue(undefined),
        } as unknown as ChannelSender,
      } as CommandContext & { runtimeBridge: { cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } };
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

    it('/new creates and switches to a fresh runtime', async () => {
      const ctx = await makeContext();
      const result = registry.resolve('/new');
      const output = await result!.command.execute('', ctx);
      expect(ctx.binding.activeRuntimeId).toBeTruthy();
      expect(ctx.binding.activeRuntimeId).not.toBe('runtime-1');
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
