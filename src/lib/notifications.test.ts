// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { playNewOrderSound } from './notifications';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('does not crash notification delivery in browsers without WebAudio', async () => {
  vi.stubGlobal('AudioContext', undefined);
  await expect(playNewOrderSound()).resolves.toBeUndefined();
});

it('plays two short tones and releases the audio context', async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => {});
  const starts: number[] = [];
  const stops: number[] = [];
  class Audio {
    currentTime = 2;
    destination = {};
    resume = vi.fn(async () => {});
    close = close;
    createOscillator() {
      return {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: (time: number) => starts.push(time),
        stop: (time: number) => stops.push(time),
      };
    }
    createGain() {
      return {
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
    }
  }
  vi.stubGlobal('AudioContext', Audio);
  await playNewOrderSound();
  expect(starts).toEqual([2, 2.15]);
  expect(stops).toHaveLength(2);
  expect(close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(close).toHaveBeenCalledOnce();
});

it('keeps a visual notification usable when audio initialization throws', async () => {
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        throw new Error('audio disabled');
      }
    },
  );
  await expect(playNewOrderSound()).resolves.toBeUndefined();
});

it('releases a partially initialized context when tone creation fails', async () => {
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 0;
      resume = vi.fn(async () => {
        throw new Error('autoplay denied');
      });
      close = close;
      createOscillator() {
        throw new Error('device unavailable');
      }
    },
  );
  await expect(playNewOrderSound()).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledOnce();
});
