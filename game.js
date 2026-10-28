'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 방구차: 화면·입력·소리. 규칙(미로·내 차·빨간 차·연막·연료·깃발)은 logic.js (LOGIC_RALLYX) 에 있고,
// 여기서는 규칙이 남긴 st.events 를 보고 소리·점수 글씨·안내를 만든다.
const L = LOGIC_RALLYX;
const { T, DX, DY } = L;
const TILE = 16;                              // 한 칸의 그림 크기 (논리 픽셀)
const VIEW_W = 14, VIEW_H = 15;               // 화면에 보이는 칸 수
const VW = VIEW_W * TILE, VH = VIEW_H * TILE; // 224 x 240
const PANEL = 64;                             // 오른쪽 안내판 폭
const W = VW + PANEL, H = VH;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(160, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('rallyxMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 1500) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step));
const sfx = {
  flag: (n) => tone(440 + n * 70, 0.14, 'square', 0.06),
  smoke: () => noise(0.09, 0.05, 700),
  stun: () => tone(700, 0.2, 'sawtooth', 0.05, -500),
  crash: () => { noise(0.6, 0.14, 800); tone(150, 0.6, 'sawtooth', 0.07, -90); },
  clear: () => melody([523, 659, 784, 1047, 1319], 100),
  life: () => melody([1047, 1319, 1568, 2093], 90, 'square', 0.05),
  start: () => melody([392, 523, 659, 784], 110),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
  low: () => tone(220, 0.15, 'square', 0.04),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                          // title · play · paused · over
let pausedFrom = null;
let best = Number(store.get('rallyxBest')) || 0;
let fxs = [];                                 // 점수 글씨·폭발 { kind, x, y, t, life, text }  (x, y 는 칸 단위 세계 좌표)
let banner = { text: '', t: 0 };              // 라운드 시작 안내
let clock = 0, lowT = 0;
let radar = null;                             // 라운드가 시작될 때 한 번 그려 두는 지도

/* @test-hooks:start */
window.__rx = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; radar = null; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 입력 ----------
const keyDir = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
const SMOKE_KEYS = [' ', 'z', 'Z', 'x', 'X', 'j', 'J'];
let wantDir = null, smokeKey = false, smokeTouch = false;
function steer(d) {
  if (d === null || state !== 'play') return;
  if (d !== wantDir) { wantDir = d; tutorialSignal('steer'); }
}
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key in keyDir) { e.preventDefault(); steer(keyDir[e.key]); return; }
  if (SMOKE_KEYS.includes(e.key)) {
    e.preventDefault();
    if (state === 'title' || state === 'over') { if (!e.repeat && e.key === ' ') onOverlayButton(); return; }
    if (state === 'paused') { if (!e.repeat) resume(); return; }
    smokeKey = true;
    return;
  }
  if (e.key === 'Enter') { if (state === 'title' || state === 'over') onOverlayButton(); else if (state === 'paused') resume(); return; }
  if (e.key === 'p' || e.key === 'P') { if (state === 'paused') resume(); else pause(); }
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});
addEventListener('keyup', (e) => { if (SMOKE_KEYS.includes(e.key)) smokeKey = false; });

const pad = $('pad');
const PAD_DIRS = [0, 2, 3, 1];                // 화면의 ▲ ▼ ◀ ▶ 가 가리키는 방향 (위 0 · 오른쪽 1 · 아래 2 · 왼쪽 3)
let padNow = null;
function padFrom(e) {
  const r = pad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const dead = r.width * 0.12;
  padNow = Math.max(Math.abs(dx), Math.abs(dy)) < dead ? null : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  steer(padNow);
  const k = pad.querySelector('b'), lim = r.width * 0.2;
  k.style.transform = `translate(${Math.max(-lim, Math.min(lim, dx))}px, ${Math.max(-lim, Math.min(lim, dy))}px)`;
  [...pad.querySelectorAll('i')].forEach((el, i) => el.classList.toggle('on', padNow === PAD_DIRS[i]));
}
const padEnd = () => { padNow = null; pad.querySelector('b').style.transform = ''; pad.querySelectorAll('i').forEach((el) => el.classList.remove('on')); };
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (_) {} padFrom(e); });
pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') padFrom(e); });
pad.addEventListener('pointerup', padEnd);
pad.addEventListener('pointercancel', padEnd);
const smokeBtn = $('smokeBtn');
const smokeOn = (e) => { e.preventDefault(); try { smokeBtn.setPointerCapture(e.pointerId); } catch (_) {} smokeTouch = true; smokeBtn.classList.add('on'); };
const smokeOff = () => { smokeTouch = false; smokeBtn.classList.remove('on'); };
smokeBtn.addEventListener('pointerdown', smokeOn);
smokeBtn.addEventListener('pointerup', smokeOff);
smokeBtn.addEventListener('pointercancel', smokeOff);

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelector('button').onclick = onOverlayButton; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function startGame() {
  G = L.newGame();
  radar = null; fxs = []; wantDir = null;
  state = 'play';
  setBanner('ROUND 1');
  hideOverlay();
  sfx.start();
}
function onOverlayButton() { if (state === 'paused') resume(); else startGame(); }
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused';
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function setBanner(text) { banner = { text, t: 2.2 }; }
function gameOver() {
  state = 'over';
  const rec = G.score > best;
  if (rec) { best = G.score; store.set('rallyxBest', String(best)); }
  sfx.over();
  showOverlay(`<h2>GAME OVER</h2><p class="big">${G.score.toLocaleString()}점</p><p>${G.round}라운드 · 깃발 ${G.stats.flags}개${rec ? '<br>🏆 최고 기록!' : ''}</p><button id="startBtn">다시 하기</button>`);
}

// ---------- 규칙이 남긴 일을 소리·효과로 ----------
function handleEvents() {
  for (const e of G.events) {
    if (e.t === 'flag') { sfx.flag(e.n); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1.1, text: String(e.pts), color: e.special ? '#ff7a7a' : '#ffe14a' }); tutorialSignal('flag'); }
    else if (e.t === 'smoke') { sfx.smoke(); tutorialSignal('smoke'); }
    else if (e.t === 'stun') { sfx.stun(); fxs.push({ kind: 'text', x: e.x, y: e.y, t: 0, life: 1, text: String(e.pts), color: '#fff' }); tutorialSignal('stun'); }
    else if (e.t === 'crash') { sfx.crash(); fxs.push({ kind: 'boom', x: e.x, y: e.y, t: 0, life: 0.8 }); wantDir = null; }
    else if (e.t === 'round') { radar = null; wantDir = null; if (G.round > 1) { setBanner(e.bonus ? 'BONUS ROUND' : `ROUND ${e.round}`); sfx.start(); } else if (e.bonus) setBanner('BONUS ROUND'); }
    else if (e.t === 'clear') { sfx.clear(); setBanner(`ROUND CLEAR  FUEL +${e.bonus}`); }
    else if (e.t === 'extraLife') sfx.life();
    else if (e.t === 'fuelOut') setBanner('연료 바닥!');
    else if (e.t === 'over') gameOver();
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  L.step(G, dt, { want: wantDir, smoke: smokeKey || smokeTouch });
  handleEvents();
  banner.t = Math.max(0, banner.t - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  if (G.fuel < 20 && G.fuel > 0) { lowT -= dt; if (lowT <= 0) { sfx.low(); lowT = 1; } }
}

// ---------- 그리기 ----------
function buildRadar() {
  const c = document.createElement('canvas'); c.width = T; c.height = T;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, T, T);
  x.fillStyle = '#2d4fc4';
  for (let y = 0; y < T; y++) for (let xx = 0; xx < T; xx++) if (G.grid[y][xx] === 1) x.fillRect(xx, y, 1, 1);
  return c;
}
function camera() {
  const p = G.player;
  const cx = Math.max(0, Math.min(T - VIEW_W, p.x + 0.5 - VIEW_W / 2)), cy = Math.max(0, Math.min(T - VIEW_H, p.y + 0.5 - VIEW_H / 2));
  return { x: cx, y: cy };
}
const wall = (x, y) => x < 0 || y < 0 || x >= T || y >= T || G.grid[y][x] === 1;
function drawMaze(cam) {
  const x0 = Math.floor(cam.x), y0 = Math.floor(cam.y);
  for (let ty = y0; ty <= y0 + VIEW_H; ty++) for (let tx = x0; tx <= x0 + VIEW_W; tx++) {
    const px = Math.round((tx - cam.x) * TILE), py = Math.round((ty - cam.y) * TILE);
    if (!wall(tx, ty)) { ctx.fillStyle = '#05050c'; ctx.fillRect(px, py, TILE, TILE); continue; }
    ctx.fillStyle = '#2748b8'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#4a74f0';                         // 길과 맞닿은 쪽에 밝은 테두리
    if (!wall(tx, ty - 1)) ctx.fillRect(px, py, TILE, 2);
    if (!wall(tx - 1, ty)) ctx.fillRect(px, py, 2, TILE);
    ctx.fillStyle = '#16307f';
    if (!wall(tx, ty + 1)) ctx.fillRect(px, py + TILE - 2, TILE, 2);
    if (!wall(tx + 1, ty)) ctx.fillRect(px + TILE - 2, py, 2, TILE);
  }
}
function drawFlag(f, cam) {
  const px = (f.x - cam.x) * TILE, py = (f.y - cam.y) * TILE;
  if (px < -TILE || py < -TILE || px > VW || py > VH) return;
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(px + 4, py + 2, 2, 12);
  ctx.fillStyle = f.special ? '#ff4a4a' : '#ffd23a';
  ctx.fillRect(px + 6, py + 2, 7, 5);
  ctx.fillRect(px + 6, py + 7, 5, 1);
  if (f.special) { ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', px + 9, py + 5); }
}
function drawRock(r, cam) {
  const px = (r.x - cam.x) * TILE, py = (r.y - cam.y) * TILE;
  if (px < -TILE || py < -TILE || px > VW || py > VH) return;
  ctx.fillStyle = '#7a6a58'; ctx.beginPath(); ctx.ellipse(px + 8, py + 9, 7, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#a89a86'; ctx.beginPath(); ctx.ellipse(px + 6, py + 6, 3, 2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a3f33'; ctx.fillRect(px + 9, py + 10, 3, 2);
}
function drawSmoke(cam) {
  for (const s of G.smoke) {
    const k = s.t / L.SMOKE_LIFE, px = (s.x - cam.x + 0.5) * TILE, py = (s.y - cam.y + 0.5) * TILE;
    ctx.fillStyle = `rgba(235,235,235,${0.75 * (1 - k)})`;
    ctx.beginPath(); ctx.arc(px, py, 6 + k * 6, 0, 7); ctx.fill();
  }
}
function drawCar(e, cam, body, dark, light, flash) {
  const px = (e.x - cam.x + 0.5) * TILE, py = (e.y - cam.y + 0.5) * TILE;
  if (px < -TILE || py < -TILE || px > VW + TILE || py > VH + TILE) return;
  ctx.save();
  ctx.translate(px, py); ctx.rotate((e.dir < 0 ? (e.face !== undefined ? e.face : (e.faceDir || 0)) : e.dir) * Math.PI / 2);
  if (flash) ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#111'; ctx.fillRect(-6, -6, 3, 4); ctx.fillRect(3, -6, 3, 4); ctx.fillRect(-6, 3, 3, 4); ctx.fillRect(3, 3, 3, 4);   // 바퀴
  ctx.fillStyle = body; ctx.fillRect(-5, -7, 10, 14);
  ctx.fillStyle = dark; ctx.fillRect(-5, 4, 10, 3); ctx.fillRect(-5, -7, 10, 2);
  ctx.fillStyle = light; ctx.fillRect(-3, -4, 6, 4);
  ctx.fillStyle = '#9ad6ff'; ctx.fillRect(-3, -3, 6, 3);
  ctx.restore();
}
function drawCars(cam) {
  const p = G.player;
  if (p.dir >= 0) p.faceDir = p.dir;
  for (const c of G.cars) {
    if (c.dir >= 0) c.faceDir = c.dir;
    const stunned = c.stun > 0;
    drawCar(c, cam, stunned ? '#8a5a5a' : '#e83a3a', '#8a1a1a', '#ff9a9a', stunned && Math.floor(clock * 8) % 2 === 0);
    if (stunned) { ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✦', (c.x - cam.x + 0.5) * TILE, (c.y - cam.y) * TILE - 2 + Math.sin(clock * 10) * 2); }
  }
  if (p.alive) drawCar(p, cam, '#3a8cff', '#1a4aa0', '#bcd8ff', p.invuln > 0 && Math.floor(clock * 10) % 2 === 0);
}
function drawFx(cam) {
  for (const f of fxs) {
    const k = f.t / f.life, px = (f.x - cam.x + 0.5) * TILE, py = (f.y - cam.y + 0.5) * TILE;
    if (f.kind === 'boom') {
      const r = 14 * (0.3 + k);
      ctx.fillStyle = k < 0.5 ? '#ffd23a' : '#e8561e'; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
      ctx.fillStyle = k < 0.5 ? '#fff' : '#ffd23a'; ctx.beginPath(); ctx.arc(px, py, r * 0.5, 0, 7); ctx.fill();
    } else if (f.kind === 'text') {
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = f.color || '#fff'; ctx.fillText(f.text, px, py - 6 - k * 12);
    }
  }
}
function drawPanel() {
  const x0 = VW;
  ctx.fillStyle = '#000'; ctx.fillRect(x0, 0, PANEL, H);
  ctx.fillStyle = '#1b2f80'; ctx.fillRect(x0, 0, 2, H);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const label = (t, y) => { ctx.fillStyle = '#ff6a6a'; ctx.font = 'bold 8px sans-serif'; ctx.fillText(t, x0 + 6, y); };
  const value = (t, y) => { ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.fillText(String(t), x0 + 6, y); };
  label('HIGH', 4); value(Math.max(best, G.score), 13);
  label('SCORE', 28); value(G.score, 37);
  // 레이더
  if (!radar) radar = buildRadar();
  const rx = x0 + 4, ry = 54;
  ctx.fillStyle = '#000'; ctx.fillRect(rx - 1, ry - 1, T + 2, T + 2);
  ctx.drawImage(radar, rx, ry);
  ctx.strokeStyle = '#7cf'; ctx.lineWidth = 1; ctx.strokeRect(rx - 0.5, ry - 0.5, T + 1, T + 1);
  for (const f of G.flags) if (!f.taken) { ctx.fillStyle = f.special ? '#ff5a5a' : '#ffe14a'; ctx.fillRect(rx + f.x - 1, ry + f.y - 1, 3, 3); }
  for (const c of G.cars) { ctx.fillStyle = c.stun > 0 ? '#a66' : '#ff3030'; ctx.fillRect(rx + Math.round(c.x) - 1, ry + Math.round(c.y) - 1, 3, 3); }
  if (G.player.alive && Math.floor(clock * 6) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(rx + Math.round(G.player.x) - 1, ry + Math.round(G.player.y) - 1, 3, 3); }
  // 연료
  const fy = ry + T + 8;
  label('FUEL', fy);
  ctx.fillStyle = '#222'; ctx.fillRect(x0 + 6, fy + 10, PANEL - 12, 7);
  const pct = G.fuel / L.FUEL_MAX;
  ctx.fillStyle = pct > 0.5 ? '#4adf5a' : pct > 0.2 ? '#ffd23a' : (Math.floor(clock * 6) % 2 ? '#ff4a4a' : '#7a1a1a');
  ctx.fillRect(x0 + 6, fy + 10, Math.round((PANEL - 12) * pct), 7);
  ctx.strokeStyle = '#8899cc'; ctx.strokeRect(x0 + 5.5, fy + 9.5, PANEL - 11, 8);
  // 라운드 · 깃발 · 목숨
  label('ROUND', fy + 24); value(G.round + (G.bonusRound ? ' ★' : ''), fy + 33);
  label('FLAG', fy + 47); value(`${G.collected}/${L.FLAGS_PER_ROUND}`, fy + 56);
  for (let i = 0; i < Math.max(0, G.lives - (G.player.alive ? 1 : 0)); i++) {          // 남은 예비 목숨
    ctx.fillStyle = '#3a8cff'; ctx.fillRect(x0 + 6 + i * 11, fy + 70, 8, 10);
    ctx.fillStyle = '#bcd8ff'; ctx.fillRect(x0 + 8 + i * 11, fy + 72, 4, 3);
  }
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cam = camera();
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  drawMaze(cam);
  for (const r of G.rocks) drawRock(r, cam);
  for (const f of G.flags) if (!f.taken) drawFlag(f, cam);
  drawSmoke(cam);
  drawCars(cam);
  drawFx(cam);
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, VH / 2 - 16, VW, 26);
    ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, VW / 2, VH / 2 - 3);
  }
  if (state === 'play' && G.player.alive && G.player.dir < 0 && G.phase === 'play' && wantDir === null) {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('방향을 눌러 출발!', VW / 2, VH / 2 + 24);
  }
  ctx.restore();
  drawPanel();
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() {
  muted = !muted;
  store.set('rallyxMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('startBtn').onclick = onOverlayButton;
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
