import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistryImpl, type Command, type CommandContext, type BridgeLike, type SessionManagerLike } from './CommandRegistry.js';
import type { ChannelSender } from '../channel/ChannelSender.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistryImpl;

  beforeEach(() => {
    registry = new CommandRegistryImpl();
  });

  // ── register ────────────────────────────────────────────────────────────

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

  // ── resolve: exact match ────────────────────────────────────────────────

  describe('resolve – exact match', () => {
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

  // ── resolve: case-insensitive ───────────────────────────────────────────

  describe('resolve – case-insensitive', () => {
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
      // Name is stored lowercase
      expect(registry.resolve('/deploy')).not.toBeNull();
      expect(registry.resolve('/DEPLOY')).not.toBeNull();
    });
  });

  // ── resolve: aliases ────────────────────────────────────────────────────

  describe('resolve – aliases', () => {
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

  // ── resolve: prefix matching ────────────────────────────────────────────

  describe('resolve – prefix matching', () => {
    it('should match unambiguous prefix', () => {
      const result = registry.resolve('/he');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('help');
    });

    it('should match single-char unambiguous prefix', () => {
      // /a -> only "agent" starts with "a" (among name prefixes)
      const result = registry.resolve('/ag');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('agent');
    });

    it('should return null for ambiguous prefix', () => {
      // /mo matches both "model" and "mode"
      const result = registry.resolve('/mo');
      expect(result).toBeNull();
    });

    it('should resolve longer unambiguous prefix', () => {
      // /mod -> ambiguous (model, mode)
      expect(registry.resolve('/mod')).toBeNull();

      // /mode -> exact match
      expect(registry.resolve('/mode')).not.toBeNull();
      expect(registry.resolve('/mode')!.command.name).toBe('mode');

      // /model -> exact match
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

  // ── resolve: non-slash input / edge cases ───────────────────────────────

  describe('resolve – non-slash and edge cases', () => {
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

  // ── listCommands ────────────────────────────────────────────────────────

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
      expect(names).toContain('takeover');
      expect(names).toContain('help');
      expect(names).toContain('list');
      expect(commands).toHaveLength(9);
    });

    it('should include custom commands after registration', () => {
      registry.register({
        name: 'deploy',
        description: 'Deploy the app',
        execute: async () => 'ok',
      });
      const names = registry.listCommands().map((c) => c.name);
      expect(names).toContain('deploy');
      expect(names).toHaveLength(10);
    });
  });

  // ── no builtins mode ────────────────────────────────────────────────────

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

  // ── execute: help ─────────────────────────────────────────────────────

  describe('built-in help', () => {
    it('should return a string listing commands', async () => {
      const result = registry.resolve('/help');
      expect(result).not.toBeNull();
      const output = await result!.command.execute('', {} as never);
      expect(typeof output).toBe('string');
      expect(output as string).toContain('Available commands');
    });
  });

  // ── execute: real commands ──────────────────────────────────────────────

  describe('real command implementations', () => {
    function makeContext(overrides?: {
      session?: Record<string, unknown> | undefined | null;
      sessions?: Array<Record<string, unknown>>;
    }): CommandContext {
      const hasSessionOverride = overrides !== undefined && 'session' in overrides;
      const session = hasSessionOverride
        ? overrides.session ?? undefined
        : { sessionId: 's1', chatId: 'chat-1', channelId: 'feishu', agentId: 'claude', model: 'opus', permissionMode: 'auto', createdAt: Date.now() - 60_000 };
      const sessions = overrides?.sessions ?? (session ? [session] : []);

      return {
        chatId: 'chat-1',
        userId: 'user-1',
        sessionManager: {
          get: vi.fn().mockReturnValue(session),
          switchAgent: vi.fn().mockResolvedValue({}),
          setModel: vi.fn(),
          setPermissionMode: vi.fn(),
          destroy: vi.fn().mockResolvedValue(undefined),
          listActive: vi.fn().mockReturnValue(sessions),
        },
        bridge: {
          cancelSession: vi.fn().mockResolvedValue(undefined),
          destroySession: vi.fn().mockResolvedValue(undefined),
        },
        sender: {
          sendText: vi.fn().mockResolvedValue(undefined),
          sendCard: vi.fn().mockResolvedValue(undefined),
          updateCard: vi.fn().mockResolvedValue(undefined),
        } as unknown as ChannelSender,
      };
    }

    it('/cancel calls bridge.cancelSession', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/cancel');
      const output = await result!.command.execute('', ctx);
      expect(ctx.bridge.cancelSession).toHaveBeenCalledWith('s1');
      expect(output).toBe('Task cancelled.');
    });

    it('/cancel with no session', async () => {
      const ctx = makeContext({ session: null });
      const result = registry.resolve('/cancel');
      const output = await result!.command.execute('', ctx);
      expect(output).toBe('No active session to cancel.');
    });

    it('/status returns session info', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Agent: claude');
      expect(output).toContain('Model: opus');
      expect(output).toContain('Mode: auto');
    });

    it('/status with no session', async () => {
      const ctx = makeContext({ session: null });
      const result = registry.resolve('/status');
      const output = await result!.command.execute('', ctx);
      expect(output).toBe('No active session.');
    });

    it('/agent with no args lists current', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/agent');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current agent: claude');
    });

    it('/agent with arg switches agent', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/agent');
      const output = await result!.command.execute('gemini', ctx);
      expect(ctx.bridge.destroySession).toHaveBeenCalledWith('s1');
      expect(ctx.sessionManager.switchAgent).toHaveBeenCalledWith('chat-1', undefined, 'gemini');
      expect(output).toBe('Switched to agent: gemini');
    });

    it('/model with no args shows current', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/model');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current model: opus');
    });

    it('/model with arg sets model', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/model');
      const output = await result!.command.execute('sonnet', ctx);
      expect(ctx.sessionManager.setModel).toHaveBeenCalledWith('chat-1', undefined, 'sonnet');
      expect(output).toBe('Model set to: sonnet');
    });

    it('/mode with no args shows current', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Current mode: auto');
    });

    it('/mode with valid arg sets mode', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('deny', ctx);
      expect(ctx.sessionManager.setPermissionMode).toHaveBeenCalledWith('chat-1', undefined, 'deny');
      expect(output).toBe('Permission mode set to: deny');
    });

    it('/mode with invalid arg returns error', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/mode');
      const output = await result!.command.execute('yolo', ctx);
      expect(output).toContain('Invalid mode');
    });

    it('/new destroys session and bridge', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/new');
      const output = await result!.command.execute('', ctx);
      expect(ctx.bridge.destroySession).toHaveBeenCalledWith('s1');
      expect(ctx.sessionManager.destroy).toHaveBeenCalledWith('chat-1', undefined);
      expect(output).toBe('Session reset.');
    });

    it('/takeover with valid sessionId', async () => {
      const ctx = makeContext({ sessions: [{ sessionId: 'target-s', chatId: 'chat-x', agentId: 'claude' }] });
      const result = registry.resolve('/takeover');
      const output = await result!.command.execute('target-s', ctx);
      expect(ctx.bridge.destroySession).toHaveBeenCalledWith('target-s');
      expect(ctx.sessionManager.destroy).toHaveBeenCalledWith('chat-x', undefined);
      expect(output).toContain('Session taken over');
    });

    it('/takeover with unknown sessionId', async () => {
      const ctx = makeContext({ sessions: [] });
      const result = registry.resolve('/takeover');
      const output = await result!.command.execute('nonexistent', ctx);
      expect(output).toContain('Session not found');
    });

    it('/takeover with no args', async () => {
      const ctx = makeContext();
      const result = registry.resolve('/takeover');
      const output = await result!.command.execute('', ctx);
      expect(output).toContain('Usage');
    });
  });

  // ── prefix match with aliases dedup ─────────────────────────────────────

  describe('prefix match deduplication', () => {
    it('should not double-count a command matched by both name and alias prefix', () => {
      const reg = new CommandRegistryImpl({ registerBuiltins: false });
      reg.register({
        name: 'hello',
        aliases: ['hey'],
        description: 'Greet',
        execute: async () => 'hi',
      });
      // /he matches name "hello" by prefix AND alias "hey" by prefix, but both refer to same command
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
      // /a -> name prefix matches "alpha", alias prefix "aaa" -> alpha, alias prefix "ab" -> beta
      // Two distinct commands -> ambiguous
      expect(reg.resolve('/a')).toBeNull();
    });
  });
});
