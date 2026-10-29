import { describe, expect, it, vi } from "vitest";

// Porta fechada: o cache deve cair direto no provedor, sem travar.
process.env.REDIS_URL = "redis://127.0.0.1:1";
const { cached, invalidate } = await import("./cache.js");

describe("cache de metadados (best-effort)", () => {
  it("sem cacheScope, só carrega", async () => {
    const load = vi.fn(async () => 1);
    expect(await cached({ accessToken: "t" }, ["x"], 60, load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("com Redis fora do ar, carrega do provedor rapidamente", async () => {
    const creds = { accessToken: "t", cacheScope: "conn1" };
    const t = Date.now();
    expect(await cached(creds, ["labels", "o/r"], 60, async () => ["bug"])).toEqual(["bug"]);
    expect(Date.now() - t).toBeLessThan(1500);
    await expect(invalidate(creds, ["labels", "o/r"])).resolves.toBeUndefined();
  });

  it("leituras simultâneas da mesma chave fazem uma ida só", async () => {
    const creds = { accessToken: "t", cacheScope: "conn2" };
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const a = cached(creds, ["same"], 60, load);
    const b = cached(creds, ["same"], 60, load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    resolve("v");
    expect(await Promise.all([a, b])).toEqual(["v", "v"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
