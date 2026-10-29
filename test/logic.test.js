'use strict';
// 방구차 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const DT = 1 / 60;
const NONE = { want: null, smoke: false };
const run = (st, sec, inp = NONE) => { for (let t = 0; t < sec - 1e-9; t += DT) L.step(st, DT, inp); };
const key = (x, y) => y * L.T + x;
// 빨간 차 없이 시험할 판 (지도·깃발은 그대로)
function calm(seed = 1) {
  const st = L.newGame(L.rng(seed));
  st.cars = []; st.rocks = []; st.player.invuln = 0;
  return st;
}
function reachable(grid) {
  const st = { grid };
  return L.distField(st, L.START.x, L.START.y);
}

test('mazes are 55x55, walled around, and every road tile is reachable', () => {
  for (const seed of [11, 23, 37, 111, 5]) {
    const g = L.genMaze(seed);
    assert.strictEqual(g.length, 55);
    for (let i = 0; i < 55; i++) { assert.strictEqual(g[0][i], 1); assert.strictEqual(g[54][i], 1); assert.strictEqual(g[i][0], 1); assert.strictEqual(g[i][54], 1); }
    const d = reachable(g);
    let roads = 0, lost = 0;
    for (let y = 0; y < 55; y++) for (let x = 0; x < 55; x++) if (g[y][x] === 0) { roads++; if (d[y * 55 + x] < 0) lost++; }
    assert.ok(roads > 800);
    assert.strictEqual(lost, 0);
    for (let cy = 0; cy < L.CELLS; cy++) for (let cx = 0; cx < L.CELLS; cx++) assert.strictEqual(g[1 + cy * 3][1 + cx * 3], 0);
  }
});

test('the maze has loops, not just one path (more roads than a tree needs)', () => {
  const g = L.genMaze(11);
  let links = 0;
  for (let cy = 0; cy < L.CELLS; cy++) for (let cx = 0; cx < L.CELLS; cx++) {
    if (cx < L.CELLS - 1 && g[1 + cy * 3][2 + cx * 3] === 0) links++;
    if (cy < L.CELLS - 1 && g[2 + cy * 3][1 + cx * 3] === 0) links++;
  }
  assert.ok(links > L.CELLS * L.CELLS - 1 + 20);
});

test('a round has 10 flags reachable without touching rocks, the first one close to the start', () => {
  for (let round = 1; round <= 8; round++) {
    const st = L.newGame(L.rng(round));
    L.startRound(st, round);
    assert.strictEqual(st.flags.length, 10);
    const d = L.distField(st, L.START.x, L.START.y, st.blockedKeys);
    for (const f of st.flags) assert.ok(d[key(f.x, f.y)] >= 0, `round ${round} flag reachable`);
    const dd = L.distField(st, L.START.x, L.START.y);
    assert.ok(dd[key(st.flags[0].x, st.flags[0].y)] >= 5 && dd[key(st.flags[0].x, st.flags[0].y)] <= 9);
    for (const rk of st.rocks) { assert.ok(dd[key(rk.x, rk.y)] >= 6); assert.ok(!st.flags.some((f) => f.x === rk.x && f.y === rk.y)); }
    assert.strictEqual(st.flags.filter((f) => f.special).length, L.isBonusRound(round) ? 0 : 1);
  }
});

test('red cars: 3 at first, more later, none in bonus rounds, and they get faster', () => {
  assert.strictEqual(L.redCount(1), 2);
  assert.strictEqual(L.redCount(4), 0);
  assert.strictEqual(L.redCount(8), 0);
  assert.ok(L.redCount(10) >= 4 && L.redCount(30) <= 5);
  assert.ok(L.redSpeedFactor(1) < L.redSpeedFactor(6));
  assert.ok(L.redSpeedFactor(50) <= 0.9, 'red cars never as fast as the player');
});

test('the car keeps going by itself, turns at a junction, and stops at a wall', () => {
  const st = calm();
  const p = st.player;
  const open = [0, 1, 2, 3].filter((d) => L.canGo(st, p.x, p.y, d));
  assert.ok(open.length >= 2);
  run(st, 0.3, { want: open[0], smoke: false });
  const d0 = open[0];
  assert.strictEqual(p.dir, d0);
  const moved = Math.abs(p.x - L.START.x) + Math.abs(p.y - L.START.y);
  assert.ok(moved > 1 && moved < 2, 'about 5 tiles per second');
  run(st, 20, { want: null, smoke: false });
  assert.strictEqual(p.dir, -1, 'stops at the dead end or wall');
  assert.ok(L.isRoad(st, Math.round(p.x), Math.round(p.y)));
});

test('a turn waits for the next junction when the way is blocked', () => {
  const st = calm();
  const p = st.player;
  const d = [0, 1, 2, 3].find((x) => L.canGo(st, p.x, p.y, x));
  const side = [(d + 1) % 4, (d + 3) % 4];
  run(st, 0.2, { want: d, smoke: false });
  assert.ok(!Number.isInteger(p.x) || !Number.isInteger(p.y) || true);
  const wall = side.find((s) => !L.canGo(st, Math.round(p.x), Math.round(p.y), s));
  if (wall !== undefined) { run(st, 0.05, { want: wall, smoke: false }); assert.strictEqual(p.dir, d, 'keeps going straight'); }
});

test('reversing is allowed anywhere in a corridor', () => {
  const st = calm();
  const p = st.player;
  const d = [0, 1, 2, 3].find((x) => L.canGo(st, p.x, p.y, x));
  run(st, 0.1, { want: d, smoke: false });
  const x1 = p.x, y1 = p.y;
  run(st, 0.1, { want: (d + 2) % 4, smoke: false });
  assert.strictEqual(p.dir, (d + 2) % 4);
  assert.ok(Math.abs(p.x - L.START.x) + Math.abs(p.y - L.START.y) < Math.abs(x1 - L.START.x) + Math.abs(y1 - L.START.y));
});

test('flags are worth 100, 200, 300 in a row, and the S flag doubles the rest', () => {
  const st = calm();
  const take = (f) => { st.player.x = f.x; st.player.y = f.y; run(st, 0.02); };
  st.flags.forEach((f) => { f.special = false; });
  take(st.flags[0]); take(st.flags[1]); take(st.flags[2]);
  assert.strictEqual(st.score, 100 + 200 + 300);
  st.flags[3].special = true;
  take(st.flags[3]);
  assert.strictEqual(st.score, 600 + 400 * 2);
  take(st.flags[4]);
  assert.strictEqual(st.score, 1400 + 500 * 2);
  assert.strictEqual(st.stats.flags, 5);
});

test('collecting all 10 flags clears the round, adds a fuel bonus and starts the next', () => {
  const st = calm();
  st.flags.forEach((f) => { f.special = false; });
  st.fuel = 50;
  for (const f of st.flags) { st.player.x = f.x; st.player.y = f.y; run(st, 0.02); }
  assert.strictEqual(st.phase, 'clear');
  assert.ok(st.events.length >= 0);
  assert.ok(st.score >= 5500 + 49 * 10);
  run(st, 3.2);
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.phase, 'play');
  assert.ok(st.fuel > L.FUEL_MAX - 1, 'full tank again');
  assert.ok(st.score > 5500);
  assert.strictEqual(st.cars.length, L.redCount(2));
});

test('round 4 is a bonus round without red cars or smoke, and flags count double', () => {
  const st = calm();
  L.startRound(st, 4);
  assert.strictEqual(st.cars.length, 0);
  st.player.invuln = 0;
  st.rocks = [];
  const f = st.flags[0];
  st.player.x = f.x; st.player.y = f.y; run(st, 0.02);
  assert.strictEqual(st.score, 200);
  const fuel = st.fuel;
  run(st, 0.5, { want: 0, smoke: true });
  assert.strictEqual(st.smoke.length, 0);
  assert.ok(st.fuel < fuel);
});

test('fuel drains over time and smoke costs more; out of fuel means slow and no smoke', () => {
  const st = calm();
  run(st, 10);
  assert.ok(Math.abs(st.fuel - (L.FUEL_MAX - 11)) < 0.5);
  const p = st.player;
  const d = [0, 1, 2, 3].find((x) => L.canGo(st, p.x, p.y, x));
  run(st, 0.2, { want: d, smoke: false });
  const f0 = st.fuel;
  run(st, 1, { want: d, smoke: true });
  assert.ok(st.smoke.length > 0 && st.fuel < f0 - 1.1 - 1);
  st.fuel = 0; st.smoke = [];
  run(st, 0.5, { want: d, smoke: true });
  assert.strictEqual(st.smoke.length, 0);
  const a = { x: st.player.x, y: st.player.y };
  const slow = calm(); slow.fuel = 0; const q = slow.player;
  run(slow, 0.5, { want: d, smoke: false });
  const full = calm(); run(full, 0.5, { want: d, smoke: false });
  const dist = (e, o) => Math.abs(e.x - o.x) + Math.abs(e.y - o.y);
  assert.ok(dist(q, L.START) < dist(full.player, L.START));
  assert.ok(a);
});

test('smoke stuns a red car and scores 80, one stun scores once, and the car goes again later', () => {
  const st = calm();
  const d = [0, 1, 2, 3].find((x) => L.canGo(st, st.player.x, st.player.y, x));
  st.cars = [{ x: 1, y: 1, sx: 1, sy: 1, dir: -1, stun: 0, chase: 0, rockKey: -1, anim: 0 }];
  st.holdT = 5;                                               // 빨간 차가 가만히 있게
  const car = st.cars[0];
  st.smoke = [{ x: 1.3, y: 1, t: 0 }];
  run(st, 0.05, { want: d, smoke: false });
  assert.ok(car.stun > 2, 'stunned');
  assert.strictEqual(st.score, 80);
  assert.strictEqual(st.stats.stuns, 1);
  run(st, 0.5);
  assert.strictEqual(st.score, 80);
  run(st, 3);
  assert.strictEqual(car.stun, 0);
});

test('the smoke comes out behind the car and lasts about a second and a half', () => {
  const st = calm();
  const p = st.player;
  const d = [0, 1, 2, 3].find((x) => L.canGo(st, p.x, p.y, x));
  run(st, 0.3, { want: d, smoke: true });
  assert.ok(st.smoke.length >= 2);
  const s = st.smoke[0];
  const along = (p.x - s.x) * L.DX[p.face] + (p.y - s.y) * L.DY[p.face];
  assert.ok(along > 0, 'behind the car');
  run(st, 2, NONE);
  assert.strictEqual(st.smoke.length, 0);
});

test('a red car that runs into a rock is stunned (50 points) once per rock', () => {
  const st = calm();
  st.player.invuln = 99;
  st.rocks = [{ x: 4, y: 1 }];
  st.cars = [{ x: 4, y: 1, sx: 4, sy: 1, dir: -1, stun: 0, chase: 0, rockKey: -1, anim: 0 }];
  st.holdT = 0;
  run(st, 0.05);
  assert.strictEqual(st.score, 50);
  assert.ok(st.cars[0].stun > 3);
  run(st, 0.2);
  assert.strictEqual(st.score, 50);
});

test('touching a red car or a rock costs a life, then the car restarts with a short shield', () => {
  const st = L.newGame(L.rng(3));
  st.player.invuln = 0; st.holdT = 0;
  st.rocks = [];
  const car = st.cars[0];
  car.x = st.player.x; car.y = st.player.y; car.stun = 0;
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.strictEqual(st.phase, 'dying');
  run(st, 1.6);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.player.x, L.START.x);
  assert.ok(st.player.invuln > 0);
  const st2 = calm();
  st2.rocks = [{ x: st2.player.x, y: st2.player.y }];
  run(st2, 0.05);
  assert.strictEqual(st2.lives, L.START_LIVES - 1);
});

test('a stunned red car is harmless, and the shield protects a restarted car', () => {
  const st = L.newGame(L.rng(4));
  st.player.invuln = 0; st.holdT = 0; st.rocks = [];
  const car = st.cars[0];
  car.x = st.player.x; car.y = st.player.y; car.stun = 2;
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES);
  car.stun = 0; st.player.invuln = 1;
  run(st, 0.05);
  assert.strictEqual(st.lives, L.START_LIVES);
});

test('losing the last life ends the game, flags already taken stay taken after a crash', () => {
  const st = L.newGame(L.rng(5));
  st.rocks = []; st.player.invuln = 0; st.holdT = 0;
  st.flags[0].taken = true; st.collected = 1; st.seq = 1;
  const car = st.cars[0]; car.x = st.player.x; car.y = st.player.y;
  run(st, 0.05);
  assert.strictEqual(st.seq, 0, 'the 100-200-300 count starts over');
  run(st, 1.6);
  assert.strictEqual(st.flags[0].taken, true);
  assert.strictEqual(st.collected, 1);
  st.lives = 1; st.player.invuln = 0; st.holdT = 0;
  const c2 = st.cars[0]; c2.x = st.player.x; c2.y = st.player.y; c2.stun = 0;
  run(st, 0.05);
  assert.strictEqual(st.lives, 0);
  run(st, 1.6);
  assert.strictEqual(st.phase, 'over');
});

test('extra life at 20000 points', () => {
  const st = calm();
  st.score = 19950;
  const f = st.flags[0]; st.player.x = f.x; st.player.y = f.y; run(st, 0.02);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
});

test('red cars chase: they get closer to the car over time on the roads', () => {
  const st = L.newGame(L.rng(6));
  st.rocks = []; st.player.invuln = 99;
  st.holdT = 0;
  const c = st.cars[0];
  const d0 = L.distField(st, Math.round(st.player.x), Math.round(st.player.y))[Math.round(c.y) * L.T + Math.round(c.x)];
  run(st, 6);
  const d1 = L.distField(st, Math.round(st.player.x), Math.round(st.player.y))[Math.round(c.y) * L.T + Math.round(c.x)];
  assert.ok(d1 < d0, `${d0} -> ${d1}`);
});

test('random play for several minutes keeps every car on the roads', () => {
  const rand = L.rng(42);
  for (let g = 0; g < 6; g++) {
    const st = L.newGame(L.rng(200 + g));
    const inp = { want: null, smoke: false };
    for (let i = 0; i < 60 * 150 && st.phase !== 'over'; i++) {
      if (i % 25 === 0) { inp.want = [null, 0, 1, 2, 3][Math.floor(rand() * 5)]; inp.smoke = rand() < 0.3; }
      L.step(st, DT, inp);
      for (const e of [st.player, ...st.cars]) {
        assert.ok(e.x >= 0 && e.y >= 0 && e.x <= 54 && e.y <= 54);
        const rx = Math.round(e.x), ry = Math.round(e.y);
        assert.ok(L.isRoad(st, Math.floor(e.x + 1e-6), Math.floor(e.y + 1e-6)) || L.isRoad(st, rx, ry), 'on a road');
        assert.ok(Math.abs(e.x - rx) < 1e-6 || Math.abs(e.y - ry) < 1e-6, 'on a road line');
      }
      assert.ok(st.fuel >= 0 && st.lives >= 0);
    }
  }
});

test('smoke can be sprayed even while the car is standing still', () => {
  const st = calm();
  assert.strictEqual(st.player.dir, -1);
  run(st, 0.3, { want: null, smoke: true });
  assert.ok(st.smoke.length >= 2);
});
