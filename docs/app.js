const SITE = {
  authors: ['Nilson Rodriguez Cadenas', 'Zachary Elders', 'Sarkis Gafafyan', 'Tengjian Guo', 'Khang Thai', 'Bowen Jiang', 'Edward Shao'],
  codeUrl: 'https://github.com/zcashe/cosmos-robometer',
  reportUrl: ''
};

const NS = 'http://www.w3.org/2000/svg';
const MEDIA = 'shared/';
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

function h(tag, attrs, parent, text) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function s(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const pc = (x, d = 1) => (x * 100).toFixed(d);
const sg = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);
const fmt = n => n.toLocaleString('en-US');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setupSite() {
  const a = document.getElementById('site-authors');
  if (SITE.authors.length) { a.textContent = SITE.authors.join(', '); a.hidden = false; }
  const box = document.getElementById('site-links');
  for (const [lab, url] of [['Code', SITE.codeUrl], ['Report', SITE.reportUrl]]) {
    if (!url) continue;
    box.appendChild(document.createTextNode(' · '));
    h('a', { href: url, target: '_blank', rel: 'noopener' }, box, lab);
  }
}

const tip = h('div', { class: 'tip', role: 'tooltip' });
Object.assign(tip.style, { position: 'fixed', pointerEvents: 'none', zIndex: 20, display: 'none' });
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() { tip.style.display = 'none'; }

const redraws = [];
function responsive(el, fn) {
  let last = 0;
  const run = () => {
    const w = Math.floor(el.clientWidth);
    if (!w || w === last) return;
    last = w;
    fn(w);
  };
  redraws.push(() => { last = 0; run(); });
  if ('ResizeObserver' in window) new ResizeObserver(run).observe(el);
  else window.addEventListener('resize', run);
  run();
}

const G = { d: null, r: 0, res: [], revealed: false, mons: [], paused: RM.matches, done: false };

function gameInit(D) {
  G.d = D.game;
  G.D = D;
  document.body.appendChild(tip);
  const pips = document.getElementById('g-pips');
  G.d.forEach((_, i) => h('li', { 'aria-label': 'Round ' + (i + 1) }, pips, String(i + 1)));
  const foot = document.querySelector('.g-foot');
  const pb = h('button', { type: 'button', class: 'link-btn', id: 'g-pause' }, null, G.paused ? 'Play video' : 'Pause video');
  foot.insertBefore(pb, foot.querySelector('.g-caveat'));
  pb.style.marginLeft = 'auto';
  pb.addEventListener('click', () => {
    G.paused = !G.paused;
    pb.textContent = G.paused ? 'Play video' : 'Pause video';
    G.mons.forEach(m => { if (G.paused) m.v.pause(); else m.v.play().catch(() => {}); });
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const r = document.getElementById('judge').getBoundingClientRect();
    if (r.bottom < 80 || r.top > window.innerHeight - 80) return;
    if (!G.revealed && /^[1-4]$/.test(e.key)) { reveal(+e.key - 1); e.preventDefault(); }
    else if (G.revealed && (e.key === 'n' || e.key === 'N')) { next(); }
  });
  renderRound();
  requestAnimationFrame(tick);
}

function renderRound() {
  const R = G.d[G.r];
  G.revealed = false;
  G.done = false;
  const nov = R.suite === 'novel';
  document.getElementById('g-meta').textContent = 'Round ' + (G.r + 1) + ' of ' + G.d.length + ' · ' + (nov ? 'new cluttered task' : 'LIBERO-Spatial, scene shifted 10 cm') + ' · the instruction:';
  document.getElementById('g-instr').textContent = R.instruction;
  [...document.getElementById('g-pips').children].forEach((li, i) => {
    li.className = (i === G.r ? 'cur ' : '') + (G.res[i] ? (G.res[i].you ? 'won' : 'lost') : '');
    if (i === G.r) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  const box = document.getElementById('monitors');
  box.classList.remove('revealed');
  box.innerHTML = '';
  G.mons = R.clips.map((c, i) => buildMon(c, i, box));
  const msg = document.getElementById('g-msg');
  msg.innerHTML = '';
  h('p', { class: 'g-lead' }, msg, 'Four attempts by the same policy from the same start. Click the one you would keep.');
  h('p', { class: 'g-note' }, msg, 'Robometer makes this same call from 8 frames and the instruction. That is how the training data was chosen.');
  renderScore();
  preloadNext();
}

function preloadNext() {
  const N = G.d[G.r + 1];
  if (!N) return;
  N.clips.forEach(c => { const i = new Image(); i.src = MEDIA + 'clips/' + c.stem + '_first.jpg'; });
}

function buildMon(c, i, box) {
  const m = { c, i };
  const el = h('div', { class: 'mon' }, box);
  const hd = h('div', { class: 'mon-h' }, el);
  h('span', { class: 'mon-ch' }, hd, 'Attempt ' + (i + 1));
  m.tags = h('span', { class: 'tags' }, hd);
  const sc = h('div', { class: 'screen' }, el);
  const v = h('video', {
    muted: '', loop: '', playsinline: '', preload: 'auto',
    poster: MEDIA + 'clips/' + c.stem + '_first.jpg',
    'aria-label': 'Attempt ' + (i + 1) + ': robot rollout video, 4 seconds'
  }, sc);
  v.muted = true;
  v.src = MEDIA + 'clips/' + c.stem + '.mp4';
  if (!G.paused) { v.autoplay = true; v.play().catch(() => {}); }
  m.v = v;
  const k = h('button', { type: 'button', class: 'keep', 'aria-label': 'Keep attempt ' + (i + 1) }, sc);
  h('span', null, k, 'Keep ' + (i + 1));
  k.addEventListener('click', () => reveal(i));
  const tr = h('div', { class: 'trace' }, el);
  m.svg = buildTrace(c, i, tr);
  const ro = h('div', { class: 'mon-r' }, el);
  m.ro = [0, 1, 2].map(j => {
    const d = h('div', null, ro);
    h('span', { class: 'lbl' }, d, ['Outcome', 'LIBERO', 'Base'][j]);
    return h('span', { class: 'v v-off' }, d, '—');
  });
  m.el = el;
  m.full = false;
  m.last = 0;
  return m;
}

function buildTrace(c, i, parent) {
  const W = 256, PT = 5, PH = 58, SY = 70, SH = 32;
  const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + (SY + SH), role: 'img', 'aria-label': 'Judge input: 8 frames of attempt ' + (i + 1) + '. Judge traces appear after your pick.' }, parent);
  const y = v => PT + (1 - v) * PH;
  const g = s('g', null, svg);
  [0, 0.5, 1].forEach(v => s('line', { x1: 0, x2: W, y1: y(v), y2: y(v), stroke: 'var(--rule)', 'stroke-width': v === 0.5 ? 0.6 : 0.8, 'stroke-dasharray': v === 0.5 ? '2 3' : '' }, g));
  s('text', { x: 2, y: y(1) + 8, class: 'tx', style: 'font-size:8px' }, g, '1');
  s('text', { x: 2, y: y(0) - 2, class: 'tx', style: 'font-size:8px' }, g, '0');
  s('image', { href: MEDIA + 'clips/' + c.stem + '_strip.jpg', x: 0, y: SY, width: W, height: SH, preserveAspectRatio: 'none' }, svg);
  for (let k = 0; k < 8; k++) s('line', { x1: (k + 0.5) * 32, x2: (k + 0.5) * 32, y1: SY - 3, y2: SY, stroke: 'var(--ink-3)', 'stroke-width': 0.8 }, svg);
  const wait = s('text', { x: W / 2, y: PT + PH / 2 + 4, 'text-anchor': 'middle', class: 'tx', style: 'font:400 11px var(--f-ui)' }, svg, 'Judge scores appear after you pick');
  const cid = 'cp' + G.r + '_' + i;
  const cp = s('clipPath', { id: cid }, svg);
  const cr = s('rect', { x: 0, y: 0, width: 0, height: SY }, cp);
  const tg = s('g', { 'clip-path': 'url(#' + cid + ')', visibility: 'hidden' }, svg);
  const ghost = s('g', { visibility: 'hidden', opacity: 0.22 }, svg);
  const path = arr => arr.map((v, k) => (k ? 'L' : 'M') + ((k + 0.5) * 32).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const series = [
    ['base_success', 'var(--base-j)', 1.3, ''],
    ['libero_progress', 'var(--pick)', 1.3, '3 2.5'],
    ['libero_success', 'var(--pick)', 2, '']
  ];
  for (const tgt of [ghost, tg]) {
    for (const [key, col, sw, da] of series) {
      s('path', { d: path(c.curves[key]), fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-dasharray': da, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, tgt);
    }
    c.curves.libero_success.forEach((v, k) => s('circle', { cx: (k + 0.5) * 32, cy: y(v), r: 1.8, fill: 'var(--pick)' }, tgt));
  }
  const sc = s('g', { visibility: 'hidden' }, svg);
  s('path', { d: 'M' + W + ' ' + y(c.libero_score) + 'l-7 -3.5v7z', fill: 'var(--pick)' }, sc);
  s('path', { d: 'M' + W + ' ' + y(c.base_score) + 'l-7 -3.5v7z', fill: 'var(--base-j)' }, sc);
  const ph = s('line', { x1: 0, x2: 0, y1: 0, y2: SY + SH, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0.8 }, svg);
  return { svg, wait, cr, tg, ghost, ph, W, sc };
}

function tick() {
  for (const m of G.mons) {
    const v = m.v;
    const d = v.duration;
    if (!d || !isFinite(d)) continue;
    const f = clamp(v.currentTime / d, 0, 1);
    const x = f * m.svg.W;
    m.svg.ph.setAttribute('x1', x);
    m.svg.ph.setAttribute('x2', x);
    if (G.revealed) {
      if (f + 0.02 < m.last) m.full = true;
      m.svg.cr.setAttribute('width', (m.full || G.paused) ? m.svg.W : x);
    }
    m.last = f;
  }
  requestAnimationFrame(tick);
}

function reveal(pick) {
  if (G.revealed) return;
  const R = G.d[G.r];
  G.revealed = true;
  document.getElementById('monitors').classList.add('revealed');
  const maxL = Math.max(...R.clips.map(c => c.libero_score));
  const maxB = Math.max(...R.clips.map(c => c.base_score));
  G.mons.forEach((m, i) => {
    const c = m.c;
    if (c.success) m.el.classList.add('is-ok');
    if (i === pick) { m.el.classList.add('is-you'); h('span', { class: 'tag tag-you' }, m.tags, 'You'); }
    if (i === R.libero_pick) h('span', { class: 'tag tag-lib', title: 'LIBERO-finetuned judge pick' }, m.tags, 'LIBERO');
    if (i === R.base_pick) h('span', { class: 'tag tag-base', title: 'Base judge pick' }, m.tags, 'Base');
    m.ro[0].className = 'v';
    m.ro[0].innerHTML = (c.success ? '<span style="color:var(--ok)">Success</span>' : 'Failed') + '<small>' + c.steps + ' steps</small>';
    m.ro[0].title = (c.success ? 'Succeeded' : 'Failed') + ' in ' + c.steps + ' steps';
    m.ro[1].className = 'v ' + (c.libero_score === maxL ? 'v-lib' : 'v-off');
    m.ro[1].textContent = c.libero_score.toFixed(2);
    m.ro[2].className = 'v' + (c.base_score === maxB ? '' : ' v-off');
    m.ro[2].textContent = c.base_score.toFixed(2);
    m.svg.wait.setAttribute('visibility', 'hidden');
    m.svg.tg.setAttribute('visibility', 'visible');
    m.svg.ghost.setAttribute('visibility', 'visible');
    m.svg.sc.setAttribute('visibility', 'visible');
    m.svg.svg.setAttribute('aria-label', 'Attempt ' + (i + 1) + ' judge traces. LIBERO-finetuned judge success per frame: ' + c.curves.libero_success.map(v => v.toFixed(2)).join(', ') + '. Base judge success per frame: ' + c.curves.base_success.map(v => v.toFixed(2)).join(', ') + '.');
    m.full = !!G.paused;
    m.last = 0;
    m.v.currentTime = 0;
    if (!G.paused) m.v.play().catch(() => {});
  });
  const res = { you: R.clips[pick].success, lib: R.clips[R.libero_pick].success, base: R.clips[R.base_pick].success, pick };
  G.res[G.r] = res;
  const li = document.getElementById('g-pips').children[G.r];
  li.className = 'cur ' + (res.you ? 'won' : 'lost');
  const msg = document.getElementById('g-msg');
  msg.innerHTML = '';
  const box = h('div', { class: 'g-res' }, msg);
  const nOk = R.clips.filter(c => c.success).length;
  const line = (who, i, ok) => {
    const r = h('div', { class: 'g-res-row' }, box);
    h('span', { class: 'who' }, r, who);
    h('span', null, r, 'kept attempt ' + (i + 1) + ': ');
    h('b', { style: ok ? 'color:var(--ok)' : '' }, r, ok ? 'success' : 'failure');
  };
  line('You', pick, res.you);
  line('LIBERO judge', R.libero_pick, res.lib);
  line('Base judge', R.base_pick, res.base);
  h('p', { class: 'g-why' }, msg, nOk + ' of 4 attempts succeeded. ' + R.why);
  const act = h('div', { class: 'g-act' }, msg);
  const last = G.r === G.d.length - 1;
  const b = h('button', { type: 'button', class: 'btn', id: 'g-next' }, act, last ? 'See final score' : 'Next round');
  b.addEventListener('click', next);
  h('span', { class: 'kbd-hint' }, act, 'or press N');
  renderScore();
  b.focus({ preventScroll: true });
}

function next() {
  if (!G.revealed) return;
  if (G.done) return;
  if (G.r < G.d.length - 1) { G.r++; renderRound(); return; }
  finish();
}

function finish() {
  G.done = true;
  const n = G.d.length;
  const cnt = k => G.res.filter(r => r && r[k]).length;
  const possible = G.d.filter(R => R.clips.some(c => c.success)).length;
  const ns = G.D.novel_stats;
  const msg = document.getElementById('g-msg');
  msg.innerHTML = '';
  const box = h('div', { class: 'g-res' }, msg);
  [['You', cnt('you')], ['LIBERO judge', cnt('lib')], ['Base judge', cnt('base')]].forEach(([w, v]) => {
    const r = h('div', { class: 'g-res-row' }, box);
    h('span', { class: 'who' }, r, w);
    h('b', { class: 'num' }, r, v + ' of ' + n);
    h('span', null, r, 'rounds with a successful pick');
  });
  h('p', { class: 'g-why' }, msg, 'A success was there to pick in ' + possible + ' of ' + n + ' rounds. These rounds were chosen to show disagreements, so they are not a fair measure of either judge. On all 125 novel start states, best-of-8 picked by the LIBERO-finetuned judge reaches ' + pc(ns.curve[7].libero) + '% against a ' + pc(ns.curve[7].oracle) + '% ceiling.');
  const act = h('div', { class: 'g-act' }, msg);
  const b = h('button', { type: 'button', class: 'btn' }, act, 'Play again');
  b.addEventListener('click', () => { G.res = []; G.r = 0; renderRound(); });
  const a = h('a', { class: 'btn btn-q', href: '#distill' }, act, 'How the picks became training data');
  a.style.textDecoration = 'none';
  b.focus({ preventScroll: true });
}

function renderScore() {
  const box = document.getElementById('g-score');
  box.innerHTML = '';
  const hd = h('div', { class: 'sc-row' }, box);
  h('span', { class: 'lbl' }, hd, 'Scoreboard');
  h('span', { class: 'lbl' }, hd, 'Picked a success');
  h('span', { class: 'lbl', style: 'text-align:right' }, hd, '');
  const played = G.res.filter(Boolean).length;
  [['You', 'you', 'var(--ink)'], ['LIBERO judge', 'lib', 'var(--pick)'], ['Base judge', 'base', 'var(--base-j)']].forEach(([w, k, col]) => {
    const r = h('div', { class: 'sc-row' }, box);
    const who = h('span', { class: 'sc-who' }, r);
    h('i', { class: 'sc-key', style: 'background:' + col }, who);
    who.appendChild(document.createTextNode(w));
    const l = h('span', { class: 'sc-lamps', 'aria-hidden': 'true' }, r);
    G.d.forEach((_, i) => h('i', { class: G.res[i] ? (G.res[i][k] ? 'y' : 'n') : '' }, l));
    const c = G.res.filter(x => x && x[k]).length;
    h('span', { class: 'sc-n' }, r, played ? c + '/' + played : '–');
  });
}

function drawShift(D) {
  const el = document.getElementById('chart-shift');
  const order = ['none', 'shift', 'layout', 'table', 'tint', 'camera'];
  const rows = [...D.shift].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  responsive(el, w => {
    el.innerHTML = '';
    const narrow = w < 520;
    const LW = narrow ? 0 : Math.min(220, w * 0.36);
    const RH = narrow ? 40 : 28, TOP = 4, AX = 22;
    const VW = 100;
    const x0 = LW, x1 = w - VW;
    let yy = TOP, prev = null;
    const ys = rows.map(r => { if (prev && prev !== r.kind) yy += 8; prev = r.kind; const v = yy; yy += RH; return v; });
    const H = yy + AX;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + H, width: w, height: H, role: 'img', 'aria-label': 'Base policy success under each perturbation, 30 episodes each. ' + rows.map(r => r.label + ' ' + pc(r.success, 0) + '%').join('; ') });
    el.appendChild(svg);
    const X = v => x0 + v * (x1 - x0);
    const gr = s('g', { class: 'grid' }, svg);
    [0, 0.25, 0.5, 0.75, 1].forEach(v => {
      s('line', { x1: X(v), x2: X(v), y1: TOP - 2, y2: H - AX + 2 }, gr);
      s('text', { x: X(v), y: H - 6, 'text-anchor': v === 0 ? 'start' : v === 1 ? 'end' : 'middle', class: 'tx' }, svg, pc(v, 0) + '%');
    });
    rows.forEach((r, i) => {
      const key = r.id === 'loc_shift10';
      const y = ys[i];
      const by = narrow ? y + 18 : y + 6;
      const bh = narrow ? 12 : 12;
      if (narrow) s('text', { x: 0, y: y + 12, class: 'tl', style: key ? 'fill:var(--ink)' : '' }, svg, r.label);
      else s('text', { x: LW - 10, y: y + 16, 'text-anchor': 'end', class: 'tl', style: key ? 'fill:var(--ink)' : '' }, svg, r.label);
      const b = s('rect', { x: X(0), y: by, width: Math.max(1, X(r.success) - X(0)), height: bh, fill: key ? 'var(--ink)' : 'var(--ink-3)', rx: 1 }, svg);
      s('title', null, b, r.label + ': ' + Math.round(r.success * r.episodes) + ' of ' + r.episodes + ' episodes');
      s('text', { x: x1 + 8, y: by + 10, class: 'tv' }, svg, pc(r.success, 0) + '%');
      s('text', { x: w, y: by + 10, 'text-anchor': 'end', class: 'tvs' }, svg, Math.round(r.success * r.episodes) + '/' + r.episodes);
    });
  });
}

const T = { j: 'l', th: 0.5, D: null, sorted: [] };
function thrInit(D) {
  T.D = D;
  const tr = D.setup.training;
  T.samples = tr.batch * tr.grad_accum * tr.iters;
  const el = document.getElementById('chart-thr');
  const fader = document.getElementById('fader');
  document.querySelectorAll('#thr-judge .seg-b').forEach(b => b.addEventListener('click', () => {
    T.j = b.dataset.j;
    document.querySelectorAll('#thr-judge .seg-b').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    thrSort(); thrDraw(); thrUpdate();
  }));
  document.getElementById('thr-reset').addEventListener('click', () => { T.th = 0.5; thrUpdate(); });
  fader.addEventListener('keydown', e => {
    const st = e.shiftKey ? 0.1 : 0.01;
    let v = T.th;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v += st;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v -= st;
    else if (e.key === 'PageUp') v += 0.1;
    else if (e.key === 'PageDown') v -= 0.1;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 1;
    else return;
    e.preventDefault();
    T.th = Math.round(clamp(v, 0, 1) * 100) / 100;
    thrUpdate();
  });
  const fromY = (cy, rect) => {
    const v = 1 - (cy - rect.top - T.PT) / T.PH;
    T.th = Math.round(clamp(v, 0, 1) * 100) / 100;
    thrUpdate();
  };
  let drag = null;
  fader.addEventListener('pointerdown', e => { drag = fader; fader.setPointerCapture(e.pointerId); fromY(e.clientY, el.getBoundingClientRect()); fader.focus({ preventScroll: true }); });
  fader.addEventListener('pointermove', e => { if (drag === fader) fromY(e.clientY, el.getBoundingClientRect()); });
  fader.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('pointerdown', e => {
    const rect = el.getBoundingClientRect();
    const ly = T.PT + (1 - T.th) * T.PH + rect.top;
    if (Math.abs(e.clientY - ly) < 16) { drag = el; el.setPointerCapture(e.pointerId); e.preventDefault(); }
    else thrHover(e, rect);
  });
  el.addEventListener('pointermove', e => {
    const rect = el.getBoundingClientRect();
    if (drag === el) fromY(e.clientY, rect); else thrHover(e, rect);
  });
  el.addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('pointercancel', () => { drag = null; });
  thrSort();
  responsive(el, w => { T.w = w; thrDraw(); thrUpdate(); });
}
function thrSort() {
  const j = T.j;
  const real = new Map(T.D.summary.find(x => x.id === (j === 'l' ? 'rbmlib' : 'rbm2')).set.keys.map(k => [k[0] + '_' + k[1], k[2]]));
  T.sorted = T.D.pool.map(r => {
    let bi = 0;
    r.a.forEach((a, i) => { if (a[j] > r.a[bi][j]) bi = i; });
    const rk = real.get(r.t + '_' + r.e);
    if (rk != null && r.a[rk][j] === r.a[bi][j]) bi = rk;
    return { r, bi, sc: r.a[bi][j], ok: r.a[bi].s, n: r.a[bi].n, any: r.a.some(a => a.s) };
  }).sort((a, b) => b.sc - a.sc);
}
function thrDraw() {
  const el = document.getElementById('chart-thr');
  const w = T.w;
  if (!w) return;
  el.innerHTML = '';
  const narrow = w < 520;
  const H = narrow ? 210 : 250;
  T.PT = 10; T.PB = 26; T.PH = H - T.PT - T.PB;
  const L = 30, R = 4;
  T.L = L; T.bw = (w - L - R) / 250;
  const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + H, width: w, height: H, role: 'img', 'aria-label': '250 training start states sorted by the judge’s top score, with the threshold line.' });
  el.appendChild(svg);
  const Y = v => T.PT + (1 - v) * T.PH;
  const gr = s('g', { class: 'grid' }, svg);
  [0, 0.25, 0.5, 0.75, 1].forEach(v => {
    s('line', { x1: L, x2: w - R, y1: Y(v), y2: Y(v) }, gr);
    s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tx' }, svg, v.toFixed(2));
  });
  s('text', { x: L, y: H - 6, class: 'tx' }, svg, narrow ? '← highest' : 'highest score');
  s('text', { x: w - R, y: H - 6, 'text-anchor': 'end', class: 'tx' }, svg, narrow ? '250 states · lowest →' : '250 states, sorted → lowest');
  T.bars = T.sorted.map((d, i) => {
    const x = L + i * T.bw;
    const y = Y(d.sc);
    return s('rect', { x: x + (T.bw > 3 ? 0.5 : 0), y: Math.min(y, Y(0) - 1.5), width: Math.max(0.6, T.bw - (T.bw > 3 ? 1 : 0.2)), height: Math.max(1.5, Y(0) - y) }, svg);
  });
  T.used = s('g', null, svg);
  s('line', { x1: L, x2: w - R, y1: Y(0.5), y2: Y(0.5), stroke: 'var(--ink-3)', 'stroke-dasharray': '2 3' }, T.used);
  s('text', { x: w - R, y: Y(0.5) - 5, 'text-anchor': 'end', class: 'tx' }, T.used, 'used for training: 0.50');
  T.line = s('line', { x1: L - 4, x2: w - R, stroke: 'var(--pick)', 'stroke-width': 2 }, svg);
  T.hl = s('rect', { fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1, visibility: 'hidden', class: 'hov' }, svg);
  const f = document.getElementById('fader');
  f.style.height = H + 'px';
  f.style.setProperty('--pt', T.PT + 'px');
  f.style.setProperty('--pb', T.PB + 'px');
}
function thrUpdate() {
  if (!T.bars) return;
  const th = T.th;
  let kept = 0, ok = 0, steps = 0, lost = 0;
  T.sorted.forEach((d, i) => {
    const k = d.sc >= th;
    if (k) { kept++; ok += d.ok; steps += d.n; } else if (d.ok) lost++;
    T.bars[i].setAttribute('fill', k ? (d.ok ? 'var(--ok)' : 'var(--ink-2)') : (d.ok ? 'var(--ok-dim)' : 'var(--rule-2)'));
  });
  const Y = v => T.PT + (1 - v) * T.PH;
  T.line.setAttribute('y1', Y(th));
  T.line.setAttribute('y2', Y(th));
  T.used.setAttribute('visibility', Math.abs(th - 0.5) < 0.005 ? 'hidden' : 'visible');
  const f = document.getElementById('fader');
  f.setAttribute('aria-valuenow', th.toFixed(2));
  f.setAttribute('aria-valuetext', th.toFixed(2) + ': ' + kept + ' states kept, ' + ok + ' really succeeded');
  document.getElementById('fader-knob').style.top = Y(th) + 'px';
  document.getElementById('fader-fill').style.height = ((1 - th) * 100) + '%';
  document.getElementById('fader-val').textContent = th.toFixed(2);
  const ro = document.getElementById('thr-ro');
  ro.innerHTML = 'At <b>' + th.toFixed(2) + '</b> the ' + (T.j === 'l' ? 'LIBERO-finetuned' : 'base') + ' judge keeps <b>' + kept + '</b> of 250 start states. <b>' + ok + '</b> of those picks really succeeded, ' + (kept - ok) + ' failed, and ' + lost + ' good picks are thrown away.';
}
function thrHover(e, rect) {
  const x = e.clientX - rect.left;
  const i = Math.floor((x - T.L) / T.bw);
  const out = document.getElementById('thr-hover');
  if (i < 0 || i >= 250) { T.hl.setAttribute('visibility', 'hidden'); return; }
  const d = T.sorted[i];
  const b = T.bars[i];
  T.hl.setAttribute('x', +b.getAttribute('x') - 1);
  T.hl.setAttribute('width', Math.max(3, +b.getAttribute('width') + 2));
  T.hl.setAttribute('y', T.PT - 2);
  T.hl.setAttribute('height', T.PH + 4);
  T.hl.setAttribute('visibility', 'visible');
  const task = T.D.spatial_tasks[d.r.t];
  const att = d.r.a.map((a, k) => '<span style="white-space:nowrap;' + (k === d.bi ? 'text-decoration:underline' : '') + '"><i class="lamp' + (a.s ? ' lamp-ok' : '') + '"></i> <b>' + a[T.j].toFixed(2) + '</b></span>').join(' &nbsp;');
  out.innerHTML = 'Task ' + d.r.t + ', start state ' + d.r.e + ': <em>' + task + '</em>. Attempts (lit = succeeded, underlined = judge’s pick): ' + att + '. ' + (d.sc >= T.th ? 'Kept.' : 'Dropped.');
}

function drawResults(D) {
  const el = document.getElementById('chart-res');
  const S = Object.fromEntries(D.summary.map(r => [r.id, r]));
  const b = S.base.success;
  const iv = (x, k) => x[k] ? [b + x[k][1], b + x[k][2]] : null;
  const rows = [
    { lab: 'Base policy', sub: '1 try · 4 seeds', v: b, ci: null, seeds: S.base.per_seed, wall: S.base.wall_s, col: 'var(--ink-2)' },
    { lab: 'Best-of-4, base judge', sub: '4 tries · search', v: S.teacher.success, ci: iv(S.teacher, 'vs_base'), wall: S.teacher.wall_s, wnote: '+ judge', col: 'var(--base-j)' },
    { lab: 'Best-of-4, perfect pick', sub: '4 tries · upper bound', v: S.ceiling.success, ci: null, wall: null, col: 'var(--ok)' },
    { lab: 'Student: no filter', sub: '1 try · 1 seed', v: S.unfiltered.success, ci: iv(S.unfiltered, 'vs_base'), wall: S.unfiltered.wall_s, col: 'var(--ink-3)' },
    { lab: 'Student: base-judge picks', sub: '1 try · 1 seed', v: S.rbm2.success, ci: iv(S.rbm2, 'vs_base'), wall: S.rbm2.wall_s, col: 'var(--base-j)' },
    { lab: 'Student: true-success picks', sub: '1 try · 1 seed', v: S.oracle.success, ci: iv(S.oracle, 'vs_base'), wall: S.oracle.wall_s, col: 'var(--ok)' },
    { lab: 'Student: LIBERO-judge picks', sub: '1 try · seed 0', v: S.rbmlib.success, ci: iv(S.rbmlib, 'vs_base'), wall: S.rbmlib.wall_s, col: 'var(--pick)', key: true },
    { lab: 'Same student, 4 seeds', sub: '1 try · 4 eval seeds', v: S.rbmlib.success_4seed, ci: iv(S.rbmlib, 'vs_base_4seed'), seeds: S.rbmlib.per_seed, wall: S.rbmlib.wall_s, col: 'var(--pick)', key: true }
  ];
  responsive(el, w => {
    el.innerHTML = '';
    const narrow = w < 600;
    const LW = narrow ? 0 : 236;
    const RH = narrow ? 62 : 40, HD = 24, AX = 20;
    const gap = narrow ? 16 : 28;
    const avail = w - LW;
    const dW = Math.round((avail - gap) * 0.6), tW = avail - gap - dW;
    const dx0 = LW, dx1 = LW + dW, tx0 = dx1 + gap, tx1 = w - 2;
    const H = HD + rows.length * RH + AX;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + H, width: w, height: H, role: 'img', 'aria-label': 'Held-out success with 95% intervals and seconds per episode. ' + rows.map(r => r.lab + ' ' + pc(r.v) + '%' + (r.wall ? ', ' + r.wall.toFixed(1) + ' s' : '')).join('; ') });
    el.appendChild(svg);
    const lo = 0.5, hi = 0.8;
    const X = v => dx0 + (v - lo) / (hi - lo) * (dx1 - dx0);
    const TX = v => tx0 + v / 60 * (tx1 - tx0 - 40);
    s('text', { x: dx0, y: 12, class: 'tl' }, svg, narrow ? 'Success · dashed = base' : 'Success, held-out');
    s('text', { x: tx0, y: 12, class: 'tl' }, svg, 'Seconds / episode');
    const gr = s('g', { class: 'grid' }, svg);
    [0.5, 0.6, 0.7, 0.8].forEach(v => {
      s('line', { x1: X(v), x2: X(v), y1: HD, y2: H - AX }, gr);
      s('text', { x: X(v), y: H - 5, 'text-anchor': v === lo ? 'start' : 'middle', class: 'tx' }, svg, pc(v, 0) + '%');
    });
    (narrow ? [0, 60] : [0, 30, 60]).forEach(v => {
      s('line', { x1: TX(v), x2: TX(v), y1: HD, y2: H - AX }, gr);
      s('text', { x: TX(v), y: H - 5, 'text-anchor': v === 0 ? 'start' : 'middle', class: 'tx' }, svg, v + ' s');
    });
    s('line', { x1: X(b), x2: X(b), y1: HD - 4, y2: H - AX, class: 'base-line' }, svg);
    rows.forEach((r, i) => {
      const y0 = HD + i * RH;
      const cy = narrow ? y0 + 42 : y0 + RH / 2 + 2;
      const g = s('g', { class: 'row' }, svg);
      const hit = s('rect', { x: 0, y: y0, width: w, height: RH, fill: r.key ? 'var(--pick-dim)' : 'transparent', opacity: r.key ? 0.6 : 1 }, g);
      if (i > 0) s('line', { x1: 0, x2: w, y1: y0, y2: y0, stroke: 'var(--rule)' }, g);
      if (narrow) {
        s('text', { x: 4, y: y0 + 15, class: 'tl', style: 'fill:var(--ink)' }, g, r.lab);
      } else {
        s('text', { x: 8, y: y0 + 16, class: 'tl', style: 'fill:var(--ink)' }, g, r.lab);
        s('text', { x: 8, y: y0 + 30, class: 'tvs' }, g, r.sub);
      }
      if (r.ci) s('line', { x1: X(r.ci[0]), x2: X(r.ci[1]), y1: cy, y2: cy, stroke: r.col, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
      if (r.seeds) r.seeds.forEach(v => s('line', { x1: X(v), x2: X(v), y1: cy - 5, y2: cy + 5, stroke: r.col, 'stroke-width': 1.2, opacity: 0.8 }, g));
      s('circle', { cx: X(r.v), cy, r: 4.5, fill: r.col, stroke: 'var(--panel)', 'stroke-width': 2 }, g);
      const lx = Math.max(r.ci ? X(r.ci[1]) : 0, r.seeds ? X(Math.max(...r.seeds)) : 0, X(r.v) + 3) + 7;
      s('text', { x: lx > dx1 - 44 ? Math.min(r.ci ? X(r.ci[0]) : X(r.v), r.seeds ? X(Math.min(...r.seeds)) : w) - 9 : lx, y: cy + 4, class: 'tv', 'text-anchor': lx > dx1 - 44 ? 'end' : 'start' }, g, pc(r.v) + '%');
      if (r.wall) {
        s('rect', { x: TX(0), y: cy - 4, width: TX(r.wall) - TX(0), height: 8, fill: r.col, rx: 1, opacity: 0.85 }, g);
        s('text', { x: TX(r.wall) + 5, y: cy + 4, class: 'tv' }, g, r.wall.toFixed(1) + (r.wnote && !narrow ? ' ' : ''));
      } else {
        s('text', { x: TX(0), y: cy + 4, class: 'tvs' }, g, 'not timed');
      }
      const ht = '<b>' + r.lab + '</b><br>' + pc(r.v) + '% held-out success' + (r.ci ? '<br>95% CI ' + pc(r.ci[0]) + ' to ' + pc(r.ci[1]) + '% (vs base ' + sg(r.v - b) + ' pts)' : '') + (r.seeds ? '<br>seeds: ' + r.seeds.map(v => pc(v)).join(', ') : '') + (r.wall ? '<br>' + r.wall.toFixed(1) + ' s per episode' + (r.wnote ? ', judge time not counted' : '') : '');
      hit.addEventListener('pointermove', e => showTip(ht, e.clientX, e.clientY));
      hit.addEventListener('pointerleave', hideTip);
    });
    if (!narrow) s('text', { x: X(b), y: HD - 6, 'text-anchor': 'middle', class: 'tvs' }, svg, 'base ' + pc(b) + '%');
  });
}

const M = { a: 'rbmlib', b: 'base', sort: false };
const SYS = [
  { id: 'base', lab: 'Base ×4 seeds', long: 'Base policy' },
  { id: 'unfiltered', lab: 'No filter', long: 'Student: no filter' },
  { id: 'rbm2', lab: 'Base-judge picks', long: 'Student: Base-judge picks' },
  { id: 'oracle', lab: 'True-success picks', long: 'Student: True-success picks' },
  { id: 'rbmlib', lab: 'LIBERO-judge picks ×4', long: 'Student: LIBERO-judge picks' }
];
const sysName = id => SYS.find(x => x.id === id).long;
const s0 = (row, id) => Array.isArray(row[id]) ? row[id][0] : row[id];
const sMean = (row, id) => Array.isArray(row[id]) ? row[id].reduce((a, b) => a + b, 0) / row[id].length : row[id];

function mapInit(D) {
  M.D = D;
  const A = document.getElementById('map-a'), B = document.getElementById('map-b');
  const mk = (box, key, list) => {
    box.innerHTML = '';
    list.forEach(o => {
      const bt = h('button', { type: 'button', role: 'radio', class: 'seg-b', 'aria-checked': String(M[key] === o.id) }, box, o.lab);
      if (key === 'b' && o.id === M.a) bt.disabled = true;
      bt.addEventListener('click', () => {
        M[key] = o.id;
        if (key === 'a' && M.b === o.id) M.b = 'none';
        build();
        mapDraw();
      });
    });
  };
  const build = () => {
    mk(A, 'a', SYS);
    mk(B, 'b', [{ id: 'none', lab: 'None' }].concat(SYS.map(x => ({ id: x.id, lab: x.lab.replace(' ×4 seeds', '').replace(' ×4', '') + ' seed 0' }))));
  };
  build();
  document.getElementById('map-sort').addEventListener('change', e => { M.sort = e.target.checked; mapDraw(); });
  const el = document.getElementById('chart-map');
  responsive(el, w => { M.w = w; mapDraw(); });
}

function lampPath(cx, cy, r, q) {
  const a0 = -Math.PI / 2 + q * Math.PI / 2, a1 = a0 + Math.PI / 2;
  return 'M' + cx + ' ' + cy + 'L' + (cx + r * Math.cos(a0)).toFixed(2) + ' ' + (cy + r * Math.sin(a0)).toFixed(2) + 'A' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cy + r * Math.sin(a1)).toFixed(2) + 'Z';
}

function mapDraw() {
  const D = M.D, w = M.w;
  if (!w) return;
  const el = document.getElementById('chart-map');
  el.innerHTML = '';
  const LW = 30, RW = 46;
  const cell = Math.min(28, (w - LW - RW) / 25);
  const TOP = 16;
  const ch = Math.max(cell, 16);
  const H = TOP + ch * 10 + 4;
  const W = LW + cell * 25 + RW;
  const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'Held-out start states, 10 tasks by 25 states, for ' + sysName(M.a) + (M.b !== 'none' ? ' compared with ' + sysName(M.b) : '') });
  svg.style.maxWidth = W + 'px';
  el.appendChild(svg);
  const cmp = M.b !== 'none';
  const multi = Array.isArray(D.heldout[0][M.a]) && !cmp;
  s('text', { x: LW, y: 10, class: 'tx' }, svg, M.sort ? 'states sorted: base always solves → never solves' : 'start state 25 → 49');
  s('text', { x: W, y: 10, 'text-anchor': 'end', class: 'tx' }, svg, cmp ? 'only A' : 'solved');
  let tot = 0, oa = 0, ob = 0, both = 0, nei = 0;
  const r = cell * 0.36;
  for (let t = 0; t < 10; t++) {
    let rows = D.heldout.filter(x => x.t === t);
    if (M.sort) rows = rows.slice().sort((p, q) => (q.base[1] + q.base[2] + q.base[3]) - (p.base[1] + p.base[2] + p.base[3]) || p.e - q.e);
    const y = TOP + t * ch + ch / 2;
    const tl = s('text', { x: 0, y: y + 4, class: 'tx', style: 'font-size:11px' }, svg, 'T' + t);
    s('title', null, tl, D.spatial_tasks[t]);
    let rowSum = 0, rowA = 0;
    rows.forEach((row, j) => {
      const cx = LW + j * cell + cell / 2;
      const g = s('g', { class: 'cell', tabindex: '-1' }, svg);
      s('rect', { x: cx - cell / 2, y: y - ch / 2, width: cell, height: ch, fill: 'transparent' }, g);
      if (!cmp) {
        if (multi) {
          const arr = row[M.a];
          s('circle', { cx, cy: y, r, fill: 'none', stroke: 'var(--rule-2)', 'stroke-width': 1 }, g);
          arr.forEach((v, q) => { if (v) s('path', { d: lampPath(cx, y, r, q), fill: 'var(--ok)', stroke: 'var(--panel)', 'stroke-width': 0.8 }, g); });
          rowSum += sMean(row, M.a);
        } else {
          const v = row[M.a];
          if (v) s('circle', { cx, cy: y, r, fill: 'var(--ok)' }, g);
          else s('circle', { cx, cy: y, r: r - 0.75, fill: 'none', stroke: 'var(--rule-2)', 'stroke-width': 1.5 }, g);
          rowSum += v;
        }
      } else {
        const a = s0(row, M.a), b = s0(row, M.b);
        if (a && b) { both++; s('circle', { cx, cy: y, r: r * 0.7, fill: 'var(--ink-3)', opacity: 0.55 }, g); }
        else if (a) { oa++; rowA++; s('circle', { cx, cy: y, r, fill: 'var(--ok)' }, g); }
        else if (b) { ob++; s('circle', { cx, cy: y, r: r - 1, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 }, g); }
        else { nei++; s('circle', { cx, cy: y, r: 1.4, fill: 'var(--rule-2)' }, g); }
      }
      const show = () => mapDetail(row, g, cx, y, cell, ch);
      g.addEventListener('pointerenter', show);
      g.addEventListener('click', show);
    });
    tot += rowSum;
    s('text', { x: W, y: y + 4, 'text-anchor': 'end', class: 'tv', style: 'font-size:11.5px' }, svg, cmp ? String(rowA) : (multi ? rowSum.toFixed(1) : String(rowSum)) + '/25');
  }
  M.hl = s('rect', { fill: 'none', stroke: 'var(--pick)', 'stroke-width': 1.5, visibility: 'hidden', class: 'hov', rx: 2 }, svg);
  const ro = document.getElementById('map-ro');
  const row = (l, v) => '<div><span class="lbl">' + l + '</span><span class="v">' + v + '</span></div>';
  if (!cmp) {
    ro.innerHTML = row(sysName(M.a), pc(tot / 250) + '%') + row('States solved', (multi ? tot.toFixed(1) + ' avg' : tot) + ' / 250') + row('Evaluation seeds', multi ? '4' : '1');
  } else {
    const key = M.a + '-' + M.b, rk = M.b + '-' + M.a;
    let pair = '';
    if (D.pairs[key]) pair = row('Paired diff, 95% CI', sg(D.pairs[key].diff[0]) + ' [' + sg(D.pairs[key].diff[1]) + ', ' + sg(D.pairs[key].diff[2]) + ']');
    else if (D.pairs[rk]) pair = row('Paired diff, 95% CI', sg(-D.pairs[rk].diff[0]) + ' [' + sg(-D.pairs[rk].diff[2]) + ', ' + sg(-D.pairs[rk].diff[1]) + ']');
    ro.innerHTML = row('Only A solves', oa) + row('Only B solves', ob) + row('Both / neither', both + ' / ' + nei) + row('Net, seed 0 each', (oa - ob >= 0 ? '+' : '−') + Math.abs(oa - ob) + ' states') + pair;
  }
  const lg = document.getElementById('map-legend');
  const sw = inner => '<svg viewBox="0 0 12 12" aria-hidden="true">' + inner + '</svg>';
  if (!cmp) {
    lg.innerHTML = (multi ? '<span class="legend">' + sw('<circle cx="6" cy="6" r="5" fill="none" stroke="var(--rule-2)"></circle><path d="' + lampPath(6, 6, 5, 0) + '" fill="var(--ok)"></path><path d="' + lampPath(6, 6, 5, 1) + '" fill="var(--ok)"></path>') + 'one quarter per evaluation seed that succeeded</span>' : '<span class="legend">' + sw('<circle cx="6" cy="6" r="5" fill="var(--ok)"></circle>') + 'success</span><span class="legend">' + sw('<circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--rule-2)" stroke-width="1.5"></circle>') + 'failure</span>');
  } else {
    lg.innerHTML = '<span class="legend">' + sw('<circle cx="6" cy="6" r="5" fill="var(--ok)"></circle>') + 'A: ' + sysName(M.a) + ' only</span><span class="legend">' + sw('<circle cx="6" cy="6" r="4" fill="none" stroke="var(--ink)" stroke-width="2"></circle>') + 'B: ' + sysName(M.b) + ' only</span><span class="legend">' + sw('<circle cx="6" cy="6" r="3.5" fill="var(--ink-3)" opacity=".55"></circle>') + 'both</span><span class="legend">' + sw('<circle cx="6" cy="6" r="1.4" fill="var(--rule-2)"></circle>') + 'neither</span>';
  }
}
function mapDetail(row, g, cx, cy, cell, ch) {
  M.hl.setAttribute('x', cx - cell / 2 + 0.5);
  M.hl.setAttribute('y', cy - ch / 2 + 0.5);
  M.hl.setAttribute('width', cell - 1);
  M.hl.setAttribute('height', ch - 1);
  M.hl.setAttribute('visibility', 'visible');
  const D = M.D;
  const det = document.getElementById('map-detail');
  const v = id => {
    const x = row[id];
    if (Array.isArray(x)) return x.map(z => z ? '●' : '○').join(' ');
    return x ? 'success' : 'fail';
  };
  const bc = row.base[1] + row.base[2] + row.base[3];
  const cls = bc === 0 ? 'never' : bc === 3 ? 'always' : 'mixed';
  det.innerHTML = '<span class="lbl">Task ' + row.t + ' · start state ' + row.e + ' · base class: ' + cls + '</span><p>' + D.spatial_tasks[row.t] + '</p><div class="rows">' + SYS.map(o => '<div><span>' + o.long.replace('Student: n', 'N').replace('Student: ', '') + (Array.isArray(row[o.id]) ? ', 4 seeds' : '') + '</span><span>' + v(o.id) + '</span></div>').join('') + '</div>';
}

function drawClass(D) {
  const el = document.getElementById('chart-class');
  el.innerHTML = '';
  const wrap = h('div', { class: 'cls' }, el);
  const C = D.by_class;
  const groups = [['never', 'Base never solves', '0 of 3 seeds'], ['mixed', 'Base sometimes solves', '1 or 2 of 3'], ['always', 'Base always solves', '3 of 3']];
  const series = [
    ['base_fresh', 'Base, fresh seed', 'var(--ink-2)'],
    ['unfiltered', 'No filter', 'var(--ink-3)'],
    ['rbm2', 'Base-judge picks', 'var(--base-j)'],
    ['oracle', 'True-success picks', 'var(--ok)'],
    ['rbmlib', 'LIBERO-judge picks', 'var(--pick)'],
    ['rbmlib_4seed', 'Same, 4 seeds', 'var(--pick)']
  ];
  groups.forEach(([k, t, sub]) => {
    const g = h('div', { class: 'cls-g' }, wrap);
    const hd = h('div', { class: 'cls-h' }, g);
    h('span', { class: 'tl-h' }, hd, t);
    h('span', { class: 'lbl' }, hd, sub + ' · n = ' + C[k].n);
    series.forEach(([id, lab, col]) => {
      const v = C[k][id];
      const r = h('div', { class: 'cls-r' + (id === 'base_fresh' ? ' cls-ref' : '') + (id.startsWith('rbmlib') ? ' cls-key' : '') }, g);
      h('span', { class: 'cls-l' }, r, lab);
      const bar = h('span', { class: 'cls-b' }, r);
      const fill = h('i', null, bar);
      fill.style.width = (v * 100) + '%';
      fill.style.background = col;
      if (id === 'rbmlib_4seed') fill.style.opacity = '0.55';
      const ref = h('b', { class: 'cls-ref-m' }, bar);
      ref.style.left = (C[k].base_fresh * 100) + '%';
      h('span', { class: 'cls-v' }, r, pc(v));
      r.title = lab + ': ' + pc(v) + '% of ' + C[k].n + ' states';
    });
  });
  h('p', { class: 'cap', style: 'margin-top:12px' }, el, 'Percent of states in each group. The vertical mark is the base policy on a fresh seed.');
}

function drawSets(D) {
  const el = document.getElementById('chart-sets');
  el.innerHTML = '';
  const ids = ['unfiltered', 'rbm2', 'oracle', 'rbmlib'];
  const cols = { unfiltered: 'var(--ink-3)', rbm2: 'var(--base-j)', oracle: 'var(--ok)', rbmlib: 'var(--pick)' };
  const t = h('table', { class: 'sets' }, el);
  const th = h('tr', null, h('thead', null, t));
  ['Training set', 'Episodes', 'Really succeeded', 'Passes', 'Held-out success', 'vs base, 95% CI'].forEach(x => h('th', { scope: 'col' }, th, x));
  const tb = h('tbody', null, t);
  ids.forEach(id => {
    const r = D.summary.find(x => x.id === id);
    const tr = h('tr', { class: id === 'rbmlib' ? 'key' : '' }, tb);
    const w = h('td', null, tr);
    const who = h('span', { class: 'who' }, w);
    h('i', { class: 'sc-key', style: 'background:' + cols[id] + ';width:10px;height:10px;border-radius:50%' }, who);
    const lb = r.label.replace('Student: ', ''); who.appendChild(document.createTextNode(lb[0].toUpperCase() + lb.slice(1)));
    const e = h('td', { class: 'n' }, tr);
    e.textContent = r.set.episodes + ' / 250';
    const m1 = h('span', { class: 'mini' }, e); h('i', { style: 'width:' + (r.set.episodes / 250 * 100) + '%' }, m1);
    const p = h('td', { class: 'n' }, tr);
    p.textContent = r.set.true_success + ' · ' + pc(r.set.true_success / r.set.episodes, 0) + '%';
    const m2 = h('span', { class: 'mini' }, p); h('i', { class: 'ok', style: 'width:' + (r.set.true_success / r.set.episodes * 100) + '%' }, m2);
    h('td', { class: 'n' }, tr, r.set.passes.toFixed(2) + '×');
    h('td', { class: 'n', style: 'font-size:16px' }, tr, pc(r.success) + '%');
    h('td', { class: 'n' }, tr, sg(r.vs_base[0]) + ' [' + sg(r.vs_base[1]) + ', ' + sg(r.vs_base[2]) + ']');
  });
  const pr = D.pairs['rbmlib-oracle'];
  document.getElementById('sets-pair').textContent = 'Head to head on the same 250 states, the LIBERO-judge student beats the true-success student by ' + sg(pr.diff[0]) + ' points (95% CI ' + sg(pr.diff[1]) + ' to ' + sg(pr.diff[2]) + ').';
}

function drawNovel(D) {
  const box = document.getElementById('novel-tasks');
  box.innerHTML = '';
  D.novel_tasks.forEach((t, i) => {
    const c = h('div', { class: 'nt' }, box);
    const im = h('div', { class: 'nt-img', role: 'button', tabindex: '0', 'aria-label': 'Toggle main and wrist camera for ' + t.instruction, 'aria-pressed': 'false' }, c);
    const img = h('img', { src: MEDIA + t.preview, alt: 'Simulator scene for "' + t.instruction + '": cluttered table with lookalike distractor objects', loading: 'lazy' }, im);
    const tag = h('span', { class: 'nt-f' }, im, 'main cam');
    let wrist = false;
    const flip = v => {
      wrist = v;
      img.style.marginTop = wrist ? '-111.71875%' : '-11.71875%';
      tag.textContent = wrist ? 'wrist cam' : 'main cam';
      im.setAttribute('aria-pressed', String(wrist));
    };
    im.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') flip(true); });
    im.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') flip(false); });
    im.addEventListener('click', e => { if (e.pointerType !== 'mouse') flip(!wrist); });
    im.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(!wrist); } });
    h('p', null, c, t.instruction);
    const m = h('div', { class: 'meter' }, c);
    h('span', { class: 'lbl' }, m, 'one attempt');
    h('span', { class: 'v' }, m, pc(D.novel_stats.by_task[i]) + '%');
  });
  const ns = D.novel_stats;
  document.getElementById('novel-note').textContent = 'Success of best-of-N as N grows, averaged over all subsets. Only ' + ns.mixed_states + ' of 125 start states have attempts that disagree, and those are the only ones where a judge can change the outcome.';
}

function drawBon(D) {
  const el = document.getElementById('chart-bon');
  const cv = D.novel_stats.curve;
  const ser = [
    ['oracle', 'Perfect pick', 'var(--ok)', '4 3'],
    ['libero', 'LIBERO judge', 'var(--pick)', ''],
    ['base', 'Base judge', 'var(--base-j)', '']
  ];
  responsive(el, w => {
    el.innerHTML = '';
    const narrow = w < 520;
    const L = 38, R = narrow ? 92 : 112, T0 = 22, PH = narrow ? 170 : 200, CB = 46;
    const H = T0 + PH + 26 + CB;
    const svg = s('svg', { viewBox: '0 0 ' + w + ' ' + H, width: w, height: H, role: 'img', 'aria-label': 'Best-of-N success on novel tasks for N from 1 to 8. At N=8: perfect pick ' + pc(cv[7].oracle) + '%, LIBERO judge ' + pc(cv[7].libero) + '%, base judge ' + pc(cv[7].base) + '%. Single attempt ' + pc(cv[0].libero) + '%.' });
    el.appendChild(svg);
    const lo = 0.42, hi = 0.58;
    const X = n => L + (n - 1) / 7 * (w - L - R);
    const Y = v => T0 + (1 - (v - lo) / (hi - lo)) * PH;
    const gr = s('g', { class: 'grid' }, svg);
    [0.44, 0.48, 0.52, 0.56].forEach(v => {
      s('line', { x1: L, x2: w - R + 8, y1: Y(v), y2: Y(v) }, gr);
      s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tx' }, svg, pc(v, 0) + '%');
    });
    let lx = 0;
    const lg = s('g', null, svg);
    ser.slice().reverse().forEach(([k, lab, col, da]) => {
      s('line', { x1: L + lx, x2: L + lx + 16, y1: 8, y2: 8, stroke: col, 'stroke-width': 2, 'stroke-dasharray': da }, lg);
      s('text', { x: L + lx + 21, y: 12, class: 'tvs' }, lg, lab);
      lx += 21 + lab.length * 6.6 + 14;
    });
    for (let n = 1; n <= 8; n++) s('text', { x: X(n), y: T0 + PH + 16, 'text-anchor': 'middle', class: 'tx' }, svg, 'N=' + n);
    const ends = [];
    ser.forEach(([k, lab, col, da]) => {
      const d = cv.map(p => (p.n === 1 ? 'M' : 'L') + X(p.n).toFixed(1) + ' ' + Y(p[k]).toFixed(1)).join(' ');
      s('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-dasharray': da, 'stroke-linejoin': 'round' }, svg);
      ends.push({ k, lab, col, y: Y(cv[7][k]), v: cv[7][k] });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach(e => {
      s('circle', { cx: X(8), cy: Y(e.v), r: 3.5, fill: e.col, stroke: 'var(--panel)', 'stroke-width': 1.5 }, svg);
      s('text', { x: X(8) + 10, y: e.y + 4, class: 'tv' }, svg, pc(e.v) + '%');
      s('text', { x: X(8) + 52, y: e.y + 4, class: 'tvs' }, svg, narrow ? '' : e.k === 'oracle' ? 'ceiling' : e.k === 'libero' ? 'LIBERO' : 'base');
    });
    s('circle', { cx: X(1), cy: Y(cv[0].libero), r: 3.5, fill: 'var(--ink)', stroke: 'var(--panel)', 'stroke-width': 1.5 }, svg);
    s('text', { x: X(1) + 6, y: Y(cv[0].libero) + 18, class: 'tvs' }, svg, 'one attempt ' + pc(cv[0].libero) + '%');
    const cy0 = T0 + PH + 26;
    s('text', { x: L - 6, y: cy0 + 12, 'text-anchor': 'end', class: 'tx' }, svg, 'cost');
    for (let n = 1; n <= 8; n++) {
      const bh = n / 8 * (CB - 16);
      s('rect', { x: X(n) - 6, y: cy0 + (CB - 16) - bh, width: 12, height: bh, fill: 'var(--ink-3)', rx: 1, opacity: 0.7 }, svg);
      s('text', { x: X(n), y: cy0 + CB - 3, 'text-anchor': 'middle', class: 'tx' }, svg, n + '×');
    }
    const cross = s('line', { y1: T0, y2: T0 + PH, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden', class: 'hov' }, svg);
    const hit = s('rect', { x: L - 10, y: T0, width: w - L - R + 20, height: PH + 26 + CB, fill: 'transparent' }, svg);
    const move = e => {
      const rect = svg.getBoundingClientRect();
      const n = clamp(Math.round((e.clientX - rect.left - L) / (w - L - R) * 7) + 1, 1, 8);
      cross.setAttribute('x1', X(n)); cross.setAttribute('x2', X(n)); cross.setAttribute('visibility', 'visible');
      const p = cv[n - 1];
      showTip('<b>Best of ' + n + '</b><br>perfect pick ' + pc(p.oracle) + '%<br>LIBERO judge ' + pc(p.libero) + '%<br>base judge ' + pc(p.base) + '%<br>' + n + ' rollout' + (n > 1 ? 's' : '') + ' per episode', e.clientX, e.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  });
}

function drawSetup(D) {
  const t = D.setup.training;
  document.getElementById('setup').textContent = 'Setup: ' + D.setup.policy + ', ' + t.method + ' rank ' + t.rank + ', ' + t.optimizer + ' at ' + t.lr + ', batch ' + t.batch + ' × ' + t.grad_accum + ', ' + fmt(t.iters) + ' updates (about ' + t.hours_a100 + ' h on an A100).';
}

function fail(err) {
  document.querySelectorAll('.await').forEach(p => { p.textContent = 'Data did not load (' + err.message + '). Serve this folder over http, not file://.'; });
  document.getElementById('g-meta').textContent = 'No data';
}

setupSite();
fetch('shared/data.json')
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(D => {
    gameInit(D);
    drawShift(D);
    thrInit(D);
    drawResults(D);
    mapInit(D);
    drawClass(D);
    drawSets(D);
    drawNovel(D);
    drawBon(D);
    drawSetup(D);
  })
  .catch(fail);
