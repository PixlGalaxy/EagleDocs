import { createHash, randomBytes, randomInt } from 'crypto';

/** Tokens are stored hashed: a leaked database does not hand out live sessions or links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Six digits, zero-padded, from a CSPRNG. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
