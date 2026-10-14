/** Short, non-blocking two-tone alert. Browsers without WebAudio still show the banner. */
export async function playNewOrderSound(): Promise<void> {
  if (typeof window === 'undefined') return;
  const AudioContextImpl = window.AudioContext;
  if (!AudioContextImpl) return;
  let context: AudioContext | undefined;
  try {
    context = new AudioContextImpl();
    await context.resume().catch(() => undefined);
    const start = context.currentTime;
    for (const [index, frequency] of [740, 988].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.09, start + index * 0.15 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.15 + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + index * 0.15);
      oscillator.stop(start + index * 0.15 + 0.13);
    }
    window.setTimeout(() => {
      void context?.close().catch(() => undefined);
    }, 500);
  } catch {
    await context?.close().catch(() => undefined);
  }
}
