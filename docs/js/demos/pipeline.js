// Demo 1: simulação, no navegador, dos jobs reais de .github/workflows/ci.yml.
// O "segredo" é falso e montado em tempo de execução: nenhum literal com formato de segredo existe no repositório.
import { reducedMotion, runGuard, sleep } from './util.js';

const JOBS = [
  { id: 'test', name: 'test', desc: 'Jest', sec: false },
  { id: 'sast', name: 'sast', desc: 'CodeQL', sec: true },
  { id: 'sca', name: 'sca', desc: 'npm audit + Trivy fs', sec: true },
  { id: 'secrets', name: 'secrets', desc: 'gitleaks', sec: true },
  { id: 'iac', name: 'iac', desc: 'cdk synth + cdk-nag', sec: true },
  { id: 'image', name: 'image', desc: 'tag = SHA + Trivy', sec: true },
  { id: 'deploy', name: 'deploy', desc: 'no estudo: ECR → CodeDeploy', sec: false },
];
const PARALLEL = ['test', 'sast', 'sca', 'secrets', 'iac'];
const LABEL = { idle: 'aguardando', running: 'executando…', pass: '✓ passou', fail: '✗ falhou', skipped: '– pulado', blocked: '✗ bloqueado' };

function hex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Valor obviamente falso, gerado nesta sessão. */
function fakeSecret() {
  return ['FAKE', 'DEMO', 'NAO', 'USAR', hex(8)].join('-');
}

/** Detector simulado: atribuição de senha/segredo/token a um literal longo. */
function scanForSecrets(lines) {
  const re = /(password|secret|token)\w*\s*=\s*["'][^"']{12,}["']/i;
  const i = lines.findIndex((l) => re.test(l));
  return i >= 0 ? i + 1 : 0;
}

export function initPipelineDemo() {
  const root = document.getElementById('pipe-demo');
  const grid = document.getElementById('pipeline');
  const diff = document.getElementById('pipe-diff');
  const status = document.getElementById('pipe-status');
  const guard = runGuard();
  const injected = { secret: null, dep: false };
  const els = {};

  for (const j of JOBS) {
    const div = document.createElement('div');
    div.className = `job${j.sec ? ' sec-job' : ''}`;
    div.dataset.state = 'idle';
    div.innerHTML = `<span class="name"></span><span class="small muted"></span><span class="st"></span>`;
    div.children[0].textContent = j.name;
    div.children[1].textContent = j.desc;
    grid.append(div);
    els[j.id] = div;
  }

  const set = (id, state, note) => {
    els[id].dataset.state = state;
    els[id].querySelector('.st').textContent = note ?? LABEL[state];
  };

  function renderDiff() {
    const out = [];
    if (injected.secret) {
      out.push('api/src/config.ts');
      // Exibido mascarado: o valor (falso) só existe na memória desta aba.
      out.push(`+ const DB_PASSWORD = "${injected.secret.slice(0, 19)}••••••••";   // falso, gerado agora`);
    }
    if (injected.dep) {
      out.push('package.json');
      out.push('+   "lodash": "4.17.20",');
    }
    diff.textContent = out.length ? out.join('\n') : '// commit: nenhuma alteração injetada';
    root.querySelector('[data-inject="secret"]').setAttribute('aria-pressed', String(Boolean(injected.secret)));
    root.querySelector('[data-inject="dep"]').setAttribute('aria-pressed', String(injected.dep));
  }

  function reset() {
    guard.cancel();
    injected.secret = null;
    injected.dep = false;
    JOBS.forEach((j) => set(j.id, 'idle'));
    status.className = 'status-line';
    status.textContent = 'Pronto. Injete um problema ou execute o pipeline limpo.';
    renderDiff();
  }

  async function run() {
    const t = guard.start();
    const pause = (ms) => sleep(reducedMotion() ? Math.min(ms, 250) : ms);
    const sha = hex(20);
    JOBS.forEach((j) => set(j.id, 'idle'));
    status.className = 'status-line';
    status.textContent = `Executando o pipeline para o commit ${sha.slice(0, 7)} (simulado)…`;
    PARALLEL.forEach((id) => set(id, 'running'));
    await pause(900);
    if (!guard.alive(t)) return;

    const reasons = [];
    const results = {
      test: true,
      sast: true,
      iac: true,
      sca: !injected.dep,
      secrets: true,
    };
    if (injected.dep) reasons.push('SCA: lodash 4.17.20 tem vulnerabilidades HIGH (GHSA-35jh-r3h4-6jhm, injeção de comando; GHSA-r5fr-rjxr-66jc, injeção de código)');
    if (injected.secret) {
      const lines = ['import { loadSettings } from "./settings";', `const DB_PASSWORD = "${injected.secret}";`];
      const line = scanForSecrets(lines);
      if (line) {
        results.secrets = false;
        reasons.push(`Segredos: possível credencial em api/src/config.ts:${line} (valor mascarado no relatório)`);
      }
    }
    for (const id of PARALLEL) {
      set(id, results[id] ? 'pass' : 'fail');
      await pause(260);
      if (!guard.alive(t)) return;
    }
    if (reasons.length) {
      set('image', 'skipped', '– não executado');
      set('deploy', 'blocked');
      status.className = 'status-line fail';
      status.textContent = `Deploy BLOQUEADO. ${reasons.join(' · ')}. Corrija e faça um novo push: o pipeline roda de novo.`;
      return;
    }
    set('image', 'running');
    await pause(900);
    if (!guard.alive(t)) return;
    set('image', 'pass', `✓ scheduling-service:${sha.slice(0, 7)}…`);
    set('deploy', 'pass', '✓ liberado');
    status.className = 'status-line ok';
    status.textContent = `Todos os gates passaram. No estudo, a imagem com tag = SHA iria para o ECR e o CodeDeploy (aqui não há push nem deploy).`;
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn) return;
    if (btn.dataset.inject === 'secret') { injected.secret = injected.secret ? null : fakeSecret(); renderDiff(); }
    if (btn.dataset.inject === 'dep') { injected.dep = !injected.dep; renderDiff(); }
    if (btn.dataset.action === 'run') await run();
    if (btn.dataset.action === 'reset') reset();
    if (btn.dataset.action === 'quick') {
      reset();
      injected.secret = fakeSecret();
      injected.dep = true;
      renderDiff();
      await run();
    }
  });

  reset();
}
