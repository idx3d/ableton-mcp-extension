import { describe, expect, it } from "vitest";
import { LogBuffer, type ConsoleLike } from "../../../src/shell/log-buffer.js";

describe("LogBuffer", () => {
  it("returns pushed lines newest-first with level + timestamp", () => {
    const buf = new LogBuffer(10);
    buf.push("info", "a");
    buf.push("error", "b");
    const recent = buf.recent(10);
    expect(recent.map((l) => l.message)).toEqual(["b", "a"]);
    expect(recent[0].level).toBe("error");
    expect(typeof recent[0].at).toBe("string");
  });

  it("caps the ring at capacity, dropping the oldest", () => {
    const buf = new LogBuffer(3);
    for (let i = 0; i < 5; i++) buf.push("info", String(i));
    expect(buf.recent(10).map((l) => l.message)).toEqual(["4", "3", "2"]);
  });

  it("recent(n) returns at most n, and [] for n<=0", () => {
    const buf = new LogBuffer(10);
    buf.push("info", "a");
    buf.push("info", "b");
    expect(buf.recent(1).map((l) => l.message)).toEqual(["b"]);
    expect(buf.recent(0)).toEqual([]);
  });

  it("install() captures console.log/error AND forwards to the original", () => {
    const forwarded: string[] = [];
    const fake = {
      log: (...a: unknown[]) => forwarded.push("log:" + a.join(" ")),
      error: (...a: unknown[]) => forwarded.push("err:" + a.join(" ")),
    };
    const buf = new LogBuffer(10);
    buf.install(fake);

    fake.log("hello", 42);
    fake.error("boom");

    expect(forwarded).toEqual(["log:hello 42", "err:boom"]);
    expect(buf.recent(10).map((l) => `${l.level}:${l.message}`)).toEqual([
      "error:boom",
      "info:hello 42",
    ]);
  });

  it("formats Error arguments with name + message", () => {
    const buf = new LogBuffer(10);
    const fake: ConsoleLike = { log: () => {}, error: () => {} };
    buf.install(fake);
    fake.error("failed:", new Error("nope"));
    expect(buf.recent(1)[0].message).toBe("failed: Error: nope");
  });
});
