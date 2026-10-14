import { describe, expect, it } from 'vitest';
import { encodePcm16Wav, type DecodedPcmAudio } from './audio';

function decodedAudio(channels: Float32Array[], duration = 1): DecodedPcmAudio {
  return {
    duration,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    sampleRate: 16_000,
    getChannelData: (index) => channels[index],
  };
}

describe('encodePcm16Wav', () => {
  it('writes a valid mono PCM16 RIFF header and downmixes stereo samples', async () => {
    const wav = encodePcm16Wav(
      decodedAudio([new Float32Array([-1, 0.5]), new Float32Array([1, 0.5])]),
    );
    const bytes = await wav.arrayBuffer();
    const view = new DataView(bytes);
    const text = (offset: number, length: number) =>
      new TextDecoder().decode(new Uint8Array(bytes, offset, length));

    expect(wav.type).toBe('audio/wav');
    expect(text(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(40);
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16_383);
  });

  it('clips out-of-range input and maps the negative endpoint safely', async () => {
    const wav = encodePcm16Wav(decodedAudio([new Float32Array([-2, 2, Number.NaN])]));
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(32_767);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it.each([0, -1, 61.01, Number.NaN])('rejects invalid or overlong duration %s', (duration) => {
    expect(() => encodePcm16Wav(decodedAudio([new Float32Array([0])], duration))).toThrow(
      RangeError,
    );
  });

  it('rejects malformed decoded channel metadata instead of uploading a corrupt WAV', () => {
    const malformed = { ...decodedAudio([new Float32Array([0])]), length: 2 };
    expect(() => encodePcm16Wav(malformed)).toThrow('shorter than the frame count');
  });
});
