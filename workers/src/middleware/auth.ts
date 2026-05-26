import type { UserContext } from "../types";

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64urlDecodeText(str: string): string {
  return new TextDecoder().decode(base64urlDecode(str));
}

export async function verifySupabaseJWT(
  token: string,
  jwtSecret: string
): Promise<UserContext | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const encoder = new TextEncoder();
    const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = base64urlDecode(sigB64);

    const key = await importHmacKey(jwtSecret);
    const valid = await crypto.subtle.verify("HMAC", key, signature, signingInput);
    if (!valid) return null;

    const payload = JSON.parse(base64urlDecodeText(payloadB64)) as {
      sub?: string;
      exp?: number;
      email?: string;
      app_metadata?: { plan?: string };
      user_metadata?: { plan?: string };
    };

    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    const plan =
      (payload.app_metadata?.plan as "free" | "pro") ||
      (payload.user_metadata?.plan as "free" | "pro") ||
      "free";

    return { userId: payload.sub, plan, email: payload.email };
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
