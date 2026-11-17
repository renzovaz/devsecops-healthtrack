import { FixedClock, FixedWindowRateLimiter, importHmacKey, randomKeyBytes, signJwt, verifyJwt } from '../src/index';
import { AUDIENCE, ISSUER, T0 } from './helpers';

const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('JWT HS256 (Web Crypto)', () => {
  const opts = { issuer: ISSUER, audience: AUDIENCE, nowMs: T0 };
  const base = { sub: 's', iss: ISSUER, aud: AUDIENCE, exp: T0 / 1000 + 60 };

  test('aceita token válido e devolve as claims', async () => {
    const key = await importHmacKey(randomKeyBytes());
    const r = await verifyJwt(await signJwt(base, key), key, opts);
    expect(r).toEqual({ ok: true, claims: base });
  });

  test.each([
    ['malformed', 'abc'],
    ['malformed', 'a.b.c'],
  ])('rejeita %s (%s)', async (reason, tok) => {
    const key = await importHmacKey(randomKeyBytes());
    expect(await verifyJwt(tok, key, opts)).toEqual({ ok: false, reason });
  });

  test('rejeita alg diferente de HS256 (ex.: none)', async () => {
    const key = await importHmacKey(randomKeyBytes());
    const tok = `${enc({ alg: 'none', typ: 'JWT' })}.${enc(base)}.`;
    expect(await verifyJwt(tok, key, opts)).toEqual({ ok: false, reason: 'unsupported_alg' });
  });

  test('rejeita payload adulterado (assinatura não confere)', async () => {
    const key = await importHmacKey(randomKeyBytes());
    const [h, , s] = (await signJwt(base, key)).split('.');
    const tampered = `${h}.${enc({ ...base, sub: 'outro' })}.${s}`;
    expect(await verifyJwt(tampered, key, opts)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('rejeita emissor, audiência e sub incorretos', async () => {
    const key = await importHmacKey(randomKeyBytes());
    expect(await verifyJwt(await signJwt({ ...base, iss: 'x' }, key), key, opts)).toEqual({ ok: false, reason: 'wrong_issuer' });
    expect(await verifyJwt(await signJwt({ ...base, aud: 'x' }, key), key, opts)).toEqual({ ok: false, reason: 'wrong_audience' });
    expect(await verifyJwt(await signJwt({ ...base, sub: '' }, key), key, opts)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('FixedWindowRateLimiter', () => {
  test('bloqueia acima do limite e libera na janela seguinte; clientes são independentes', () => {
    const clock = new FixedClock(0);
    const rl = new FixedWindowRateLimiter(clock, 2, 10_000);
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a')).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 10 });
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true);
    clock.advance(10_000);
    expect(rl.check('a').allowed).toBe(true);
    rl.reset();
  });

  test('rejeita configuração inválida', () => {
    expect(() => new FixedWindowRateLimiter(new FixedClock(0), 0, 1)).toThrow();
  });
});
