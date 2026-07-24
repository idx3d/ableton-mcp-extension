import { describe, expect, it } from "vitest";
import {
  colorFromHex,
  colorToHex,
  noteFromSdk,
  noteToSdk,
  toNumber,
} from "../../../src/adapters/sdk-1.0/codec.js";
import type { Note } from "../../../src/port/types.js";

describe("note codec", () => {
  it("round-trips a plain note", () => {
    const note: Note = [60, 1.5, 0.25, 100];
    expect(noteFromSdk(noteToSdk(note))).toEqual(note);
  });

  it("round-trips extras and omits defaults", () => {
    const note: Note = [60, 0, 1, 90, { prob: 0.5, velDev: 10, muted: true, relVel: 30 }];
    const sdk = noteToSdk(note);
    expect(sdk).toEqual({
      pitch: 60,
      startTime: 0,
      duration: 1,
      velocity: 90,
      probability: 0.5,
      velocityDeviation: 10,
      muted: true,
      releaseVelocity: 30,
    });
    expect(noteFromSdk(sdk)).toEqual(note);
  });

  it("maps SDK defaults back to a 4-tuple", () => {
    expect(
      noteFromSdk({
        pitch: 60,
        startTime: 0,
        duration: 1,
        velocity: 100,
        probability: 1,
        velocityDeviation: 0,
        muted: false,
        releaseVelocity: 64,
      }),
    ).toEqual([60, 0, 1, 100]);
  });

  it("defaults missing SDK velocity to 100", () => {
    expect(noteFromSdk({ pitch: 60, startTime: 0, duration: 1 })).toEqual([
      60, 0, 1, 100,
    ]);
  });
});

describe("color codec", () => {
  it("round-trips", () => {
    expect(colorToHex(colorFromHex("#FF5500"))).toBe("#FF5500");
  });
  it("pads and masks", () => {
    expect(colorToHex(0x000042)).toBe("#000042");
    expect(colorToHex(0xff000042 & 0xffffff)).toBe("#000042");
  });
});

// Real Live marshals integer-domain SDK getters as `bigint` despite the SDK
// typing them `number` (verified in-Live: `clip.color` arrived as a BigInt and
// crashed `n & 0xffffff`). The codec must coerce so downstream bitwise math and
// JSON serialization never meet a BigInt.
describe("SDK bigint marshalling", () => {
  it("toNumber coerces bigint and passes through number", () => {
    expect(toNumber(16711680n)).toBe(16711680);
    expect(toNumber(1.5)).toBe(1.5);
  });

  it("colorToHex accepts a bigint color (real-Live shape)", () => {
    expect(colorToHex(0xff5500n as unknown as number)).toBe("#FF5500");
    expect(colorToHex(0x000042n as unknown as number)).toBe("#000042");
  });

  it("noteFromSdk coerces bigint pitch/velocity to numbers", () => {
    const note = noteFromSdk({
      pitch: 60n as unknown as number,
      startTime: 0,
      duration: 1,
      velocity: 100n as unknown as number,
    });
    expect(note).toEqual([60, 0, 1, 100]);
    expect(typeof note[0]).toBe("number");
    expect(typeof note[3]).toBe("number");
  });
});
