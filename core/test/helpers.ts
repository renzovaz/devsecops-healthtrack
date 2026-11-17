import {
  createSchedulingApp,
  FixedClock,
  importHmacKey,
  InMemoryAppointmentRepository,
  InMemoryCache,
  InMemoryEventPublisher,
  JsonLogger,
  randomKeyBytes,
  signJwt,
  type HttpRequest,
  type JwtClaims,
} from '../src/index';

export const ISSUER = 'https://auth.healthtrack.example';
export const AUDIENCE = 'healthtrack-api';
export const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
export const TRACE = '0123456789abcdef0123456789abcdef';

/** Monta o app com adapters em memória e uma chave gerada na hora (nenhum segredo no repositório). */
export async function setup(rateLimit = { limit: 5, windowMs: 60_000 }) {
  const clock = new FixedClock(T0);
  const repo = new InMemoryAppointmentRepository();
  const cache = new InMemoryCache();
  const publisher = new InMemoryEventPublisher();
  const lines: string[] = [];
  const logger = new JsonLogger((l) => lines.push(l));
  const key = await importHmacKey(randomKeyBytes());
  const otherKey = await importHmacKey(randomKeyBytes());
  const app = createSchedulingApp({ deps: { repo, cache, publisher, clock }, logger, jwtKey: key, issuer: ISSUER, audience: AUDIENCE, rateLimit, newTraceId: () => TRACE });

  const claims = (over: Partial<JwtClaims> = {}): JwtClaims => ({
    sub: 'patient-demo-01',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: Math.floor(T0 / 1000),
    exp: Math.floor(T0 / 1000) + 3600,
    scope: 'appointments:write',
    ...over,
  });
  const token = (over: Partial<JwtClaims> = {}) => signJwt(claims(over), key);
  const foreignToken = () => signJwt(claims(), otherKey);

  const req = (over: Partial<HttpRequest>): HttpRequest => ({ method: 'GET', path: '/health', query: {}, headers: {}, body: undefined, clientKey: 'test-client', ...over });
  const book = async (body: unknown, tok?: string, clientKey = 'test-client') =>
    app.handle(req({ method: 'POST', path: '/v1/appointments', headers: { authorization: `Bearer ${tok ?? (await token())}` }, body, clientKey }));

  return { app, clock, repo, cache, publisher, lines, key, token, foreignToken, req, book };
}

export const VALID_BODY = { doctorId: 'doctor-001', date: '2026-11-20', time: '09:00' };
