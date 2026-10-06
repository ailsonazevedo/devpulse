import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "./adapters/types.js";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("./db.js", () => ({
  prisma: { providerConnection: { findFirst, update } },
}));
vi.mock("./crypto.js", () => ({
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  encryptSecret: (s: string) => `enc:${s}`,
}));
const refreshToken = vi.fn();
vi.mock("./adapters/index.js", async (orig) => ({
  ...(await orig<typeof import("./adapters/index.js")>()),
  getAdapter: () => ({ provider: "GITHUB", refreshToken }),
}));

const { withConnection, ConnectionNotFoundError } = await import("./connection-creds.js");

function conn(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    userId: "u1",
    provider: "GITHUB",
    authMethod: "OAUTH",
    baseUrl: "",
    accessTokenEnc: "enc:old",
    refreshTokenEnc: "enc:rt",
    tokenExpiresAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshToken.mockResolvedValue({ accessToken: "new", refreshToken: null });
});

describe("withConnection", () => {
  it("filtra pelo dono e lança se não achar", async () => {
    findFirst.mockResolvedValue(null);
    await expect(withConnection("c1", "u2", async () => 1)).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "u2" } });
  });

  it("renova e repete 1x em AuthError", async () => {
    findFirst.mockResolvedValue(conn());
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AuthError("expirou"))
      .mockResolvedValueOnce("ok");
    await expect(withConnection("c1", "u1", fn)).resolves.toBe("ok");
    expect(fn.mock.calls[1]![0].accessToken).toBe("new");
    expect(update).toHaveBeenCalledTimes(1); // só a persistência do token
  });

  it("marca REVOKED quando o retry também falha", async () => {
    findFirst.mockResolvedValue(conn());
    const fn = vi.fn().mockRejectedValue(new AuthError("inválido"));
    await expect(withConnection("c1", "u1", fn)).rejects.toBeInstanceOf(AuthError);
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "c1" },
      data: { status: "REVOKED", statusDetail: "inválido" },
    });
  });

  it("refresh proativo quando o token está expirando", async () => {
    findFirst.mockResolvedValue(conn({ tokenExpiresAt: new Date(Date.now() + 1000) }));
    const fn = vi.fn().mockResolvedValue("ok");
    await withConnection("c1", "u1", fn);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]![0].accessToken).toBe("new");
  });

  it("erros que não são de auth não revogam", async () => {
    findFirst.mockResolvedValue(conn());
    await expect(
      withConnection("c1", "u1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(update).not.toHaveBeenCalled();
  });
});
