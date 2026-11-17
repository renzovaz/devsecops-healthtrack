import request from 'supertest';
import { importHmacKey, randomKeyBytes, signJwt } from '@healthtrack/core';
import { createHttpServer } from '../src/app';
import { buildCore, loadSettings } from '../src/config';

/** Segredo gerado na hora do teste: nenhum segredo fica no repositório. */
function freshSecret(): string {
  return [...randomKeyBytes(32)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function setup(env: Record<string, string> = {}) {
  const secret = freshSecret();
  const settings = loadSettings({ JWT_SECRET: secret, RATE_LIMIT: '3', ...env });
  const lines: string[] = [];
  const app = createHttpServer(await buildCore(settings, (l) => lines.push(l)));
  const key = await importHmacKey(new TextEncoder().encode(secret));
  const now = Math.floor(Date.now() / 1000);
  const token = (sub = 'patient-demo-01') =>
    signJwt({ sub, iss: settings.issuer, aud: settings.audience, exp: now + 600, scope: 'appointments:write' }, key);
  return { app, lines, token };
}

const BODY = { doctorId: 'doctor-002', date: '2026-11-20', time: '14:00' };

describe('API Express (mesmo núcleo)', () => {
  test('GET /health', async () => {
    const { app } = await setup();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('201: POST /v1/appointments válido', async () => {
    const { app, token, lines } = await setup();
    const res = await request(app).post('/v1/appointments').set('authorization', `Bearer ${await token()}`).send(BODY);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...BODY, status: 'CONFIRMED' });
    expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(lines[0]!)).toMatchObject({ route: 'POST /v1/appointments', status: 201, level: 'info' });
  });

  test('401: token inválido', async () => {
    const { app } = await setup();
    const res = await request(app).post('/v1/appointments').set('authorization', 'Bearer x.y.z').send(BODY);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  test('409: horário ocupado', async () => {
    const { app, token } = await setup();
    await request(app).post('/v1/appointments').set('authorization', `Bearer ${await token()}`).send(BODY);
    const res = await request(app).post('/v1/appointments').set('authorization', `Bearer ${await token('patient-demo-02')}`).send(BODY);
    expect(res.status).toBe(409);
  });

  test('429: excesso de requisições', async () => {
    const { app, token } = await setup();
    const auth = `Bearer ${await token()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await request(app).get('/v1/availability').query({ doctorId: 'doctor-001', date: '2026-11-20' }).set('authorization', auth);
      statuses.push(r.status);
      if (r.status === 429) expect(r.headers['retry-after']).toBeDefined();
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test('JSON malformado: 400 sem chegar ao núcleo', async () => {
    const { app } = await setup();
    const res = await request(app).post('/v1/appointments').set('content-type', 'application/json').send('{"x":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  test('configuração: JWT_SECRET ausente ou curto é recusado', () => {
    expect(() => loadSettings({})).toThrow(/JWT_SECRET/);
    expect(() => loadSettings({ JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/);
    expect(() => loadSettings({ JWT_SECRET: 'a'.repeat(32), PORT: '-1' })).toThrow(/PORT/);
  });
});
