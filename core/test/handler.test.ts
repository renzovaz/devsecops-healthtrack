import { createSchedulingApp, FixedClock, importHmacKey, InMemoryAppointmentRepository, InMemoryCache, InMemoryEventPublisher, JsonLogger, randomKeyBytes } from '../src/index';
import { AUDIENCE, ISSUER, setup, T0, VALID_BODY } from './helpers';

describe('handler: rotas e edge', () => {
  test('GET /health responde 200 sem token', async () => {
    const { app, req } = await setup();
    const res = await app.handle(req({}));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('rota desconhecida 404 e método errado 405', async () => {
    const { app, req } = await setup();
    expect((await app.handle(req({ path: '/v1/nada' }))).status).toBe(404);
    expect((await app.handle(req({ method: 'DELETE', path: '/v1/appointments' }))).status).toBe(405);
    expect((await app.handle(req({ method: 'POST', path: '/v1/availability' }))).status).toBe(405);
    expect((await app.handle(req({ method: 'POST', path: '/health' }))).status).toBe(405);
  });

  test('sem cabeçalho Authorization: 401 com WWW-Authenticate', async () => {
    const { app, req, lines } = await setup();
    const res = await app.handle(req({ method: 'POST', path: '/v1/appointments', body: VALID_BODY }));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(JSON.parse(lines[0]!).message).toBe('jwt rejected: missing_token');
  });

  test('token expirado: 401', async () => {
    const { book, token, lines } = await setup();
    const res = await book(VALID_BODY, await token({ exp: Math.floor(T0 / 1000) - 1 }));
    expect(res.status).toBe(401);
    expect(JSON.parse(lines[0]!).message).toBe('jwt rejected: expired');
  });

  test('sem escopo appointments:write: 403', async () => {
    const { book, token } = await setup();
    const res = await book(VALID_BODY, await token({ scope: 'appointments:read' }));
    expect(res.status).toBe(403);
  });

  test('corpo inválido: 400', async () => {
    const { book } = await setup();
    expect((await book([1, 2])).status).toBe(400);
    expect((await book({ ...VALID_BODY, date: '20-11-2026' })).status).toBe(400);
    expect((await book({ ...VALID_BODY, time: '08:00' })).status).toBe(400);
  });

  test('médico inexistente: 404', async () => {
    const { book } = await setup();
    expect((await book({ ...VALID_BODY, doctorId: 'doctor-999' })).status).toBe(404);
  });

  test('disponibilidade: banco na 1a consulta, cache na 2a, e o cache é invalidado após agendar', async () => {
    const { app, req, token, book } = await setup({ limit: 50, windowMs: 60_000 });
    const auth = { authorization: `Bearer ${await token()}` };
    const get = () => app.handle(req({ path: '/v1/availability', query: { doctorId: 'doctor-001', date: '2026-11-20' }, headers: auth }));
    const first = await get();
    expect(first.body).toMatchObject({ source: 'database', slots: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] });
    expect((await get()).body).toMatchObject({ source: 'cache' });
    await book(VALID_BODY);
    const after = await get();
    expect(after.body).toMatchObject({ source: 'database' });
    expect((after.body as { slots: string[] }).slots).not.toContain('09:00');
  });

  test('disponibilidade com parâmetros inválidos: 400', async () => {
    const { app, req, token } = await setup();
    const res = await app.handle(req({ path: '/v1/availability', query: { doctorId: 'x' }, headers: { authorization: `Bearer ${await token()}` } }));
    expect(res.status).toBe(400);
  });

  test('x-trace-id válido recebido é propagado; inválido é substituído', async () => {
    const { app, req } = await setup();
    const ok = await app.handle(req({ headers: { 'x-trace-id': 'ffffffffffffffffffffffffffffffff' } }));
    expect(ok.log.traceId).toBe('ffffffffffffffffffffffffffffffff');
    const bad = await app.handle(req({ headers: { 'x-trace-id': 'nao-hex' } }));
    expect(bad.log.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('erro inesperado em um adapter vira 500 sem vazar detalhes', async () => {
    const clock = new FixedClock(T0);
    const repo = new InMemoryAppointmentRepository();
    repo.insertIfSlotFree = async () => {
      throw new Error('db down');
    };
    const lines: string[] = [];
    const key = await importHmacKey(randomKeyBytes());
    const app = createSchedulingApp({
      deps: { repo, cache: new InMemoryCache(), publisher: new InMemoryEventPublisher(), clock },
      logger: new JsonLogger((l) => lines.push(l)),
      jwtKey: key,
      issuer: ISSUER,
      audience: AUDIENCE,
      rateLimit: { limit: 5, windowMs: 1000 },
    });
    const { signJwt } = await import('../src/index');
    const tok = await signJwt({ sub: 'patient-demo-01', iss: ISSUER, aud: AUDIENCE, exp: T0 / 1000 + 60, scope: 'appointments:write' }, key);
    const res = await app.handle({ method: 'POST', path: '/v1/appointments', query: {}, headers: { authorization: `Bearer ${tok}` }, body: VALID_BODY, clientKey: 'c' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error', status: 500 });
    expect(lines[0]).not.toMatch(/db down/);
  });
});
