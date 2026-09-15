import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// MASTER_KEY precisa existir antes de importar o módulo (env é validado no import).
beforeAll(() => {
  process.env.MASTER_KEY ??= randomBytes(32).toString("base64");
  process.env.DATABASE_URL ??= "postgresql://x:x@localhost:5432/x";
});

describe("crypto", () => {
  it("faz round-trip encrypt/decrypt", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const secret = "ghp_" + randomBytes(20).toString("hex");
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("gera ciphertexts diferentes p/ o mesmo input (IV aleatório)", async () => {
    const { encryptSecret } = await import("./crypto.js");
    expect(encryptSecret("abc")).not.toBe(encryptSecret("abc"));
  });

  it("falha ao adulterar o ciphertext (GCM autenticado)", async () => {
    const { encryptSecret, decryptSecret } = await import("./crypto.js");
    const enc = encryptSecret("segredo");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("mascara segredos", async () => {
    const { maskSecret } = await import("./crypto.js");
    expect(maskSecret("abcdef1234")).toMatch(/1234$/);
    expect(maskSecret("abcdef1234")).not.toContain("abcdef");
  });
});
