import { describe, expect, it } from "vitest";

import { computeAudioLevel } from "./audio-capture";

function pcm16(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });
  return buffer;
}

describe("computeAudioLevel", () => {
  it("returns 0 for an empty chunk", () => {
    expect(computeAudioLevel(Buffer.alloc(0))).toBe(0);
  });

  it("returns 0 for silence", () => {
    expect(computeAudioLevel(pcm16([0, 0, 0, 0]))).toBe(0);
  });

  it("normalizes a half-scale signal to 0.5", () => {
    expect(computeAudioLevel(pcm16([16384, -16384]))).toBeCloseTo(0.5, 5);
  });

  it("clamps a full-scale signal to at most 1", () => {
    const level = computeAudioLevel(pcm16([32767, -32768]));
    expect(level).toBeGreaterThan(0.99);
    expect(level).toBeLessThanOrEqual(1);
  });

  it("returns 0 for a single byte that cannot form a sample", () => {
    expect(computeAudioLevel(Buffer.from([0x42]))).toBe(0);
  });

  it("does not throw on an odd-length chunk and ignores the trailing byte", () => {
    // Stream chunks are not guaranteed to land on a 2-byte sample boundary.
    // The previous implementation read one byte past the end and threw a
    // RangeError from inside the stream "data" handler, crashing main.
    const wholeSample = pcm16([32767]); // 2 bytes
    const withTrailingByte = Buffer.concat([wholeSample, Buffer.from([0x13])]);

    expect(withTrailingByte.length).toBe(3);
    expect(() => computeAudioLevel(withTrailingByte)).not.toThrow();
    expect(computeAudioLevel(withTrailingByte)).toBe(
      computeAudioLevel(wholeSample)
    );
  });
});
