export interface DecodedPcmAudio {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** Downmix decoded browser audio to bounded, little-endian mono PCM16 WAV. */
export function encodePcm16Wav(audio: DecodedPcmAudio): Blob {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 61) {
    throw new RangeError('Recording duration must be between 0 and 61 seconds');
  }
  if (
    !Number.isInteger(audio.length) ||
    audio.length <= 0 ||
    !Number.isInteger(audio.numberOfChannels) ||
    audio.numberOfChannels <= 0 ||
    !Number.isInteger(audio.sampleRate) ||
    audio.sampleRate <= 0
  ) {
    throw new RangeError('Invalid decoded audio format');
  }

  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  if (channels.some((channel) => channel.length < audio.length)) {
    throw new RangeError('Decoded audio channel is shorter than the frame count');
  }

  const dataBytes = audio.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < audio.length; frame += 1) {
    let sample = 0;
    for (const channel of channels) sample += channel[frame] ?? 0;
    sample /= channels.length;
    if (!Number.isFinite(sample)) sample = 0;
    sample = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
