import { setup, TRACE, VALID_BODY } from './helpers';

/** Os 4 cenários exibidos no cliente de API da apresentação. */
describe('cenários da apresentação', () => {
  test('201: agendamento válido gera resposta, evento para o SQS e log JSON', async () => {
    const { book, publisher, lines } = await setup();
    const res = await book(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ appointmentId: 'appt-doctor-001-2026-11-20-0900', doctorId: 'doctor-001', date: '2026-11-20', time: '09:00', status: 'CONFIRMED' });
    expect(res.headers['location']).toBe('/v1/appointments/appt-doctor-001-2026-11-20-0900');
    expect(res.event).toMatchObject({ eventType: 'AppointmentCreated', version: 1, traceId: TRACE, data: { doctorId: 'doctor-001', patientId: 'patient-demo-01' } });
    expect(publisher.published).toHaveLength(1);
    const log = JSON.parse(lines[0]!);
    expect(log).toEqual({ timestamp: expect.any(String), level: 'info', service: 'scheduling-service', traceId: TRACE, route: 'POST /v1/appointments', status: 201, durationMs: 0, message: 'appointment created' });
  });

  test('401: token assinado com outra chave é rejeitado, sem evento', async () => {
    const { book, foreignToken, publisher, lines } = await setup();
    const res = await book(VALID_BODY, await foreignToken());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(res.event).toBeUndefined();
    expect(publisher.published).toHaveLength(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', status: 401, message: 'jwt rejected: bad_signature' });
  });

  test('409: horário já ocupado', async () => {
    const { book, token, publisher } = await setup();
    expect((await book(VALID_BODY)).status).toBe(201);
    const res = await book(VALID_BODY, await token({ sub: 'patient-demo-02' }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'conflict' });
    expect(res.event).toBeUndefined();
    expect(publisher.published).toHaveLength(1);
  });

  test('429: excesso de requisições, com Retry-After', async () => {
    const { app, req, token } = await setup({ limit: 3, windowMs: 60_000 });
    const auth = { authorization: `Bearer ${await token()}` };
    const call = () => app.handle(req({ path: '/v1/availability', query: { doctorId: 'doctor-001', date: '2026-11-20' }, headers: auth }));
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  test('logs nunca contêm o identificador do paciente (LGPD)', async () => {
    const { book, token, lines } = await setup();
    await book(VALID_BODY);
    await book(VALID_BODY, await token({ sub: 'patient-demo-02' }));
    await book({ ...VALID_BODY, time: '25:00' });
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l).not.toMatch(/patient-demo/);
  });
});
