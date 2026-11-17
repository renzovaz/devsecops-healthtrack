// Demo 3: diagnóstico de latência (estudo, seção 5.8). Dados HIPOTÉTICOS do estudo de caso.
import { runGuard, sleep } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

const STEPS = [
  {
    title: '1 · Alarme',
    stage: 'MON',
    text: 'O CloudWatch dispara um alarme: o scheduling-service está com latência p99 de 4,2 s (o normal é ~200 ms). O limiar do alarme é 2 s, e a equipe é notificada via SNS.',
  },
  {
    title: '2 · Trace Map',
    stage: 'MON',
    text: 'No Trace Map (traces OpenTelemetry armazenados no X-Ray), a equipe vê que o scheduling-service está fazendo chamadas lentas ao RDS PostgreSQL.',
  },
  {
    title: '3 · Trace',
    stage: 'MON',
    text: 'Os traces revelam que uma query específica, a busca de horários disponíveis, está levando 3,8 s.',
    code: 'requisição (p99)                    4,2 s ██████████████████████\n└ query: horários disponíveis (RDS)  3,8 s ███████████████████',
  },
  {
    title: '4 · Logs',
    stage: 'MON',
    text: 'Os logs do CloudWatch mostram que a query faz um full table scan por falta de índice na coluna doctor_id + date.',
  },
  {
    title: '5 · Volta ao DEV',
    stage: 'FEEDBACK → DEV',
    text: 'A equipe cria o índice, testa em staging e faz o deploy pelo pipeline: novo ciclo com CI, todos os gates de segurança, aprovação e Canary.',
    code: '-- ilustrativo\nCREATE INDEX ... ON ... (doctor_id, date);\n\ngit push → CI (testes + SAST/SCA/segredos/IaC/imagem) → staging → aprovação → Canary → produção',
  },
  {
    title: '6 · Normalizado',
    stage: 'MON',
    text: 'A latência volta ao normal em 20 minutos. O ciclo se completa e recomeça.',
  },
];

// Série p99 (segundos) em 30 pontos: normal, pico, recuperação.
const SERIES = Array.from({ length: 30 }, (_, i) => (i < 10 ? 0.2 : i < 22 ? 4.2 : 0.2));
// Quantos pontos aparecem em cada passo (0 = antes de começar).
const VISIBLE = [10, 14, 16, 19, 22, 22, 30];

export function initDiagDemo({ setAlarm }) {
  const root = document.getElementById('diag-demo');
  const list = document.getElementById('diag-steps');
  const chart = document.getElementById('diag-chart');
  const detail = document.getElementById('diag-detail');
  const guard = runGuard();
  let step = 0; // 0 = nada mostrado; 1..6 = passos

  const items = STEPS.map((s) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.textContent = s.title;
    list.append(li);
    return li;
  });

  const W = 600, H = 200, PAD = 28, YMAX = 5;
  const x = (i) => PAD + (i / (SERIES.length - 1)) * (W - PAD - 8);
  const y = (v) => H - 18 - (v / YMAX) * (H - 30);

  function drawChart(n) {
    chart.replaceChildren();
    for (const v of [0, 1, 2, 3, 4, 5]) {
      const l = document.createElementNS(NS, 'line');
      Object.entries({ x1: PAD, x2: W - 8, y1: y(v), y2: y(v), class: 'grid' }).forEach(([k, val]) => l.setAttribute(k, String(val)));
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '2'); t.setAttribute('y', String(y(v) + 4));
      t.textContent = `${v}s`;
      chart.append(l, t);
    }
    const lim = document.createElementNS(NS, 'line');
    Object.entries({ x1: PAD, x2: W - 8, y1: y(2), y2: y(2), class: 'limit' }).forEach(([k, val]) => lim.setAttribute(k, String(val)));
    const limT = document.createElementNS(NS, 'text');
    limT.setAttribute('x', String(W - 150)); limT.setAttribute('y', String(y(2) - 6));
    limT.textContent = 'limiar do alarme: 2 s';
    chart.append(lim, limT);
    const pts = SERIES.slice(0, n).map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', pts);
    pl.setAttribute('class', 'series');
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(PAD + 4)); label.setAttribute('y', '14');
    label.textContent = 'latência p99 do scheduling-service (dados hipotéticos)';
    chart.append(pl, label);
  }

  function render() {
    items.forEach((li, i) => { li.dataset.state = i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''; });
    drawChart(VISIBLE[step]);
    setAlarm(step >= 1 && step <= 5);
    detail.replaceChildren();
    if (step === 0) {
      detail.textContent = 'Clique em “Próximo passo” ou no modo rápido.';
      return;
    }
    const s = STEPS[step - 1];
    const h = document.createElement('strong');
    h.textContent = `${s.title} · etapa ${s.stage}`;
    const p = document.createElement('p');
    p.textContent = s.text;
    detail.append(h, p);
    if (s.code) {
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.textContent = s.code;
      detail.append(pre);
    }
  }

  function next() {
    if (step < STEPS.length) step += 1;
    render();
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button[data-action]') : null;
    if (!btn) return;
    if (btn.dataset.action === 'next') { guard.cancel(); next(); }
    if (btn.dataset.action === 'reset') { guard.cancel(); step = 0; render(); }
    if (btn.dataset.action === 'quick') {
      const t = guard.start();
      step = 0;
      render();
      for (let i = 0; i < STEPS.length; i++) {
        await sleep(i === 0 ? 300 : 2300);
        if (!guard.alive(t)) return;
        next();
      }
    }
  });

  render();
}
