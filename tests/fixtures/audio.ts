/** Deterministic test signal for codecs and playback; contains no speech or user recording. */
export function toneWav(durationMs = 4800): Buffer {
  const sampleRate = 22050;
  const samples = Math.round((durationMs * sampleRate) / 1000);
  const dataSize = samples * 2;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(8192 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
      44 + i * 2,
    );
  return bytes;
}
