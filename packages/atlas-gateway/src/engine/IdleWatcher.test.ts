import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleWatcher } from './IdleWatcher.js';

describe('IdleWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onIdle after timeout', async () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    watcher.touch('s1', 'chat-1');

    // Not yet
    vi.advanceTimersByTime(4999);
    expect(onIdle).not.toHaveBeenCalled();

    // Now
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledWith('s1', 'chat-1');
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('resets timer on re-touch', () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    watcher.touch('s1', 'chat-1');
    vi.advanceTimersByTime(3000);

    // Re-touch resets
    watcher.touch('s1', 'chat-1');
    vi.advanceTimersByTime(3000);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('remove stops the timer', () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    watcher.touch('s1', 'chat-1');
    watcher.remove('s1');

    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('remove is a no-op for unknown session', () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    // Should not throw
    watcher.remove('nonexistent');
  });

  it('dispose clears all timers', () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    watcher.touch('s1', 'chat-1');
    watcher.touch('s2', 'chat-2');

    watcher.dispose();

    vi.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('tracks multiple sessions independently', () => {
    const onIdle = vi.fn().mockResolvedValue(undefined);
    const watcher = new IdleWatcher({ timeoutMs: 5000, onIdle });

    watcher.touch('s1', 'chat-1');
    vi.advanceTimersByTime(2000);
    watcher.touch('s2', 'chat-2');

    // s1 fires at 5000
    vi.advanceTimersByTime(3000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith('s1', 'chat-1');

    // s2 fires at 7000
    vi.advanceTimersByTime(2000);
    expect(onIdle).toHaveBeenCalledTimes(2);
    expect(onIdle).toHaveBeenCalledWith('s2', 'chat-2');
  });
});
