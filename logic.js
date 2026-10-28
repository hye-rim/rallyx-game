'use strict';
// 방구차(오락실 고전 랠리 엑스 스타일) 규칙. 화면 없이 Node 에서 시험한다 (DOM 을 쓰지 않는다).
// 길은 한 칸 폭의 미로이고, 위치는 모두 '칸(타일)' 단위의 실수다. 길 위의 칸 중심은 정수 좌표다.
// 방향: 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽
const LOGIC_RALLYX = (() => {
const CELLS = 18, T = CELLS * 3 + 1;                       // 미로는 18x18 갈림길, 칸으로는 55x55 (벽은 두 칸 두께)
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const START_LIVES = 3, FLAGS_PER_ROUND = 10;
const PLAYER_SPEED = 5.2;                                   // 칸/초
const FUEL_MAX = 100, FUEL_DRAIN = 1.1, SMOKE_COST = 0.35, SMOKE_EVERY = 0.1, SMOKE_LIFE = 1.4, SMOKE_RADIUS = 0.8;
const STUN_SMOKE = 2.6, STUN_ROCK = 3.2;
const POINTS = { smoke: 80, rock: 50, fuelLeft: 10 };
const EXTRA_LIFE_AT = [20000, 60000];                      // 이후에는 4만 점마다
const MAZE_SEEDS = [11, 23, 37];
const START = { x: 1 + 3 * 9, y: 1 + 3 * 9 };               // 가운데 갈림길

const rng = (seed) => {                                      // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const emit = (st, e) => { st.events.push(e); };
const isBonusRound = (r) => r % 4 === 0;                    // 4라운드마다 빨간 차가 없는 보너스 라운드
const redCount = (r) => (isBonusRound(r) ? 0 : Math.min(5, 3 + Math.floor((r - 1) / 3)));
const redSpeedFactor = (r) => Math.min(1, 0.74 + 0.035 * r);

// ---------- 미로 ----------
// 갈림길 18x18 을 깊이 우선으로 이어 만든 뒤, 막힌 벽을 일부 터서 돌아갈 길(고리)을 만든다
function genMaze(seed) {
  const r = rng(seed);
  const open = Array.from({ length: CELLS }, () => Array.from({ length: CELLS }, () => [false, false, false, false]));
  const seen = Array.from({ length: CELLS }, () => new Array(CELLS).fill(false));
  const stack = [[0, 0]]; seen[0][0] = true;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = [0, 1, 2, 3].filter((d) => { const nx = cx + DX[d], ny = cy + DY[d]; return nx >= 0 && ny >= 0 && nx < CELLS && ny < CELLS && !seen[ny][nx]; });
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(r() * opts.length)], nx = cx + DX[d], ny = cy + DY[d];
    open[cy][cx][d] = true; open[ny][nx][(d + 2) % 4] = true; seen[ny][nx] = true; stack.push([nx, ny]);
  }
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) for (const d of [1, 2]) {
    const nx = cx + DX[d], ny = cy + DY[d];
    if (nx >= CELLS || ny >= CELLS || open[cy][cx][d]) continue;
    if (r() < 0.34) { open[cy][cx][d] = true; open[ny][nx][(d + 2) % 4] = true; }
  }
  const grid = Array.from({ length: T }, () => new Array(T).fill(1));
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
    const x = 1 + cx * 3, y = 1 + cy * 3;
    grid[y][x] = 0;
    if (open[cy][cx][1]) { grid[y][x + 1] = 0; grid[y][x + 2] = 0; }
    if (open[cy][cx][2]) { grid[y + 1][x] = 0; grid[y + 2][x] = 0; }
  }
  return grid;
}

const isRoad = (st, x, y) => x >= 0 && y >= 0 && x < T && y < T && st.grid[y][x] === 0;
const canGo = (st, x, y, d) => isRoad(st, x + DX[d], y + DY[d]);

// from 에서 갈 수 있는 모든 길 칸까지의 걸음 수 (막힌 곳 -1). blocked 칸은 지나가지 않는다
function distField(st, fx, fy, blocked) {
  const dist = new Int16Array(T * T).fill(-1);
  const q = [fy * T + fx]; dist[fy * T + fx] = 0;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i], x = cur % T, y = (cur - x) / T;
    for (let d = 0; d < 4; d++) {
      if (!canGo(st, x, y, d)) continue;
      const nx = x + DX[d], ny = y + DY[d], k = ny * T + nx;
      if (dist[k] >= 0 || (blocked && blocked.has(k))) continue;
      dist[k] = dist[cur] + 1; q.push(k);
    }
  }
  return dist;
}

// ---------- 라운드 ----------
function newGame(rand = Math.random) {
  const st = {
    rand, score: 0, lives: START_LIVES, extra: 0, round: 1, phase: 'play', time: 0, events: [],
    stats: { flags: 0, stuns: 0 },
  };
  startRound(st, 1);
  st.events = [];
  return st;
}

function startRound(st, round) {
  st.round = round;
  st.bonusRound = isBonusRound(round);
  st.grid = genMaze(MAZE_SEEDS[(round - 1) % MAZE_SEEDS.length] + Math.floor((round - 1) / MAZE_SEEDS.length) * 100);
  const r = st.rand;
  const fromStart = distField(st, START.x, START.y);
  const roadTiles = [];
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (st.grid[y][x] === 0) roadTiles.push([x, y]);
  const nodes = roadTiles.filter(([x, y]) => x % 3 === 1 && y % 3 === 1);
  const pick = (list) => list[Math.floor(r() * list.length)];

  // 깃발: 첫 깃발은 가까이(5~9걸음), 나머지는 서로 떨어뜨려 놓는다
  st.flags = [];
  const tooClose = ([x, y]) => st.flags.some((f) => Math.abs(f.x - x) + Math.abs(f.y - y) < 9);
  const near = nodes.filter(([x, y]) => fromStart[y * T + x] >= 5 && fromStart[y * T + x] <= 9);
  const first = pick(near.length ? near : nodes.filter(([x, y]) => fromStart[y * T + x] > 0));
  st.flags.push({ x: first[0], y: first[1], special: false });
  for (let tries = 0; st.flags.length < FLAGS_PER_ROUND && tries < 4000; tries++) {
    const c = pick(nodes);
    if (fromStart[c[1] * T + c[0]] < 6 || tooClose(c)) continue;
    st.flags.push({ x: c[0], y: c[1], special: false });
  }
  while (st.flags.length < FLAGS_PER_ROUND) { const c = pick(nodes); if (!st.flags.some((f) => f.x === c[0] && f.y === c[1]) && fromStart[c[1] * T + c[0]] > 0) st.flags.push({ x: c[0], y: c[1], special: false }); }
  if (!st.bonusRound) st.flags[1 + Math.floor(r() * (FLAGS_PER_ROUND - 1))].special = true;          // S 깃발: 이 뒤로 받는 깃발 점수가 두 배

  // 바위: 길을 완전히 막지 않는 곳에만 놓는다 (시작·깃발에서 바위를 피해 갈 수 있어야 한다)
  st.rocks = [];
  const rockTarget = st.bonusRound ? 6 : 16;
  const blockedKeys = new Set();
  for (let tries = 0; st.rocks.length < rockTarget && tries < 2000; tries++) {
    const [x, y] = pick(roadTiles);
    const k = y * T + x;
    if (fromStart[k] < 6 || blockedKeys.has(k) || st.flags.some((f) => f.x === x && f.y === y)) continue;
    blockedKeys.add(k);
    const d = distField(st, START.x, START.y, blockedKeys);
    if (st.flags.some((f) => d[f.y * T + f.x] < 0)) { blockedKeys.delete(k); continue; }
    st.rocks.push({ x, y });
  }
  st.blockedKeys = blockedKeys;

  // 내 차와 빨간 차
  st.player = { x: START.x, y: START.y, dir: -1, want: null, invuln: 2, anim: 0, alive: true, face: 0 };
  st.cars = [];
  const n = redCount(round);
  const far = nodes.filter(([x, y]) => fromStart[y * T + x] >= 16 && !blockedKeys.has(y * T + x));
  for (let i = 0; i < n; i++) {
    const c = pick(far.length ? far : nodes);
    st.cars.push({ x: c[0], y: c[1], sx: c[0], sy: c[1], dir: -1, stun: 0, chase: Math.max(0.55, 0.92 - i * 0.1), rockKey: -1, anim: 0 });
  }
  st.smoke = []; st.smokeT = 0;
  st.fuel = FUEL_MAX; st.seq = 0; st.mult = 1;
  st.collected = 0; st.holdT = 1.2;                          // 시작 직후 잠깐 빨간 차가 가만히 있는다
  st.distT = 0; st.dist = null;
  st.phase = 'play'; st.phaseT = 0;
  emit(st, { t: 'round', round, bonus: st.bonusRound });
}

// ---------- 움직임 ----------
const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-6;
const atCenter = (e) => isInt(e.x) && isInt(e.y);
function move(st, e, dist, chooser) {
  let guard = 0;
  while (dist > 1e-9 && guard++ < 12) {
    if (atCenter(e)) {
      e.x = Math.round(e.x); e.y = Math.round(e.y);
      chooser(e);
      if (e.dir < 0) return;
      if (!canGo(st, e.x, e.y, e.dir)) { e.dir = -1; return; }
    }
    let d;
    if (e.dir === 1) d = Math.floor(e.x + 1e-6) + 1 - e.x;
    else if (e.dir === 3) d = e.x - (Math.ceil(e.x - 1e-6) - 1);
    else if (e.dir === 2) d = Math.floor(e.y + 1e-6) + 1 - e.y;
    else d = e.y - (Math.ceil(e.y - 1e-6) - 1);
    const s = Math.min(d, dist);
    e.x += DX[e.dir] * s; e.y += DY[e.dir] * s; dist -= s;
    if (isInt(e.x)) e.x = Math.round(e.x);
    if (isInt(e.y)) e.y = Math.round(e.y);
    e.anim += s;
  }
}

function movePlayer(st, h, speed) {
  const p = st.player;
  if (!atCenter(p) && p.want !== null && p.dir >= 0 && p.want === (p.dir + 2) % 4) p.dir = p.want;         // 길 한가운데서 U턴
  move(st, p, speed * h, (e) => {
    if (e.want !== null && canGo(st, e.x, e.y, e.want)) e.dir = e.want;
  });
}

function chooseRed(st, c) {
  const opts = [0, 1, 2, 3].filter((d) => canGo(st, c.x, c.y, d));
  const back = (c.dir + 2) % 4;
  let ways = opts.filter((d) => d !== back || c.dir < 0);
  if (!ways.length) ways = opts;
  if (!ways.length) { c.dir = -1; return; }
  if (st.dist && st.rand() < c.chase) {
    let best = ways[0], bd = 1e9;
    for (const d of ways) {
      const k = (c.y + DY[d]) * T + (c.x + DX[d]);
      const v = st.dist[k] < 0 ? 1e8 : st.dist[k];
      if (v < bd || (v === bd && st.rand() < 0.5)) { bd = v; best = d; }
    }
    c.dir = best;
  } else c.dir = ways[Math.floor(st.rand() * ways.length)];
}

// ---------- 한 걸음 ----------
// input: { want: 0~3 또는 null (가고 싶은 방향), smoke: 연막 버튼을 누르고 있는가 }
function step(st, dt, input) {
  st.events = [];
  let left = dt;
  while (left > 1e-9 && st.phase !== 'over') { const h = Math.min(left, 1 / 60); sub(st, h, input || {}); left -= h; }
}

function addScore(st, n) {
  st.score += n;
  const need = () => (st.extra < EXTRA_LIFE_AT.length ? EXTRA_LIFE_AT[st.extra] : EXTRA_LIFE_AT[EXTRA_LIFE_AT.length - 1] + (st.extra - EXTRA_LIFE_AT.length + 1) * 40000);
  while (st.score >= need()) { st.extra++; st.lives++; emit(st, { t: 'extraLife' }); }
}

function killPlayer(st, why) {
  const p = st.player;
  if (!p.alive || p.invuln > 0) return;
  p.alive = false; p.dir = -1;
  st.lives--; st.seq = 0;
  emit(st, { t: 'crash', why, x: p.x, y: p.y });
  st.phase = 'dying'; st.phaseT = 1.4;
}

function sub(st, h, input) {
  st.time += h;
  const p = st.player;
  if (st.phase === 'dying') {
    st.phaseT -= h;
    if (st.phaseT <= 0) {
      if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); return; }
      p.x = START.x; p.y = START.y; p.dir = -1; p.want = null; p.alive = true; p.invuln = 2;
      for (const c of st.cars) { c.x = c.sx; c.y = c.sy; c.dir = -1; c.stun = 0; }
      st.smoke = []; st.holdT = 1.5;
      st.phase = 'play';
    }
    return;
  }
  if (st.phase === 'clear') {
    st.phaseT -= h;
    if (st.phaseT <= 0) startRound(st, st.round + 1);
    return;
  }
  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - h);
  if (st.holdT > 0) st.holdT = Math.max(0, st.holdT - h);

  // 연료: 계속 줄고, 연막을 뿜으면 더 줄어든다. 바닥나면 느려지고 연막을 못 쓴다
  const drain = st.bonusRound ? FUEL_DRAIN * 1.4 : FUEL_DRAIN;
  const before = st.fuel;
  st.fuel = Math.max(0, st.fuel - drain * h);
  if (before > 0 && st.fuel === 0) emit(st, { t: 'fuelOut' });
  if (input.want !== null && input.want !== undefined) p.want = input.want;
  movePlayer(st, h, PLAYER_SPEED * (st.fuel > 0 ? 1 : 0.55));
  if (p.dir >= 0) p.face = p.dir;

  // 연막
  st.smokeT -= h;
  if (input.smoke && st.fuel > 0 && !st.bonusRound && st.smokeT <= 0) {
    st.smokeT = SMOKE_EVERY;
    const bx = p.x - DX[p.face] * 0.8, by = p.y - DY[p.face] * 0.8;     // 바라보는 방향의 뒤쪽으로 뿜는다 (서 있어도 뿜는다)
    st.smoke.push({ x: bx, y: by, t: 0 });
    st.fuel = Math.max(0, st.fuel - SMOKE_COST);
    emit(st, { t: 'smoke' });
  }
  for (const s of st.smoke) s.t += h;
  st.smoke = st.smoke.filter((s) => s.t < SMOKE_LIFE);

  // 빨간 차
  st.distT -= h;
  if (st.distT <= 0) { st.dist = distField(st, Math.round(p.x), Math.round(p.y)); st.distT = 0.2; }
  const speed = PLAYER_SPEED * redSpeedFactor(st.round);
  for (const c of st.cars) {
    if (c.stun > 0) { c.stun = Math.max(0, c.stun - h); continue; }
    if (st.holdT <= 0) move(st, c, speed * h, (e) => chooseRed(st, e));
    // 연막에 닿으면 멈춘다
    for (const s of st.smoke) {
      if (Math.abs(c.x - s.x) < SMOKE_RADIUS && Math.abs(c.y - s.y) < SMOKE_RADIUS) {
        c.stun = STUN_SMOKE; st.stats.stuns++;
        addScore(st, POINTS.smoke);
        emit(st, { t: 'stun', by: 'smoke', x: c.x, y: c.y, pts: POINTS.smoke });
        break;
      }
    }
    // 바위에 부딪히면 멈춘다
    if (c.stun <= 0) {
      for (const rk of st.rocks) {
        if (Math.abs(c.x - rk.x) < 0.5 && Math.abs(c.y - rk.y) < 0.5) {
          const key = rk.y * T + rk.x;
          if (c.rockKey !== key) {
            c.rockKey = key; c.stun = STUN_ROCK; st.stats.stuns++;
            addScore(st, POINTS.rock);
            emit(st, { t: 'stun', by: 'rock', x: c.x, y: c.y, pts: POINTS.rock });
          }
          break;
        }
      }
    }
    if (c.rockKey >= 0 && !st.rocks.some((rk) => Math.abs(c.x - rk.x) < 1.2 && Math.abs(c.y - rk.y) < 1.2)) c.rockKey = -1;
  }

  // 충돌: 바위, 빨간 차
  if (p.alive) {
    for (const rk of st.rocks) if (Math.abs(p.x - rk.x) < 0.55 && Math.abs(p.y - rk.y) < 0.55) { killPlayer(st, 'rock'); break; }
  }
  if (p.alive) {
    for (const c of st.cars) if (c.stun <= 0 && Math.abs(p.x - c.x) < 0.7 && Math.abs(p.y - c.y) < 0.7) { killPlayer(st, 'car'); break; }
  }

  // 깃발
  if (p.alive) {
    for (const f of st.flags) {
      if (f.taken) continue;
      if (Math.abs(p.x - f.x) < 0.6 && Math.abs(p.y - f.y) < 0.6) {
        f.taken = true; st.collected++; st.stats.flags++;
        st.seq = Math.min(st.seq + 1, 10);
        if (f.special) st.mult *= 2;
        const pts = st.seq * 100 * st.mult * (st.bonusRound ? 2 : 1);
        addScore(st, pts);
        emit(st, { t: 'flag', n: st.seq, pts, special: f.special, x: f.x, y: f.y });
      }
    }
    if (st.collected >= FLAGS_PER_ROUND) {
      const bonus = Math.floor(st.fuel) * POINTS.fuelLeft;
      addScore(st, bonus);
      st.phase = 'clear'; st.phaseT = 3;
      emit(st, { t: 'clear', round: st.round, bonus });
    }
  }
}

return {
  T, CELLS, DX, DY, START, START_LIVES, FLAGS_PER_ROUND, PLAYER_SPEED, FUEL_MAX, POINTS, SMOKE_LIFE,
  rng, genMaze, distField, newGame, startRound, step, isRoad, canGo, redCount, redSpeedFactor, isBonusRound,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_RALLYX;
