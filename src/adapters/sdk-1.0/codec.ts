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

export function noteFromSdk(sdk: SdkNote): Note {
  const extras: NoteExtras = {};
  if (sdk.probability !== undefined && sdk.probability !== 1)
    extras.prob = sdk.probability;
  if (sdk.velocityDeviation !== undefined && sdk.velocityDeviation !== 0)
    extras.velDev = sdk.velocityDeviation;
  if (sdk.muted) extras.muted = true;
  if (sdk.releaseVelocity !== undefined && sdk.releaseVelocity !== 64)
    extras.relVel = sdk.releaseVelocity;
  const base: [number, number, number, number] = [
    sdk.pitch,
    sdk.startTime,
    sdk.duration,
    sdk.velocity ?? 100,
  ];
  return Object.keys(extras).length > 0 ? [...base, extras] : base;
}

/** Best-effort 0xRRGGBB mapping — verify against real Live (smoke runbook). */
export function colorToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function colorFromHex(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
