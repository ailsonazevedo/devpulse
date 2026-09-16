import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "./types.js";
import { oauthClient, refreshOAuthToken } from "./oauth.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
});

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

describe("oauthClient", () => {
  it("null quando não configurado", () => {
    expect(oauthClient("GITHUB")).toBeNull();
  });
  it("retorna client quando env presente", () => {
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    expect(oauthClient("GITHUB")).toEqual({ clientId: "id", clientSecret: "secret" });
  });
});

describe("refreshOAuthToken", () => {
  const params = {
    tokenUrl: "https://example.com/oauth/token",
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "rt",
  };

  it("parseia access/refresh/expiração no sucesso", async () => {
    mockFetch(200, {
      access_token: "new-at",
      refresh_token: "new-rt",
      expires_in: 7200,
    });
    const r = await refreshOAuthToken(params);
    expect(r.accessToken).toBe("new-at");
    expect(r.refreshToken).toBe("new-rt");
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect(r.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refresh ausente vira null (chamador mantém o anterior)", async () => {
    mockFetch(200, { access_token: "new-at" });
    const r = await refreshOAuthToken(params);
    expect(r.refreshToken).toBeNull();
    expect(r.expiresAt).toBeNull();
  });

  it("erro do provedor vira AuthError", async () => {
    mockFetch(400, { error: "invalid_grant", error_description: "expired" });
    await expect(refreshOAuthToken(params)).rejects.toBeInstanceOf(AuthError);
  });

  it("HTTP não-ok vira AuthError", async () => {
    mockFetch(401, {});
    await expect(refreshOAuthToken(params)).rejects.toBeInstanceOf(AuthError);
  });
});
