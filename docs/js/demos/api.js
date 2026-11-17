// Cliente de API: executa o MESMO núcleo compilado (docs/js/core) que a API Express usa no container.
import {
  createSchedulingApp,
  importHmacKey,
  InMemoryAppointmentRepository,
  InMemoryCache,
  InMemoryEventPublisher,
  JsonLogger,
  randomKeyBytes,
  signJwt,
  SystemClock,
} from '../core/index.js';
import { pretty, runGuard, sleep } from './util.js';

const ISSUER = 'https://auth.healthtrack.example';
const AUDIENCE = 'healthtrack-api';
const RATE = { limit: 5, windowMs: 60_000 };
const VALID_BODY = { doctorId: 'doctor-001', date: '2026-11-20', time: '09:00' };
const REASONS = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error' };

export async function initApiDemo() {
  const root = document.getElementById('api-demo');
  const $ = (id) => document.getElementById(id);
  const routeSel = $('api-route');
  const tokenBox = $('api-token');
  const bodyBox = $('api-body');
  const guard = runGuard();

  // Chaves geradas NESTA sessão do navegador: nenhum segredo existe no repositório.
  const key = await importHmacKey(randomKeyBytes());
  const foreignKey = await importHmacKey(randomKeyBytes());
  let app;
  let lastLog = '';

  function freshApp() {
    app = createSchedulingApp({
      deps: { repo: new InMemoryAppointmentRepository(), cache: new InMemoryCache(), publisher: new InMemoryEventPublisher(), clock: new SystemClock() },
      logger: new JsonLogger((line) => { lastLog = line; }),
      jwtKey: key,
      issuer: ISSUER,
      audience: AUDIENCE,
      rateLimit: RATE,
    });
  }

  const token = (sub = 'patient-demo-01', k = key) => {
    const now = Math.floor(Date.now() / 1000);
    return signJwt({ sub, iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 3600, scope: 'appointments:write' }, k);
  };

  function parseRoute(value) {
    const [method, target] = value.split(' ');
    const url = new URL(target, 'https://api.healthtrack.example');
    return { method, path: url.pathname, query: Object.fromEntries(url.searchParams) };
  }

  async function call({ route, tok, body }) {
    const { method, path, query } = parseRoute(route);
    const headers = { 'content-type': 'application/json' };
    if (tok) headers.authorization = `Bearer ${tok}`;
    return app.handle({ method, path, query, headers, body, clientKey: 'demo-browser' });
  }

  function show(res) {
    const st = $('api-status');
    st.textContent = `${res.status} ${REASONS[res.status] ?? ''}`;
    st.className = `http-status s${String(res.status)[0]}`;
    const hdrs = Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    $('api-response').textContent = `${hdrs}\n\n${pretty(res.body)}`;
    $('api-event').textContent = res.event ? pretty(res.event) : '— (sem agendamento criado, nenhum evento)';
    $('api-log').textContent = lastLog || '—'; // uma linha JSON, como no CloudWatch Logs
  }

  async function sendFromForm() {
    let body;
    if (routeSel.value.startsWith('POST')) {
      try { body = JSON.parse(bodyBox.value || '{}'); } catch {
        $('api-status').textContent = 'JSON inválido';
        $('api-status').className = 'http-status s4';
        $('api-response').textContent = 'O corpo não é um JSON válido (na API Express, isso vira 400 antes de chegar ao núcleo).';
        return;
      }
    }
    show(await call({ route: routeSel.value, tok: tokenBox.value.trim(), body }));
  }

  async function fillForm(route, tok, body) {
    routeSel.value = route;
    tokenBox.value = tok ?? '';
    bodyBox.value = body ? pretty(body) : '';
  }

  const scenarios = {
    async ok() {
      freshApp();
      await fillForm('POST /v1/appointments', await token(), VALID_BODY);
      await sendFromForm();
    },
    async badtoken() {
      freshApp();
      // Token assinado com OUTRA chave: o autorizador rejeita a assinatura.
      await fillForm('POST /v1/appointments', await token('patient-demo-01', foreignKey), VALID_BODY);
      await sendFromForm();
    },
    async conflict() {
      freshApp();
      await call({ route: 'POST /v1/appointments', tok: await token('patient-demo-02'), body: VALID_BODY }); // outro paciente já reservou
      await fillForm('POST /v1/appointments', await token(), VALID_BODY);
      await sendFromForm();
    },
    async ratelimit() {
      freshApp();
      const tok = await token();
      const route = 'GET /v1/availability?doctorId=doctor-001&date=2026-11-20';
      for (let i = 0; i < RATE.limit; i++) await call({ route, tok });
      await fillForm(route, tok, null);
      await sendFromForm();
      $('api-response').textContent += `\n\n(${RATE.limit} requisições já feitas nesta janela de 60 s)`;
    },
  };

  root.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn) return;
    const sc = btn.dataset.scenario;
    const action = btn.dataset.action;
    if (sc) { guard.cancel(); await scenarios[sc](); }
    if (action === 'send') await sendFromForm();
    if (action === 'reset') { guard.cancel(); await reset(); }
    if (action === 'quick') {
      const t = guard.start();
      for (const name of ['ok', 'badtoken', 'conflict', 'ratelimit']) {
        if (!guard.alive(t)) return;
        await scenarios[name]();
        await sleep(2200);
      }
    }
  });

  async function reset() {
    freshApp();
    lastLog = '';
    await fillForm('POST /v1/appointments', await token(), VALID_BODY);
    $('api-status').textContent = '—';
    $('api-status').className = 'http-status';
    $('api-response').textContent = 'Escolha um cenário ou envie uma requisição.';
    $('api-event').textContent = '— (só existe quando um agendamento é criado)';
    $('api-log').textContent = '—';
  }

  await reset();
}
