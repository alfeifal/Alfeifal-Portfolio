import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP-recommended scrypt parameters (N=2^17, r=8, p=1) → ~100ms on a modern core.
const N = 2 ** 17, r = 8, p = 1, KEYLEN = 64;

function derive(password: string, salt: Buffer, keylen: number, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keylen, { ...params, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, n, rr, pp, saltB64, keyB64] = stored.split("$");
    if (algo !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    const key = await derive(password, salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
