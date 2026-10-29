import { describe, expect, it, vi } from "vitest";
import { DevPulseClient, DevPulseError, errorHint } from "./client.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("DevPulseClient", () => {
  it("envia Bearer, query sem vazios e corpo JSON", async () => {
    const f = mockFetch(200, { ok: true });
    const api = new DevPulseClient({ baseUrl: "http://x/", token: "dp_abc", fetch: f });
    await api.request("/api/work/c1/item", {
      method: "PATCH",
      query: { ref: "o/r#1", q: "", cursor: undefined },
      body: { title: "t" },
    });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://x/api/work/c1/item?ref=o%2Fr%231");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer dp_abc");
    expect(init.body).toBe('{"title":"t"}');
  });

  it("converte erro da API em DevPulseError com kind", async () => {
    const api = new DevPulseClient({
      baseUrl: "http://x",
      token: "dp_abc",
      fetch: mockFetch(403, { error: "sem escopo", kind: "scope" }),
    });
    const err = await api.request("/a").catch((e) => e);
    expect(err).toBeInstanceOf(DevPulseError);
    expect(err.kind).toBe("scope");
    expect(errorHint(err)).toMatch(/Reconecte/);
  });

  it("401 sem kind = token do DevPulse inválido", async () => {
    const api = new DevPulseClient({
      baseUrl: "http://x",
      token: "dp_bad",
      fetch: mockFetch(401, { error: "não autenticado" }),
    });
    const err = await api.request("/a").catch((e) => e);
    expect(err.kind).toBe("unauthenticated");
    expect(errorHint(err)).toMatch(/DEVPULSE_TOKEN/);
  });
});
