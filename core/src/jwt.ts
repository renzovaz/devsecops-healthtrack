/**
 * JWT HS256 com Web Crypto (globalThis.crypto.subtle), disponível no navegador
 * (contexto seguro: HTTPS ou localhost) e no Node 20+. Sem Buffer e sem o módulo crypto do Node.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('base64url inválido');
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface JwtClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number; // segundos
  iat?: number;
  scope?: string;
  [claim: string]: unknown;
}

export function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('Web Crypto indisponível: abra a página por HTTPS ou localhost (contexto seguro).');
  }
  return c.subtle;
}

/** Importa uma chave HMAC-SHA256 a partir de bytes brutos. */
export function importHmacKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Gera bytes aleatórios para uma chave de demonstração (nunca commitada). */
export function randomKeyBytes(length = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function signJwt(claims: JwtClaims, key: CryptoKey): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const sig = new Uint8Array(await subtle().sign('HMAC', key, encoder.encode(signingInput)));
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

export type JwtFailure = 'malformed' | 'unsupported_alg' | 'bad_signature' | 'expired' | 'wrong_issuer' | 'wrong_audience';

export type JwtResult = { ok: true; claims: JwtClaims } | { ok: false; reason: JwtFailure };

export interface VerifyOptions {
  issuer: string;
  audience: string;
  /** Agora, em milissegundos (vem do port Clock). */
  nowMs: number;
}

/** Valida assinatura, alg, iss, aud e exp. */
export async function verifyJwt(token: string, key: CryptoKey, opts: VerifyOptions): Promise<JwtResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown };
  let claims: JwtClaims;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(decoder.decode(base64UrlToBytes(h)));
    claims = JSON.parse(decoder.decode(base64UrlToBytes(p)));
    signature = base64UrlToBytes(s);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Só HS256 é aceito: impede ataques de troca de algoritmo (ex.: "alg": "none").
  if (header.alg !== 'HS256') return { ok: false, reason: 'unsupported_alg' };
  const valid = await subtle().verify('HMAC', key, signature, encoder.encode(`${h}.${p}`));
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= opts.nowMs) return { ok: false, reason: 'expired' };
  if (claims.iss !== opts.issuer) return { ok: false, reason: 'wrong_issuer' };
  if (claims.aud !== opts.audience) return { ok: false, reason: 'wrong_audience' };
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return { ok: false, reason: 'malformed' };
  return { ok: true, claims };
}
