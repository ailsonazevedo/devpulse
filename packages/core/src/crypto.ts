import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "./env.js";

/**
 * Criptografia de segredos (tokens de provedores) em repouso.
 *
 * AES-256-GCM autenticado. Formato serializado:
 *   "v1:" + base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 *
 * MASTER_KEY deve ser 32 bytes em base64 (openssl rand -base64 32).
 * Em produção, a MASTER_KEY idealmente vem de um KMS/secret manager.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // recomendado p/ GCM

function getKey(): Buffer {
  const key = Buffer.from(env.MASTER_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `MASTER_KEY inválida: esperado 32 bytes em base64, recebido ${key.length} bytes`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(serialized: string): string {
  const parts = serialized.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("segredo cifrado em formato inválido");
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Mascara um token para logs/telas (mostra só os últimos 4 chars). */
export function maskSecret(token: string): string {
  if (token.length <= 4) return "****";
  return `${"*".repeat(Math.min(token.length - 4, 8))}${token.slice(-4)}`;
}
