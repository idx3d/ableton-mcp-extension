import type { Note, NoteExtras } from "../../port/types.js";

/**
 * Structural twin of the SDK's NoteDescription — declared locally so this
 * module stays SDK-import-free (and therefore CI-checkable).
 */
export interface SdkNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity?: number;
  muted?: boolean;
  probability?: number;
  velocityDeviation?: number;
  releaseVelocity?: number;
}

export function noteToSdk(note: Note): SdkNote {
  const [pitch, startTime, duration, velocity] = note;
  const extras = note.length === 5 ? note[4] : undefined;
  return {
    pitch,
    startTime,
    duration,
    velocity,
    ...(extras?.prob !== undefined ? { probability: extras.prob } : {}),
    ...(extras?.velDev !== undefined ? { velocityDeviation: extras.velDev } : {}),
    ...(extras?.muted !== undefined ? { muted: extras.muted } : {}),
    ...(extras?.relVel !== undefined ? { releaseVelocity: extras.relVel } : {}),
  };
}

/**
 * Real Live marshals integer-domain SDK getters (color, root note, MIDI pitch,
 * marker positions, …) as `bigint` even though the SDK types them `number`.
 * Coerce at the boundary so downstream arithmetic (`n & 0xffffff`) and JSON
 * serialization never meet a BigInt. FakeLive uses plain numbers, so this is a
 * no-op there; `Number()` is also a no-op for values already numeric.
 */
export function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export function noteFromSdk(sdk: SdkNote): Note {
  const probability =
    sdk.probability === undefined ? undefined : toNumber(sdk.probability);
  const velocityDeviation =
    sdk.velocityDeviation === undefined ? undefined : toNumber(sdk.velocityDeviation);
  const releaseVelocity =
    sdk.releaseVelocity === undefined ? undefined : toNumber(sdk.releaseVelocity);
  const extras: NoteExtras = {};
  if (probability !== undefined && probability !== 1) extras.prob = probability;
  if (velocityDeviation !== undefined && velocityDeviation !== 0)
    extras.velDev = velocityDeviation;
  if (sdk.muted) extras.muted = true;
  if (releaseVelocity !== undefined && releaseVelocity !== 64)
    extras.relVel = releaseVelocity;
  const base: [number, number, number, number] = [
    toNumber(sdk.pitch),
    toNumber(sdk.startTime),
    toNumber(sdk.duration),
    sdk.velocity === undefined ? 100 : toNumber(sdk.velocity),
  ];
  return Object.keys(extras).length > 0 ? [...base, extras] : base;
}

/** Best-effort 0xRRGGBB mapping — verify against real Live (smoke runbook). */
export function colorToHex(n: number | bigint): string {
  return `#${(toNumber(n) & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function colorFromHex(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
