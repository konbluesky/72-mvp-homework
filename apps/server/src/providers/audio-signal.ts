/** Aggregate signal diagnostics only; never retain samples, waveform, or recognized text. */
export interface AudioSignalStats {
  rmsDbfs: number | null;
  peakDbfs: number | null;
  silent: boolean;
}
export function measurePcm16(pcm: Uint8Array): AudioSignalStats {
  if (!pcm.length || pcm.length % 2) throw new Error('INVALID_PCM');
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sumSquares = 0,
    peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = view.getInt16(offset, true);
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumSquares / (pcm.length / 2)) / 32768;
  const db = (amplitude: number) =>
    amplitude ? Math.round(20 * Math.log10(amplitude) * 10) / 10 : null;
  return { rmsDbfs: db(rms), peakDbfs: db(peak / 32768), silent: peak === 0 };
}
