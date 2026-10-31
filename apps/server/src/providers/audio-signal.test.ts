import { describe, expect, it } from 'vitest';
import { measurePcm16 } from './audio-signal.js';

describe('aggregate PCM diagnostics', () => {
  it('represents digital silence without non-finite values or retained samples', () => {
    const result = measurePcm16(new Uint8Array(6400));
    expect(result).toEqual({ rmsDbfs: null, peakDbfs: null, silent: true });
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });
  it('measures amplitude independent of polarity and respects byte offsets', () => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    for (let i = 2; i < 10; i += 2) view.setInt16(i, i % 4 ? -16384 : 16384, true);
    expect(measurePcm16(bytes.subarray(2, 10))).toEqual({
      rmsDbfs: -6,
      peakDbfs: -6,
      silent: false,
    });
  });
  it('rejects incomplete samples', () => {
    expect(() => measurePcm16(new Uint8Array(3))).toThrow('INVALID_PCM');
  });
});
