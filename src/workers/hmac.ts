import crypto from 'crypto';

/**
 * Signs a payload string with HMAC-SHA256 using the given secret.
 * Returns a signature in the format `sha256=<hex-digest>`.
 */
export function signPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verifies that the provided signature matches the expected signature
 * for the given payload and secret. Uses timing-safe comparison to
 * prevent timing attacks.
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
