import { describe, expect, it } from "vitest";
import {
  colorFromHex,
  colorToHex,
  noteFromSdk,
  noteToSdk,
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
