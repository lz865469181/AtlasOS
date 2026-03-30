import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StreamBuffer,
  StreamingStateMachineImpl,
  type StreamingState,
  type FlushHandler,
} from './StreamingStateMachine.js';

// ── StreamBuffer tests ─────────────────────────────────────────────────────

describe('StreamBuffer', () => {
  it('should start empty', () => {
    const buf = new StreamBuffer();
    expect(buf.size).toBe(0);
    expect(buf.hasContent).toBe(false);
    expect(buf.pressure).toBe('normal');
  });

  it('should append text and track byte size', () => {
    const buf = new StreamBuffer();
    buf.append('hello');
    expect(buf.size).toBe(5);
    expect(buf.hasContent).toBe(true);
  });

  it('should handle UTF-8 multi-byte characters correctly', () => {
    const buf = new StreamBuffer();
    // Chinese character: 3 bytes each in UTF-8
    buf.append('\u4f60\u597d'); // 你好 = 6 bytes
    expect(buf.size).toBe(6);
  });

  it('should flush and reset buffer', () => {
    const buf = new StreamBuffer();
    buf.append('hello ');
    buf.append('world');
    const content = buf.flush();
    expect(content).toBe('hello world');
    expect(buf.size).toBe(0);
    expect(buf.hasContent).toBe(false);
  });

  it('should return empty string on flush when empty', () => {
    const buf = new StreamBuffer();
    expect(buf.flush()).toBe('');
  });

  it('should signal high pressure when exceeding highWaterMark', () => {
    const buf = new StreamBuffer({
      maxBufferBytes: 100,
      highWaterMark: 50,
      lowWaterMark: 10,
      truncationStrategy: 'tail',
    });

    // Fill to just below high water mark
    buf.append('x'.repeat(49));
    expect(buf.pressure).toBe('normal');

    // Cross high water mark
    buf.append('xx');
    expect(buf.pressure).toBe('high');
  });

  it('should truncate when exceeding maxBufferBytes', () => {
    const buf = new StreamBuffer({
      maxBufferBytes: 100,
      highWaterMark: 75,
      lowWaterMark: 25,
      truncationStrategy: 'tail',
    });

    // Fill beyond max
    buf.append('A'.repeat(50));
    buf.append('B'.repeat(60)); // total 110 > 100

    expect(buf.pressure).toBe('truncated');
    expect(buf.size).toBeLessThanOrEqual(100);

    const content = buf.flush();
    expect(content).toContain('... (truncated)\n');
    // Should keep tail (most recent content)
    expect(content).toContain('B');
  });

  it('should keep most recent content on truncation (tail strategy)', () => {
    const buf = new StreamBuffer({
      maxBufferBytes: 50,
      highWaterMark: 40,
      lowWaterMark: 10,
      truncationStrategy: 'tail',
    });

    buf.append('OLD_DATA_'.repeat(5)); // 45 bytes
    buf.append('NEWDATA'); // pushes over 50

    const content = buf.flush();
    // The tail should have the new data
    expect(content).toContain('NEWDATA');
    expect(content.startsWith('... (truncated)\n')).toBe(true);
  });

  it('should return normal pressure after flush even if previously truncated', () => {
    const buf = new StreamBuffer({
      maxBufferBytes: 50,
      highWaterMark: 40,
      lowWaterMark: 10,
      truncationStrategy: 'tail',
    });

    buf.append('x'.repeat(60));
    expect(buf.pressure).toBe('truncated');

    buf.flush();
    expect(buf.pressure).toBe('normal');
  });

  it('should track fullContent across multiple appends and flushes', () => {
    const buf = new StreamBuffer();
    buf.append('hello ');
    buf.flush();
    buf.append('world');
    expect(buf.fullContent).toBe('hello world');
  });

  it('should clear everything including history', () => {
    const buf = new StreamBuffer();
    buf.append('hello');
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.fullContent).toBe('');
  });

  it('should return current pressure from append', () => {
    const buf = new StreamBuffer({
      maxBufferBytes: 100,
      highWaterMark: 50,
      lowWaterMark: 10,
      truncationStrategy: 'tail',
    });

    expect(buf.append('x'.repeat(30))).toBe('normal');
    expect(buf.append('x'.repeat(25))).toBe('high');
  });

  it('should handle appending empty string', () => {
    const buf = new StreamBuffer();
    const pressure = buf.append('');
    expect(pressure).toBe('normal');
    expect(buf.size).toBe(0);
  });

  it('should throw if highWaterMark >= maxBufferBytes', () => {
    expect(() => new StreamBuffer({
      maxBufferBytes: 100,
      highWaterMark: 100,
      lowWaterMark: 10,
      truncationStrategy: 'tail',
    })).toThrow('highWaterMark must be less than maxBufferBytes');
  });

  it('should throw if lowWaterMark >= highWaterMark', () => {
    expect(() => new StreamBuffer({
      maxBufferBytes: 100,
      highWaterMark: 50,
      lowWaterMark: 50,
      truncationStrategy: 'tail',
    })).toThrow('lowWaterMark must be less than highWaterMark');
  });
});

// ── StreamingStateMachineImpl tests ────────────────────────────────────────

describe('StreamingStateMachineImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createSM(config?: { throttleMs?: number; buffer?: Record<string, unknown> }) {
    return new StreamingStateMachineImpl({
      throttleMs: config?.throttleMs ?? 300,
      buffer: config?.buffer as any,
    });
  }

  // ── Basic lifecycle ──

  describe('basic lifecycle', () => {
    it('should start in idle state', () => {
      const sm = createSM();
      expect(sm.state).toBe('idle');
      expect(sm.cardId).toBe('');
    });

    it('should transition to buffering on start', () => {
      const sm = createSM();
      sm.start('card-1');
      expect(sm.state).toBe('buffering');
      expect(sm.cardId).toBe('card-1');
    });

    it('should throw on start when not idle', () => {
      const sm = createSM();
      sm.start('card-1');
      expect(() => sm.start('card-2')).toThrow('Cannot start in state "buffering"');
    });

    it('should throw on append when idle', () => {
      const sm = createSM();
      expect(() => sm.append('text')).toThrow('Cannot append in idle state');
    });
  });

  // ── State change events ──

  describe('state change events', () => {
    it('should fire onStateChange handlers', () => {
      const sm = createSM();
      const changes: Array<[StreamingState, StreamingState]> = [];
      sm.onStateChange((from, to) => changes.push([from, to]));

      sm.start('card-1');
      expect(changes).toEqual([['idle', 'buffering']]);
    });

    it('should support multiple state change handlers', () => {
      const sm = createSM();
      const h1 = vi.fn();
      const h2 = vi.fn();
      sm.onStateChange(h1);
      sm.onStateChange(h2);

      sm.start('card-1');
      expect(h1).toHaveBeenCalledWith('idle', 'buffering');
      expect(h2).toHaveBeenCalledWith('idle', 'buffering');
    });
  });

  // ── Throttled flushing ──

  describe('throttled flushing', () => {
    it('should flush after throttle interval in buffering state', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('hello');

      // Not yet
      expect(flushHandler).not.toHaveBeenCalled();

      // Advance past throttle
      vi.advanceTimersByTime(300);

      expect(flushHandler).toHaveBeenCalledTimes(1);
      expect(flushHandler).toHaveBeenCalledWith('hello', 'card-1');
      expect(sm.state).toBe('sending');
    });

    it('should accumulate text between flushes', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('he');
      sm.append('llo');

      vi.advanceTimersByTime(300);

      expect(flushHandler).toHaveBeenCalledWith('hello', 'card-1');
    });

    it('should not flush if buffer is empty when timer fires', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      // No append — nothing to flush

      vi.advanceTimersByTime(300);

      expect(flushHandler).not.toHaveBeenCalled();
      expect(sm.state).toBe('buffering');
    });

    it('should restart throttle timer when no content on tick', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');

      // First tick — no content
      vi.advanceTimersByTime(300);
      expect(flushHandler).not.toHaveBeenCalled();

      // Now add content
      sm.append('hello');

      // Second tick
      vi.advanceTimersByTime(300);
      expect(flushHandler).toHaveBeenCalledWith('hello', 'card-1');
    });
  });

  // ── SENDING state and back-pressure ──

  describe('sending state', () => {
    it('should buffer new text while sending', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('first');
      vi.advanceTimersByTime(300);

      expect(sm.state).toBe('sending');

      // Append while sending
      sm.append(' second');

      // Complete the send
      sm.onSendComplete();
      expect(sm.state).toBe('buffering');

      // The new content should trigger flush after throttle
      vi.advanceTimersByTime(300);
      expect(flushHandler).toHaveBeenCalledTimes(2);
      expect(flushHandler).toHaveBeenLastCalledWith(' second', 'card-1');
    });

    it('should transition to buffering with timer when send completes with empty buffer', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(300);

      sm.onSendComplete();
      expect(sm.state).toBe('buffering');

      // Timer should be running for future content
      sm.append('more');
      vi.advanceTimersByTime(300);
      expect(flushHandler).toHaveBeenCalledTimes(2);
    });

    it('should flush immediately on send complete when high pressure pending', () => {
      const sm = createSM({
        throttleMs: 300,
        buffer: {
          maxBufferBytes: 100,
          highWaterMark: 20,
          lowWaterMark: 5,
        },
      });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('init');
      vi.advanceTimersByTime(300); // -> SENDING
      expect(sm.state).toBe('sending');

      // Append enough to trigger high pressure while sending
      sm.append('x'.repeat(25)); // > 20 high water mark

      // Complete send — should immediately re-flush, no throttle wait
      sm.onSendComplete();
      expect(sm.state).toBe('sending'); // went straight to sending again
      expect(flushHandler).toHaveBeenCalledTimes(2);
    });
  });

  // ── High pressure in BUFFERING state ──

  describe('high pressure in buffering', () => {
    it('should flush immediately when high water mark hit in buffering', () => {
      const sm = createSM({
        throttleMs: 300,
        buffer: {
          maxBufferBytes: 100,
          highWaterMark: 20,
          lowWaterMark: 5,
        },
      });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      // Append enough to cross high water mark
      sm.append('x'.repeat(25));

      // Should flush immediately, not wait for throttle
      expect(flushHandler).toHaveBeenCalledTimes(1);
      expect(sm.state).toBe('sending');
    });
  });

  // ── PAUSED state ──

  describe('paused state', () => {
    it('should transition to paused from buffering', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.pause('permission');
      expect(sm.state).toBe('paused');
    });

    it('should transition to paused from sending', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(300);
      expect(sm.state).toBe('sending');

      sm.pause('rate-limit');
      expect(sm.state).toBe('paused');
    });

    it('should accumulate buffer while paused but not flush', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.pause('permission');

      sm.append('while paused');

      // Advance time — should not flush
      vi.advanceTimersByTime(1000);
      expect(flushHandler).not.toHaveBeenCalled();
      expect(sm.buffer.hasContent).toBe(true);
    });

    it('should flush immediately on resume if buffer has content', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.pause('permission');
      sm.append('queued');

      sm.resume();
      expect(flushHandler).toHaveBeenCalledWith('queued', 'card-1');
      expect(sm.state).toBe('sending');
    });

    it('should start throttle timer on resume if buffer is empty', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.pause('permission');
      sm.resume();

      expect(sm.state).toBe('buffering');
      expect(flushHandler).not.toHaveBeenCalled();

      sm.append('after resume');
      vi.advanceTimersByTime(300);
      expect(flushHandler).toHaveBeenCalledWith('after resume', 'card-1');
    });

    it('should throw on resume if not paused', () => {
      const sm = createSM();
      sm.start('card-1');
      expect(() => sm.resume()).toThrow('Cannot resume in state "buffering"');
    });
  });

  // ── DRAINING / finish() ──

  describe('draining and finish', () => {
    it('should drain remaining buffer on finish from buffering', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('final data');

      const finishPromise = sm.finish();
      expect(sm.state).toBe('draining');
      expect(flushHandler).toHaveBeenCalledWith('final data', 'card-1');

      // Simulate send complete
      sm.onSendComplete();
      expect(sm.state).toBe('completed');

      const result = await finishPromise;
      expect(result).toBe('final data');
    });

    it('should complete immediately if buffer is empty on finish', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      // No data appended

      const finishPromise = sm.finish();
      expect(sm.state).toBe('completed');
      expect(flushHandler).not.toHaveBeenCalled();

      const result = await finishPromise;
      expect(result).toBe('');
    });

    it('should wait for in-flight send then drain on finish from sending', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('batch1');
      vi.advanceTimersByTime(300); // -> SENDING
      expect(sm.state).toBe('sending');

      sm.append('batch2');

      const finishPromise = sm.finish();
      expect(sm.state).toBe('draining');

      // Complete the first send
      sm.onSendComplete();
      // Should flush batch2
      expect(flushHandler).toHaveBeenCalledTimes(2);
      expect(flushHandler).toHaveBeenLastCalledWith('batch2', 'card-1');

      // Complete the second send
      sm.onSendComplete();
      expect(sm.state).toBe('completed');

      const result = await finishPromise;
      expect(result).toBe('batch1batch2');
    });

    it('should return full content history on finish', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('chunk1 ');
      vi.advanceTimersByTime(300);
      sm.onSendComplete();

      sm.append('chunk2 ');
      vi.advanceTimersByTime(300);
      sm.onSendComplete();

      sm.append('chunk3');

      const finishPromise = sm.finish();
      expect(sm.state).toBe('draining');

      // Complete the drain send
      sm.onSendComplete();
      expect(sm.state).toBe('completed');

      const result = await finishPromise;
      expect(result).toBe('chunk1 chunk2 chunk3');
    });

    it('should return same promise on multiple finish() calls', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');

      // First finish() transitions to draining
      const p1 = sm.finish();
      expect(sm.state).toBe('draining');

      // Second finish() while still draining should return the same promise
      const p2 = sm.finish();
      expect(p1).toBe(p2);

      sm.onSendComplete();
      const result = await p1;
      expect(result).toBe('data');
    });

    it('should throw on finish from idle', () => {
      const sm = createSM();
      expect(() => sm.finish()).toThrow('Cannot finish in idle state');
    });
  });

  // ── CANCELLED state ──

  describe('cancel', () => {
    it('should cancel from buffering', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.append('data');
      sm.cancel();
      expect(sm.state).toBe('cancelled');
      expect(sm.buffer.size).toBe(0);
    });

    it('should cancel from sending', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(300);
      expect(sm.state).toBe('sending');

      sm.cancel();
      expect(sm.state).toBe('cancelled');
    });

    it('should cancel from paused', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.pause('permission');
      sm.cancel();
      expect(sm.state).toBe('cancelled');
    });

    it('should be idempotent on terminal states', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.cancel();
      expect(sm.state).toBe('cancelled');
      sm.cancel(); // Should not throw
      expect(sm.state).toBe('cancelled');
    });

    it('should clear timers on cancel', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      sm.cancel();

      // Advance time — timer should not fire
      vi.advanceTimersByTime(1000);
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  // ── ERROR state ──

  describe('error handling', () => {
    it('should transition to error state', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.error(new Error('something broke'));
      expect(sm.state).toBe('error');
    });

    it('should transition to error on send error', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(300);
      expect(sm.state).toBe('sending');

      sm.onSendError(new Error('network fail'));
      expect(sm.state).toBe('error');
    });

    it('should be idempotent on terminal states', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.error(new Error('err'));
      sm.error(new Error('another')); // should not throw
      expect(sm.state).toBe('error');
    });

    it('should not accept new operations after error', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.error(new Error('err'));
      expect(() => sm.append('text')).toThrow('terminal state');
      expect(() => sm.pause('permission')).toThrow('terminal state');
      expect(() => sm.finish()).toThrow('terminal state');
    });

    it('should handle flush handler promise rejection as send error', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockRejectedValue(new Error('handler crash'));
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(300);

      // Allow the microtask (promise rejection) to process
      await vi.advanceTimersByTimeAsync(0);

      expect(sm.state).toBe('error');
    });
  });

  // ── Terminal state guards ──

  describe('terminal state guards', () => {
    it('should not allow append after completed', async () => {
      const sm = createSM();
      sm.start('card-1');
      await sm.finish();
      expect(() => sm.append('x')).toThrow('terminal state');
    });

    it('should not allow append after cancelled', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.cancel();
      expect(() => sm.append('x')).toThrow('terminal state');
    });

    it('should not allow start after completed', async () => {
      const sm = createSM();
      sm.start('card-1');
      await sm.finish();
      expect(() => sm.start('card-2')).toThrow();
    });
  });

  // ── onSendComplete edge cases ──

  describe('onSendComplete edge cases', () => {
    it('should ignore onSendComplete in non-sending state', () => {
      const sm = createSM();
      sm.start('card-1');
      // In buffering, onSendComplete should be a no-op
      sm.onSendComplete();
      expect(sm.state).toBe('buffering');
    });

    it('should ignore onSendError in non-sending state', () => {
      const sm = createSM();
      sm.start('card-1');
      sm.onSendError(new Error('stale'));
      expect(sm.state).toBe('buffering');
    });
  });

  // ── Complex multi-step scenarios ──

  describe('complex scenarios', () => {
    it('should handle full streaming lifecycle: start -> buffer -> send -> finish', async () => {
      const sm = createSM({ throttleMs: 100 });
      const sentChunks: string[] = [];
      const flushHandler: FlushHandler = async (content) => {
        sentChunks.push(content);
      };
      sm.onFlush(flushHandler);

      const transitions: Array<[StreamingState, StreamingState]> = [];
      sm.onStateChange((from, to) => transitions.push([from, to]));

      // Start streaming
      sm.start('card-1');
      expect(sm.state).toBe('buffering');

      // Simulate rapid token arrivals
      sm.append('Hello');
      sm.append(' ');
      sm.append('World');

      // Throttle fires
      vi.advanceTimersByTime(100);
      expect(sentChunks).toEqual(['Hello World']);
      expect(sm.state).toBe('sending');

      // More tokens while sending
      sm.append('!');
      sm.append(' How');

      // Send completes
      sm.onSendComplete();
      expect(sm.state).toBe('buffering');

      // Next throttle fires
      vi.advanceTimersByTime(100);
      expect(sentChunks).toEqual(['Hello World', '! How']);

      sm.onSendComplete();

      // Final append and finish
      sm.append(' are you?');
      const finalPromise = sm.finish();

      // Complete the drain send
      sm.onSendComplete();

      const finalContent = await finalPromise;
      expect(finalContent).toBe('Hello World! How are you?');
      expect(sm.state).toBe('completed');
    });

    it('should handle pause/resume mid-stream', async () => {
      const sm = createSM({ throttleMs: 100 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('before pause');
      vi.advanceTimersByTime(100);
      sm.onSendComplete();

      // Pause
      sm.pause('permission');
      sm.append('during pause 1');
      sm.append('during pause 2');
      vi.advanceTimersByTime(1000); // Should not flush
      expect(flushHandler).toHaveBeenCalledTimes(1); // Only the initial flush

      // Resume
      sm.resume();
      expect(flushHandler).toHaveBeenCalledTimes(2);
      expect(flushHandler).toHaveBeenLastCalledWith('during pause 1during pause 2', 'card-1');
    });

    it('should handle cancel during sending', () => {
      const sm = createSM({ throttleMs: 100 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(100);
      expect(sm.state).toBe('sending');

      sm.cancel();
      expect(sm.state).toBe('cancelled');
      expect(sm.buffer.size).toBe(0);

      // Stale onSendComplete should be ignored
      sm.onSendComplete();
      expect(sm.state).toBe('cancelled');
    });

    it('should handle multiple flush handlers', () => {
      const sm = createSM({ throttleMs: 100 });
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(handler1);
      sm.onFlush(handler2);

      sm.start('card-1');
      sm.append('data');
      vi.advanceTimersByTime(100);

      expect(handler1).toHaveBeenCalledWith('data', 'card-1');
      expect(handler2).toHaveBeenCalledWith('data', 'card-1');
    });
  });

  // ── Draining from paused state ──

  describe('draining from paused', () => {
    it('should drain when finish called from paused state', async () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('before');
      vi.advanceTimersByTime(300);
      sm.onSendComplete();

      sm.pause('permission');
      sm.append('paused-content');

      const finishPromise = sm.finish();
      expect(sm.state).toBe('draining');
      expect(flushHandler).toHaveBeenCalledWith('paused-content', 'card-1');

      sm.onSendComplete();
      expect(sm.state).toBe('completed');

      const result = await finishPromise;
      expect(result).toBe('beforepaused-content');
    });
  });

  // ── onSendError during draining ──

  describe('send error during draining', () => {
    it('should transition to error if send fails during draining', () => {
      const sm = createSM({ throttleMs: 300 });
      const flushHandler = vi.fn().mockResolvedValue(undefined);
      sm.onFlush(flushHandler);

      sm.start('card-1');
      sm.append('data');

      sm.finish();
      expect(sm.state).toBe('draining');

      sm.onSendError(new Error('fail during drain'));
      expect(sm.state).toBe('error');
    });
  });
});
