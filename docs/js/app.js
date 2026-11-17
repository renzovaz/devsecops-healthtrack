// Navegação da apresentação: teclado, toque, âncora na URL, traçado de progresso e faixa de segurança.
import { initApiDemo } from './demos/api.js';
import { initPipelineDemo } from './demos/pipeline.js';
import { initArchDemo } from './demos/arch.js';
import { initDiagDemo } from './demos/diag.js';

const slides = [...document.querySelectorAll('.slide')];
const counter = document.getElementById('counter');
const secText = document.getElementById('secband-text');
const srStatus = document.getElementById('sr-status');
const vitals = document.getElementById('vitals');

/** Etapas do ciclo e o slide principal de cada uma. */
export const STAGES = [
  { key: 'dev', label: 'DEV', slide: 'dev', color: 'var(--dev)' },
  { key: 'ci', label: 'CI', slide: 'ci', color: 'var(--ci)' },
  { key: 'sec', label: 'SEC', slide: 'seguranca', color: 'var(--secst)' },
  { key: 'cd', label: 'CD', slide: 'cd', color: 'var(--cd)' },
  { key: 'mon', label: 'MON', slide: 'mon', color: 'var(--mon)' },
  { key: 'fb', label: 'FEEDBACK', slide: 'feedback', color: 'var(--fb)' },
];

let current = 0;

// ---------- Traçado de "sinais vitais" no rodapé ----------
const NS = 'http://www.w3.org/2000/svg';
let tracePath;
let traceLen = 0;

function buildVitals() {
  const n = slides.length;
  const w = 1000 / n;
  let d = 'M0 36';
  slides.forEach((s, i) => {
    const x = i * w;
    const big = s.dataset.stage && s.dataset.stage !== 'none';
    const a = big ? 17 : 7;
    d += ` L${x + w * 0.42} 36 L${x + w * 0.5} ${36 - a} L${x + w * 0.58} ${36 + a * 0.5} L${x + w * 0.64} 36 L${x + w} 36`;
  });
  const bg = document.createElementNS(NS, 'path');
  bg.setAttribute('d', d);
  bg.setAttribute('class', 'trace-bg');
  tracePath = document.createElementNS(NS, 'path');
  tracePath.setAttribute('d', d);
  tracePath.setAttribute('class', 'trace');
  vitals.append(bg, tracePath);
  traceLen = tracePath.getTotalLength();
  tracePath.style.strokeDasharray = `${traceLen}`;
  for (const st of STAGES) {
    const idx = slides.findIndex((s) => s.id === st.slide);
    // Rótulos em HTML (o SVG é esticado na horizontal e deformaria o texto).
    const t = document.createElement('span');
    t.className = 'stage-mark';
    t.style.left = `${((idx + 0.5) / n) * 100}%`;
    t.dataset.stage = st.key;
    t.textContent = st.label;
    document.getElementById('stage-labels').append(t);
  }
}

/** Usado pela demo de diagnóstico: o traçado fica vermelho enquanto o alarme está ativo. */
export function setAlarm(on) {
  tracePath?.classList.toggle('alarm', Boolean(on));
}

// ---------- Anel do ciclo (slide 3) ----------
function arc(cx, cy, r1, r2, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(r2, a0), [x1, y1] = p(r2, a1), [x2, y2] = p(r1, a1), [x3, y3] = p(r1, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${r2} ${r2} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r1} ${r1} 0 ${large} 0 ${x3} ${y3} Z`;
}

function buildRing() {
  const host = document.getElementById('ring');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 400');
  const sec = document.createElementNS(NS, 'circle');
  Object.entries({ cx: 200, cy: 200, r: 190, class: 'secring' }).forEach(([k, v]) => sec.setAttribute(k, String(v)));
  const secTitle = document.createElementNS(NS, 'title');
  secTitle.textContent = 'Segurança transversal (DevSecOps): envolve todas as etapas';
  sec.append(secTitle);
  svg.append(sec);
  const step = (2 * Math.PI) / STAGES.length;
  STAGES.forEach((st, i) => {
    const a0 = -Math.PI / 2 + i * step + 0.03;
    const a1 = a0 + step - 0.06;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'seg');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'link');
    g.setAttribute('aria-label', `Etapa ${i + 1}: ${st.label}. Ir para o slide.`);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', arc(200, 200, 105, 172, a0, a1));
    path.style.fill = st.color;
    const mid = (a0 + a1) / 2;
    const tx = 200 + 138 * Math.cos(mid);
    const ty = 200 + 138 * Math.sin(mid);
    const num = document.createElementNS(NS, 'text');
    num.setAttribute('x', String(tx)); num.setAttribute('y', String(ty - 4));
    num.textContent = String(i + 1);
    const name = document.createElementNS(NS, 'text');
    name.setAttribute('x', String(tx)); name.setAttribute('y', String(ty + 14));
    name.textContent = st.label;
    g.append(path, num, name);
    const goStage = () => go(slides.findIndex((s) => s.id === st.slide));
    g.addEventListener('click', goStage);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        goStage();
      }
    });
    svg.append(g);
  });
  const c1 = document.createElementNS(NS, 'text');
  c1.setAttribute('x', '200'); c1.setAttribute('y', '192'); c1.setAttribute('class', 'center');
  c1.textContent = 'Ciclo DevOps';
  const c2 = document.createElementNS(NS, 'text');
  c2.setAttribute('x', '200'); c2.setAttribute('y', '216'); c2.setAttribute('class', 'center');
  c2.textContent = '↻ volta ao DEV';
  svg.append(c1, c2);
  host.append(svg);
}

// ---------- Navegação ----------
function go(index, { updateHash = true } = {}) {
  const i = Math.max(0, Math.min(slides.length - 1, index));
  slides[current].classList.remove('active');
  slides[current].setAttribute('aria-hidden', 'true');
  current = i;
  const s = slides[i];
  s.classList.add('active');
  s.removeAttribute('aria-hidden');
  counter.textContent = `${i + 1}/${slides.length}`;
  secText.textContent = s.dataset.sec ?? '';
  const progress = (i + 1) / slides.length;
  if (tracePath) tracePath.style.strokeDashoffset = String(traceLen * (1 - progress));
  document.querySelectorAll('#stage-labels .stage-mark').forEach((t) => t.classList.toggle('on', t.dataset.stage === s.dataset.stage));
  srStatus.textContent = `Slide ${i + 1} de ${slides.length}: ${s.getAttribute('aria-label') ?? ''}`;
  if (updateHash && location.hash !== `#${s.id}`) history.replaceState(null, '', `#${s.id}`);
}

function indexFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const i = slides.findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}

function isEditable(el) {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
  const onButton = e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName);
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': go(current + 1); break;
    case 'ArrowLeft': case 'PageUp': go(current - 1); break;
    case 'Home': go(0); break;
    case 'End': go(slides.length - 1); break;
    case ' ':
      if (onButton) return; // espaço aciona o botão focado
      go(current + (e.shiftKey ? -1 : 1));
      break;
    default: return;
  }
  e.preventDefault();
});

document.getElementById('prev').addEventListener('click', () => go(current - 1));
document.getElementById('next').addEventListener('click', () => go(current + 1));
window.addEventListener('hashchange', () => go(indexFromHash(), { updateHash: false }));

// Toque: deslizar na horizontal troca de slide (ignora gestos em campos e áreas roláveis).
let touch = null;
const deck = document.getElementById('deck');
deck.addEventListener('touchstart', (e) => {
  const t = e.target;
  if (isEditable(t) || (t instanceof Element && t.closest('pre, .out, .info'))) { touch = null; return; }
  touch = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
}, { passive: true });
deck.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(current + (dx < 0 ? 1 : -1));
}, { passive: true });

// ---------- Palco fixo 1920x1080 escalado para a tela ----------
const canvas = document.getElementById('canvas');
function fit() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const x = (window.innerWidth - 1920 * scale) / 2;
  const y = (window.innerHeight - 1080 * scale) / 2;
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
window.addEventListener('resize', fit);
fit();

// ---------- Inicialização ----------
slides.forEach((s) => s.setAttribute('aria-hidden', 'true'));
buildVitals();
buildRing();
current = indexFromHash();
slides[current].classList.add('active');
go(current, { updateHash: false });

const safe = (fn, name) => Promise.resolve().then(fn).catch((err) => console.error(`Demo ${name} indisponível:`, err));
safe(initApiDemo, 'API');
safe(initPipelineDemo, 'pipeline');
safe(initArchDemo, 'arquitetura');
safe(() => initDiagDemo({ setAlarm }), 'diagnóstico');
