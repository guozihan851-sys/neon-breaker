/* =========================================================
   game.js — NEON BREAKER 主程序
   纯 Canvas 2D，无任何外部依赖
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------------- 虚拟分辨率与常量 ---------------- */
  var W = 960, H = 600;              // 逻辑画布尺寸，实际按 DPR 缩放
  var STEP = 1 / 120;                // 固定物理步长，保证不同刷新率下手感一致
  var WALL = 12;                     // 四周墙体厚度
  var BRICK_TOP = 78;
  var BRICK_SIDE = 26;
  var BRICK_GAP = 6;
  var BRICK_H = 26;

  var PADDLE_Y = H - 48;
  var PADDLE_H = 15;
  var PADDLE_W = 118;
  var PADDLE_MIN = 74;
  var PADDLE_MAX = 230;
  var PADDLE_KEY_SPEED = 700;        // px/s
  var BALL_R = 8;
  var BALL_BASE_SPEED = 350;         // px/s
  var BALL_MAX_SPEED = 660;
  var MAX_BALLS = 7;
  var MAX_LIVES = 6;
  var START_LIVES = 3;

  var LS_HIGH = 'neon-breaker-high';
  var LS_MUTE = 'neon-breaker-mute';

  /* ---------------- 调色板 ---------------- */
  var HP_COLOR = {
    1: { c: '#00f0ff', g: 'rgba(0,240,255,' },
    2: { c: '#a3ff12', g: 'rgba(163,255,18,' },
    3: { c: '#ffb020', g: 'rgba(255,176,32,' },
    4: { c: '#ff2fb9', g: 'rgba(255,47,185,' },
    5: { c: '#8b5cf6', g: 'rgba(139,92,246,' }
  };
  var BOMB_COLOR = { c: '#ff3b5c', g: 'rgba(255,59,92,' };

  /* ---------------- 道具定义 ---------------- */
  var POWERS = {
    wide:   { label: 'W',  name: '加长挡板', color: '#00f0ff', dur: 15 },
    multi:  { label: '×3', name: '三球分身', color: '#a3ff12', dur: 0 },
    laser:  { label: 'L',  name: '激光炮',   color: '#ff2fb9', dur: 11 },
    slow:   { label: '↓',  name: '子弹时间', color: '#4dd2ff', dur: 8 },
    shield: { label: 'S',  name: '底部护盾', color: '#8b5cf6', dur: 22 },
    life:   { label: '♥',  name: '额外生命', color: '#ff3b5c', dur: 0 }
  };
  var POWER_KEYS = ['wide', 'multi', 'laser', 'slow', 'shield', 'life'];
  var POWER_WEIGHT = [20, 19, 15, 12, 13, 5];

  /* ---------------- 工具函数 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    var nx = clamp(cx, rx, rx + rw), ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });
  var stage = document.getElementById('stage');
  var overlay = document.getElementById('overlay');
  var panel = document.getElementById('panel');
  var touchHint = document.getElementById('touchHint');
  var hud = {
    score: document.getElementById('hudScore'),
    high: document.getElementById('hudHigh'),
    level: document.getElementById('hudLevel'),
    lives: document.getElementById('hudLives'),
    combo: document.getElementById('hudCombo')
  };
  var btnSound = document.getElementById('btnSound');
  var btnPause = document.getElementById('btnPause');
  var btnFull = document.getElementById('btnFull');

  var sfx = new global.Sfx();
  sfx.setMuted(localStorage.getItem(LS_MUTE) === '1');

  /* ---------------- 游戏状态 ---------------- */
  var G = {
    state: 'menu',        // menu | play | pause | over | clear
    score: 0,
    high: parseInt(localStorage.getItem(LS_HIGH) || '0', 10) || 0,
    lives: START_LIVES,
    level: 1,
    combo: 0,
    bestCombo: 0,
    bricksLeft: 0,
    shake: 0,
    flash: 0,
    timeScale: 1,
    banner: null,         // {text, sub, t}
    t: 0,
    running: false,
    muted: sfx.muted,
    isTouch: false,
    ballsLost: 0,
    bricksBroken: 0
  };

  var paddle = {
    x: W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H,
    target: W / 2, vx: 0, glow: 0
  };
  var balls = [];
  var bricks = [];
  var drops = [];
  var bullets = [];
  var particles = [];
  var texts = [];
  var stars = [];
  var effects = { wide: 0, laser: 0, slow: 0, shield: 0 };
  var laserCd = 0;
  var keys = { left: false, right: false };
  var pointerInside = false;

  /* ---------------- 画布 DPR 适配 ---------------- */
  function setupCanvas() {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }
  setupCanvas();

  /* 让画布在任意容器尺寸下保持 16:10 且完整可见 */
  function fitCanvas() {
    var r = stage.getBoundingClientRect();
    var scale = Math.min(r.width / W, r.height / H);
    if (!isFinite(scale) || scale <= 0) return;
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  fitCanvas();

  /* 星空背景 */
  function initStars() {
    stars.length = 0;
    for (var i = 0; i < 90; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        z: rand(0.25, 1), r: rand(0.5, 1.9), tw: rand(0, Math.PI * 2)
      });
    }
  }
  initStars();

  /* ---------------- 坐标换算 ---------------- */
  function toVirtual(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (W / r.width),
      y: (clientY - r.top) * (H / r.height)
    };
  }

  /* ---------------- HUD ---------------- */
  function pop(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  function syncHud(changed) {
    hud.score.textContent = G.score.toLocaleString('en-US');
    hud.high.textContent = Math.max(G.high, G.score).toLocaleString('en-US');
    hud.level.textContent = G.level;
    hud.lives.textContent = G.lives > 0 ? new Array(G.lives + 1).join('♥') : '—';
    var m = multiplier();
    hud.combo.textContent = 'x' + m;
    hud.combo.style.opacity = m > 1 ? 1 : 0.45;
    if (changed === 'score') pop(hud.score);
    if (changed === 'lives') pop(hud.lives);
    if (changed === 'combo') pop(hud.combo);
  }
  function multiplier() { return clamp(1 + Math.floor(G.combo / 4), 1, 10); }

  /* ---------------- 关卡构建 ---------------- */
  function buildLevel(level) {
    var data = global.Levels.build(level);
    bricks.length = 0;
    var usableW = W - BRICK_SIDE * 2;
    var bw = (usableW - BRICK_GAP * (data.cols - 1)) / data.cols;
    for (var r = 0; r < data.rows; r++) {
      for (var c = 0; c < data.cols; c++) {
        var v = data.grid[r][c];
        if (!v) continue;
        var bomb = v === -1;
        bricks.push({
          x: BRICK_SIDE + c * (bw + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          w: bw, h: BRICK_H,
          hp: bomb ? 1 : v,
          maxHp: bomb ? 1 : v,
          bomb: bomb,
          alive: true,
          hit: 0,          // 受击闪白计时
          spawn: (r * 0.035 + c * 0.012) + 0.05  // 入场动画延迟
        });
      }
    }
    G.bricksLeft = bricks.length;
  }

  /* ---------------- 球 ---------------- */
  function makeBall(x, y, angle, speed) {
    return {
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: BALL_R,
      stuck: false,
      trail: []
    };
  }
  function ballSpeed() {
    var s = BALL_BASE_SPEED + (G.level - 1) * 17 + Math.min(G.ballsLost, 6) * 6;
    return Math.min(BALL_MAX_SPEED, s);
  }
  function resetBallOnPaddle() {
    balls.length = 0;
    var b = makeBall(paddle.x, paddle.y - BALL_R - 2, 0, ballSpeed());
    b.stuck = true;
    balls.push(b);
  }
  function launchBall() {
    var launched = false;
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].stuck) {
        var a = rand(-Math.PI * 0.72, -Math.PI * 0.28);
        var sp = ballSpeed();
        balls[i].vx = Math.cos(a) * sp;
        balls[i].vy = Math.sin(a) * sp;
        balls[i].stuck = false;
        launched = true;
      }
    }
    if (launched) { sfx.launch(); burst(paddle.x, paddle.y - 8, 10, '#00f0ff', 120); }
  }
  function normalizeBall(b) {
    var sp = Math.hypot(b.vx, b.vy) || 1;
    var want = ballSpeed() * G.timeScale;
    b.vx = b.vx / sp * want;
    b.vy = b.vy / sp * want;
    // 防止球变成近乎水平导致来回拖时间
    var minVy = want * 0.22;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
      var nsp = Math.hypot(b.vx, b.vy);
      b.vx = b.vx / nsp * want; b.vy = b.vy / nsp * want;
    }
  }
  /* ---------------- 粒子 / 飘字 ---------------- */
  function burst(x, y, n, color, speed) {
    speed = speed || 180;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rand(speed * 0.25, speed);
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.28, 0.7), max: 0.7, size: rand(1.6, 4.2),
        color: color, grav: rand(120, 420), spark: Math.random() < 0.35
      });
    }
    if (particles.length > 620) particles.splice(0, particles.length - 620);
  }
  function shards(x, y, w, h, color) {
    for (var i = 0; i < 9; i++) {
      var a = rand(-Math.PI, 0);
      var s = rand(90, 330);
      particles.push({
        x: x + rand(0, w), y: y + rand(0, h),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7,
        life: rand(0.45, 1.0), max: 1.0, size: rand(2.5, 6.5),
        color: color, grav: 620, shard: true, rot: rand(0, 6.28), vr: rand(-9, 9)
      });
    }
  }
  function floatText(x, y, str, color, size) {
    texts.push({ x: x, y: y, str: str, color: color || '#fff', size: size || 16, life: 0.9, max: 0.9 });
    if (texts.length > 40) texts.shift();
  }
  function ring(x, y, color, r0, r1, life) {
    particles.push({ ring: true, x: x, y: y, r: r0, r1: r1, life: life || 0.4, max: life || 0.4, color: color });
  }

  function addShake(v) { G.shake = Math.min(26, G.shake + v); }

  /* ---------------- 得分 ---------------- */
  function addScore(v, x, y, label) {
    G.score += v;
    if (G.score > G.high) { G.high = G.score; localStorage.setItem(LS_HIGH, String(G.high)); }
    if (x != null) floatText(x, y, (label || '') + '+' + v, '#ffe9a8', 15);
    syncHud('score');
  }

  /* ---------------- 砖块破坏 ---------------- */
  function damageBrick(br, dmg, fromX, fromY) {
    if (!br.alive) return;
    br.hp -= dmg;
    br.hit = 0.14;
    if (br.hp > 0) {
      var col = HP_COLOR[clamp(br.hp, 1, 5)].c;
      burst(fromX == null ? br.x + br.w / 2 : fromX, fromY == null ? br.y + br.h / 2 : fromY, 6, col, 150);
      sfx.brick(br.hp);
      addShake(1.6);
      return;
    }
    destroyBrick(br, fromX, fromY);
  }

  function destroyBrick(br, fromX, fromY) {
    if (!br.alive) return;
    br.alive = false;
    G.bricksLeft--;
    G.bricksBroken++;
    G.combo++;
    if (G.combo > G.bestCombo) G.bestCombo = G.combo;
    syncHud('combo');

    var cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    var col = br.bomb ? BOMB_COLOR.c : HP_COLOR[clamp(br.maxHp, 1, 5)].c;
    shards(br.x, br.y, br.w, br.h, col);
    burst(cx, cy, br.bomb ? 26 : 14, col, br.bomb ? 380 : 230);
    ring(cx, cy, col, 6, br.bomb ? 78 : 42, br.bomb ? 0.42 : 0.28);

    var m = multiplier();
    var pts = Math.round((br.bomb ? 160 : 60 * br.maxHp) * m);
    addScore(pts, cx, cy - 4, m > 1 ? ('x' + m + ' ') : '');
    sfx.breakBrick(G.combo);
    addShake(br.bomb ? 9 : 3.2);

    if (br.bomb) {
      sfx.explode();
      G.flash = Math.max(G.flash, 0.4);
      // 3x3 范围连锁爆炸
      var nearby = bricks.filter(function (o) {
        return o.alive && Math.abs((o.x + o.w / 2) - cx) < br.w * 1.7 && Math.abs((o.y + o.h / 2) - cy) < br.h * 1.7;
      });
      for (var i = 0; i < nearby.length; i++) damageBrick(nearby[i], 3, cx, cy);
      // 爆炸也能打掉附近的道具球
      for (var j = 0; j < balls.length; j++) {
        if (Math.hypot(balls[j].x - cx, balls[j].y - cy) < 90) {
          var a = Math.atan2(balls[j].y - cy, balls[j].x - cx);
          balls[j].vx += Math.cos(a) * 60; balls[j].vy += Math.sin(a) * 60;
        }
      }
    }

    maybeDrop(cx, cy, br.bomb);
    if (G.bricksLeft <= 0) levelCleared();
  }

  /* ---------------- 道具掉落 ---------------- */
  function rollPower() {
    var total = 0, i;
    for (i = 0; i < POWER_KEYS.length; i++) {
      var k = POWER_KEYS[i];
      var w = POWER_WEIGHT[i];
      if (k === 'life' && G.lives >= MAX_LIVES) w = 0;
      total += w;
    }
    var r = Math.random() * total;
    for (i = 0; i < POWER_KEYS.length; i++) {
      var key = POWER_KEYS[i];
      var wt = POWER_WEIGHT[i];
      if (key === 'life' && G.lives >= MAX_LIVES) wt = 0;
      r -= wt;
      if (r <= 0) return key;
    }
    return 'wide';
  }

  function maybeDrop(x, y, forced) {
    var chance = forced ? 0.85 : 0.155;
    if (Math.random() > chance) return;
    drops.push({
      x: x, y: y, w: 36, h: 19, vy: 152,
      type: rollPower(), t: 0, rot: rand(-0.2, 0.2)
    });
  }

  function applyPower(type) {
    var def = POWERS[type];
    sfx.powerup();
    floatText(paddle.x, paddle.y - 26, def.name, def.color, 17);
    ring(paddle.x, paddle.y, def.color, 8, 62, 0.4);
    burst(paddle.x, paddle.y - 6, 16, def.color, 240);
    addScore(25);

    if (type === 'wide') {
      effects.wide = Math.max(effects.wide, def.dur);
      paddle.w = clamp(paddle.w * 1.45, PADDLE_MIN, PADDLE_MAX);
    } else if (type === 'multi') {
      splitBalls();
    } else if (type === 'laser') {
      effects.laser = Math.max(effects.laser, def.dur);
    } else if (type === 'slow') {
      effects.slow = Math.max(effects.slow, def.dur);
      G.timeScale = 0.62;
    } else if (type === 'shield') {
      effects.shield = Math.max(effects.shield, def.dur);
    } else if (type === 'life') {
      if (G.lives < MAX_LIVES) { G.lives++; syncHud('lives'); }
      else addScore(500, paddle.x, paddle.y - 40, '满命 ');
    }
  }

  function splitBalls() {
    var src = balls.slice(0);
    for (var i = 0; i < src.length && balls.length < MAX_BALLS; i++) {
      var b = src[i];
      if (b.stuck) { launchBall(); continue; }
      var base = Math.atan2(b.vy, b.vx);
      var sp = ballSpeed() * G.timeScale;
      for (var k = -1; k <= 1; k += 2) {
        if (balls.length >= MAX_BALLS) break;
        var a = base + k * 0.42;
        var nb = makeBall(b.x, b.y, a, sp);
        nb.trail = b.trail.slice(-4);
        balls.push(nb);
      }
    }
  }

  /* ---------------- 掉球 / 生命 ---------------- */
  function loseBall(index) {
    balls.splice(index, 1);
    if (balls.length > 0) return;
    // 护盾优先
    if (effects.shield > 0) {
      effects.shield = 0;
      sfx.shield();
      G.flash = Math.max(G.flash, 0.3);
      ring(W / 2, H - 6, '#8b5cf6', 10, 200, 0.5);
      floatText(W / 2, H - 60, '护盾抵挡!', '#c4b5fd', 17);
      resetBallOnPaddle();
      return;
    }
    G.lives--;
    G.combo = 0;
    G.ballsLost++;
    sfx.loseLife();
    addShake(14);
    G.flash = Math.max(G.flash, 0.55);
    burst(paddle.x, H - 8, 26, '#ff3b5c', 300);
    syncHud('lives');
    if (G.lives <= 0) { gameOver(); return; }
    effects.wide = 0; effects.laser = 0; effects.slow = 0;
    G.timeScale = 1;
    paddle.w = PADDLE_W;
    resetBallOnPaddle();
  }

  /* ---------------- 物理更新 ---------------- */
  function stepPhysics(dt) {
    var sdt = dt * G.timeScale;   // 子弹时间只影响球/道具/子弹
    updatePaddle(dt);
    updateBalls(sdt);
    updateDrops(sdt);
    updateBullets(sdt, dt);
    updateEffects(dt);
  }

  function updatePaddle(dt) {
    var prev = paddle.x;
    if (keys.left || keys.right) {
      var dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      paddle.x += dir * PADDLE_KEY_SPEED * dt;
      paddle.target = paddle.x;
    } else if (pointerInside || G.isTouch) {
      var k = Math.min(1, dt * 26);
      paddle.x += (paddle.target - paddle.x) * k;
    }
    var half = paddle.w / 2;
    paddle.x = clamp(paddle.x, WALL + half, W - WALL - half);
    paddle.vx = (paddle.x - prev) / Math.max(dt, 0.0001);
    paddle.glow = Math.max(0, paddle.glow - dt * 3.2);
  }

  function updateBalls(dt) {
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      if (b.stuck) {
        b.x = paddle.x; b.y = paddle.y - b.r - 2;
        b.trail.length = 0;
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 12) b.trail.shift();

      // 墙壁
      if (b.x - b.r < WALL) { b.x = WALL + b.r; b.vx = Math.abs(b.vx); sfx.wall(); burst(b.x - b.r, b.y, 4, '#7df9ff', 90); }
      else if (b.x + b.r > W - WALL) { b.x = W - WALL - b.r; b.vx = -Math.abs(b.vx); sfx.wall(); burst(b.x + b.r, b.y, 4, '#7df9ff', 90); }
      if (b.y - b.r < WALL) { b.y = WALL + b.r; b.vy = Math.abs(b.vy); sfx.wall(); burst(b.x, b.y - b.r, 4, '#7df9ff', 90); }

      // 底部
      if (b.y - b.r > H + 6) { loseBall(i); continue; }

      // 挡板
      if (b.vy > 0 && circleRect(b.x, b.y, b.r, paddle.x - paddle.w / 2, paddle.y, paddle.w, paddle.h)) {
        var rel = clamp((b.x - paddle.x) / (paddle.w / 2), -1, 1);
        var angle = rel * (Math.PI * 0.36) - Math.PI / 2;   // -90° ± 65°
        var sp = ballSpeed() * G.timeScale;
        b.vx = Math.cos(angle) * sp + clamp(paddle.vx * 0.16, -90, 90);
        b.vy = Math.sin(angle) * sp;
        b.y = paddle.y - b.r - 0.5;
        normalizeBall(b);
        G.combo = 0; syncHud('combo');
        paddle.glow = 1;
        sfx.paddle();
        burst(b.x, paddle.y, 7, '#00f0ff', 160);
        continue;
      }

      // 砖块（每步最多命中一块，避免同时反向）
      for (var j = 0; j < bricks.length; j++) {
        var br = bricks[j];
        if (!br.alive || br.spawn > 0) continue;
        if (!circleRect(b.x, b.y, b.r, br.x, br.y, br.w, br.h)) continue;

        var nx = clamp(b.x, br.x, br.x + br.w);
        var ny = clamp(b.y, br.y, br.y + br.h);
        var dx = b.x - nx, dy = b.y - ny;
        if (Math.abs(dx) > Math.abs(dy)) {
          b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
          b.x = dx >= 0 ? br.x + br.w + b.r + 0.2 : br.x - b.r - 0.2;
        } else {
          b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
          b.y = dy >= 0 ? br.y + br.h + b.r + 0.2 : br.y - b.r - 0.2;
        }
        normalizeBall(b);
        damageBrick(br, 1, nx, ny);
        break;
      }
    }
  }

  function updateDrops(dt) {
    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.t += dt;
      d.y += d.vy * dt;
      d.x += Math.sin(d.t * 3.4) * 22 * dt;
      if (d.y - d.h > H) { drops.splice(i, 1); continue; }
      if (circleRect(d.x, d.y, 14, paddle.x - paddle.w / 2, paddle.y - 4, paddle.w, paddle.h + 8)) {
        applyPower(d.type);
        drops.splice(i, 1);
      }
    }
  }

  function updateBullets(sdt, dt) {
    if (effects.laser > 0) {
      laserCd -= dt;
      if (laserCd <= 0) {
        laserCd = 0.26;
        var ex = paddle.w / 2 - 10;
        bullets.push({ x: paddle.x - ex, y: paddle.y - 4, vy: -820 });
        bullets.push({ x: paddle.x + ex, y: paddle.y - 4, vy: -820 });
        sfx.laser();
        paddle.glow = 1;
      }
    }
    for (var i = bullets.length - 1; i >= 0; i--) {
      var bu = bullets[i];
      bu.y += bu.vy * sdt;
      if (bu.y < WALL) { bullets.splice(i, 1); burst(bu.x, WALL, 5, '#ff2fb9', 120); continue; }
      var hitAny = false;
      for (var j = 0; j < bricks.length; j++) {
        var br = bricks[j];
        if (!br.alive || br.spawn > 0) continue;
        if (bu.x > br.x - 2 && bu.x < br.x + br.w + 2 && bu.y > br.y - 4 && bu.y < br.y + br.h) {
          damageBrick(br, 1, bu.x, br.y + br.h);
          bullets.splice(i, 1);
          hitAny = true;
          break;
        }
      }
      if (hitAny) continue;
    }
  }

  function updateEffects(dt) {
    var changed = false;
    ['wide', 'laser', 'slow', 'shield'].forEach(function (k) {
      if (effects[k] > 0) {
        effects[k] = Math.max(0, effects[k] - dt);
        changed = true;
        if (effects[k] === 0) {
          if (k === 'wide') paddle.w = PADDLE_W;
          if (k === 'slow') G.timeScale = 1;
          if (k === 'laser') laserCd = 0;
        }
      }
    });
    return changed;
  }

  function updateDecor(dt) {
    // 粒子
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.ring) { p.r += (p.r1 - p.r) * Math.min(1, dt * 9); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      p.vx *= (1 - 1.1 * dt);
      if (p.shard) p.rot += p.vr * dt;
      if (p.y > H - 2 && p.vy > 0) { p.y = H - 2; p.vy *= -0.42; p.vx *= 0.7; }
    }
    // 飘字
    for (var k = texts.length - 1; k >= 0; k--) {
      var t = texts[k];
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) texts.splice(k, 1);
    }
    // 星星
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      st.y += (6 + st.z * 16) * dt;
      st.tw += dt * 2.2;
      if (st.y > H) { st.y = -2; st.x = Math.random() * W; }
    }
    // 砖块入场动画与闪白
    for (var b = 0; b < bricks.length; b++) {
      if (bricks[b].spawn > 0) bricks[b].spawn = Math.max(0, bricks[b].spawn - dt);
      if (bricks[b].hit > 0) bricks[b].hit = Math.max(0, bricks[b].hit - dt);
    }
    G.shake = Math.max(0, G.shake - dt * 46);
    G.flash = Math.max(0, G.flash - dt * 2.2);
    if (G.banner) {
      G.banner.t -= dt;
      if (G.banner.t <= 0) G.banner = null;
    }
    G.t += dt;
  }
  /* ================= 渲染 ================= */
  function draw() {
    ctx.save();
    // 画面震动
    if (G.shake > 0.2) {
      ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
    }

    drawBackground();
    drawWalls();
    drawBricks();
    drawShield();
    drawDrops();
    drawBullets();
    drawParticles();
    drawBalls();
    drawPaddle();
    drawTexts();
    drawCanvasHud();
    drawBanner();

    ctx.restore();

    if (G.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + (G.flash * 0.34).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // 暗角
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0a1c');
    g.addColorStop(0.55, '#06060f');
    g.addColorStop(1, '#0b0718');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星星
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = 0.22 + s.z * 0.5 * (0.6 + 0.4 * Math.sin(s.tw));
      ctx.fillStyle = 'rgba(180,225,255,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * s.z, 0, 6.2832);
      ctx.fill();
    }

    // 透视网格地板
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#2de2ff';
    ctx.lineWidth = 1;
    var hz = H * 0.62;
    for (var k = 0; k <= 12; k++) {
      var yy = hz + Math.pow(k / 12, 2.1) * (H - hz);
      ctx.globalAlpha = 0.03 + (k / 12) * 0.12;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    ctx.globalAlpha = 0.06;
    var off = (G.t * 26) % 80;
    for (var x = -80; x < W + 80; x += 80) {
      ctx.beginPath(); ctx.moveTo(x + off * 0.2, hz); ctx.lineTo(x + off - 40, H); ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls() {
    ctx.save();
    ctx.shadowBlur = 16;
    ctx.shadowColor = 'rgba(0,240,255,.6)';
    ctx.fillStyle = 'rgba(0,240,255,.10)';
    ctx.fillRect(0, 0, W, WALL);
    ctx.fillRect(0, 0, WALL, H);
    ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.strokeStyle = 'rgba(0,240,255,.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(WALL, H); ctx.lineTo(WALL, WALL); ctx.lineTo(W - WALL, WALL); ctx.lineTo(W - WALL, H);
    ctx.stroke();
    ctx.restore();
  }

  function drawBricks() {
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      var t = b.spawn > 0 ? 1 - b.spawn / 0.5 : 1;
      if (b.spawn > 0) {
        var ease = 1 - Math.pow(1 - clamp(t, 0, 1), 3);
        ctx.save();
        ctx.globalAlpha = ease;
        var sc = 0.6 + ease * 0.4;
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.scale(sc, sc);
        ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
        drawBrick(b);
        ctx.restore();
      } else {
        drawBrick(b);
      }
    }
  }

  function drawBrick(b) {
    var pal = b.bomb ? BOMB_COLOR : HP_COLOR[clamp(b.hp, 1, 5)];
    var x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = pal.g + '0.55)';

    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, shade(pal.c, 0.42));
    g.addColorStop(0.5, pal.c);
    g.addColorStop(1, shade(pal.c, -0.42));
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();

    // 内部高光
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    roundRect(ctx, x + 3, y + 2.5, w - 6, h * 0.3, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
    ctx.stroke();

    if (b.bomb) {
      var pulse = 0.55 + 0.45 * Math.sin(G.t * 8);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 + pulse * 0.4).toFixed(2) + ')';
      ctx.font = '700 14px Orbitron, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✸', x + w / 2, y + h / 2 + 1);
    } else if (b.maxHp > 1 && b.hp < b.maxHp) {
      // 受损裂纹
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      var d = (b.maxHp - b.hp) / b.maxHp;
      ctx.moveTo(x + w * 0.28, y + 2);
      ctx.lineTo(x + w * (0.4 + d * 0.1), y + h * 0.5);
      ctx.lineTo(x + w * 0.24, y + h - 2);
      if (d > 0.4) { ctx.moveTo(x + w * 0.66, y + 2); ctx.lineTo(x + w * 0.58, y + h * 0.62); }
      ctx.stroke();
    }

    if (b.hit > 0) {
      ctx.globalAlpha = b.hit / 0.14 * 0.85;
      ctx.fillStyle = '#fff';
      roundRect(ctx, x, y, w, h, 5);
      ctx.fill();
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function drawPaddle() {
    var x = paddle.x - paddle.w / 2, y = paddle.y, w = paddle.w, h = paddle.h;
    var col = effects.laser > 0 ? '#ff2fb9' : '#00f0ff';
    ctx.save();
    ctx.shadowBlur = 20 + paddle.glow * 22;
    ctx.shadowColor = col;
    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, col);
    g.addColorStop(1, shade(col === '#ff2fb9' ? '#ff2fb9' : '#0090ff', -0.35));
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    roundRect(ctx, x + 4, y + 2, w - 8, 3, 2);
    ctx.fill();
    // 两端能量点
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + 6, y + h / 2, 2.2, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(x + w - 6, y + h / 2, 2.2, 0, 6.2832); ctx.fill();
    if (effects.laser > 0) {
      ctx.fillStyle = '#ff2fb9';
      ctx.shadowBlur = 12; ctx.shadowColor = '#ff2fb9';
      ctx.fillRect(x + w / 2 - 12, y - 4, 3, 5);
      ctx.fillRect(x + w / 2 + 9, y - 4, 3, 5);
    }
    ctx.restore();
  }

  function drawBalls() {
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      // 拖尾
      for (var k = 0; k < b.trail.length; k++) {
        var p = b.trail[k];
        var a = (k / b.trail.length) * 0.42;
        ctx.fillStyle = 'rgba(0,240,255,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, b.r * (0.35 + k / b.trail.length * 0.75), 0, 6.2832);
        ctx.fill();
      }
      ctx.save();
      ctx.shadowBlur = 22; ctx.shadowColor = '#7df9ff';
      var g = ctx.createRadialGradient(b.x - 2.5, b.y - 2.5, 1, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#a9f7ff');
      g.addColorStop(1, '#00c8ff');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  }

  function drawDrops() {
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i], def = POWERS[d.type];
      var bob = Math.sin(d.t * 6) * 1.6;
      ctx.save();
      ctx.translate(d.x, d.y + bob);
      ctx.rotate(d.rot * Math.sin(d.t * 3));
      ctx.shadowBlur = 18; ctx.shadowColor = def.color;
      var g = ctx.createLinearGradient(0, -d.h / 2, 0, d.h / 2);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, def.color);
      g.addColorStop(1, shade(def.color, -0.4));
      ctx.fillStyle = g;
      roundRect(ctx, -d.w / 2, -d.h / 2, d.w, d.h, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#06060f';
      ctx.font = '700 12px Orbitron, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.label, 0, 1);
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.save();
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      var g = ctx.createLinearGradient(b.x, b.y - 16, b.x, b.y + 4);
      g.addColorStop(0, 'rgba(255,47,185,0)');
      g.addColorStop(1, '#ffd9f2');
      ctx.fillStyle = g;
      ctx.shadowBlur = 12; ctx.shadowColor = '#ff2fb9';
      ctx.fillRect(b.x - 1.8, b.y - 16, 3.6, 20);
    }
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = clamp(p.life / p.max, 0, 1);
      if (p.ring) {
        ctx.save();
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.4 * a + 0.4;
        ctx.shadowBlur = 14; ctx.shadowColor = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10; ctx.shadowColor = p.color;
      if (p.shard) {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.spark) {
        ctx.fillRect(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.6, p.size * 2.4);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawShield() {
    if (effects.shield <= 0) return;
    var a = effects.shield < 4 ? (0.35 + 0.45 * Math.abs(Math.sin(G.t * 9))) : 0.8;
    ctx.save();
    ctx.globalAlpha = a;
    var g = ctx.createLinearGradient(0, H - 14, 0, H);
    g.addColorStop(0, 'rgba(139,92,246,0)');
    g.addColorStop(1, 'rgba(196,181,253,.85)');
    ctx.fillStyle = g;
    ctx.fillRect(WALL, H - 12, W - WALL * 2, 12);
    ctx.shadowBlur = 18; ctx.shadowColor = '#8b5cf6';
    ctx.strokeStyle = '#ddd6fe'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(WALL, H - 3); ctx.lineTo(W - WALL, H - 3); ctx.stroke();
    ctx.restore();
  }

  function drawTexts() {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var a = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '700 ' + t.size + 'px Orbitron, "Noto Sans SC", sans-serif';
      ctx.shadowBlur = 12; ctx.shadowColor = t.color;
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  }

  function drawCanvasHud() {
    ctx.save();
    // 道具计时条
    var keysOn = ['wide', 'laser', 'slow', 'shield'].filter(function (k) { return effects[k] > 0; });
    var px = WALL + 10, py = H - 22;
    ctx.textBaseline = 'middle';
    for (var i = 0; i < keysOn.length; i++) {
      var k = keysOn[i], def = POWERS[k];
      var remain = effects[k] / def.dur;
      var w = 74;
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      roundRect(ctx, px, py - 8, w, 16, 8); ctx.fill();
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.85;
      roundRect(ctx, px, py - 8, Math.max(4, w * remain), 16, 8); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#05060f';
      ctx.font = '700 10px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.label, px + w / 2, py + 1);
      px += w + 8;
    }
    // 连击
    var m = multiplier();
    if (m > 1) {
      ctx.textAlign = 'right';
      ctx.font = '900 22px Orbitron, sans-serif';
      ctx.shadowBlur = 16; ctx.shadowColor = '#a3ff12';
      ctx.fillStyle = '#a3ff12';
      ctx.fillText('COMBO x' + m, W - WALL - 12, H - 20);
      ctx.shadowBlur = 0;
      ctx.font = '600 10px Orbitron, sans-serif';
      ctx.fillStyle = 'rgba(163,255,18,.6)';
      ctx.fillText('连击 ' + G.combo, W - WALL - 12, H - 38);
    }
    // 剩余砖块
    ctx.textAlign = 'left';
    ctx.font = '600 11px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(234,246,255,.35)';
    ctx.fillText('BRICKS ' + G.bricksLeft, WALL + 10, WALL + 14);
    ctx.textAlign = 'right';
    ctx.fillText('LV ' + G.level, W - WALL - 10, WALL + 14);

    // 发射提示
    if (balls.length && balls[0].stuck && G.state === 'play') {
      ctx.textAlign = 'center';
      var al = 0.45 + 0.35 * Math.sin(G.t * 5);
      ctx.globalAlpha = al;
      ctx.font = '700 15px Orbitron, "Noto Sans SC", sans-serif';
      ctx.fillStyle = '#7df9ff';
      ctx.shadowBlur = 12; ctx.shadowColor = '#00f0ff';
      ctx.fillText(G.isTouch ? '点击屏幕发射' : '按 空格 或 点击 发射', W / 2, H - 92);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (!G.banner) return;
    var b = G.banner;
    var total = b.total || 1.8;
    var p = 1 - b.t / total;
    var a = p < 0.15 ? p / 0.15 : (p > 0.75 ? (1 - p) / 0.25 : 1);
    var sc = 0.86 + 0.14 * Math.min(1, p * 3);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(W / 2, H * 0.44);
    ctx.scale(sc, sc);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 56px Orbitron, "Noto Sans SC", sans-serif';
    ctx.shadowBlur = 30; ctx.shadowColor = '#00f0ff';
    ctx.fillStyle = '#fff';
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.font = '700 16px Orbitron, "Noto Sans SC", sans-serif';
      ctx.shadowBlur = 16; ctx.shadowColor = '#ff2fb9';
      ctx.fillStyle = '#ffc7ec';
      ctx.fillText(b.sub, 0, 42);
    }
    ctx.restore();
  }
  /* ================= 流程控制 ================= */
  function showOverlay(html) {
    panel.innerHTML = html;
    overlay.classList.add('show');
  }
  function hideOverlay() {
    overlay.classList.remove('show');
  }

  function setBanner(text, sub, dur) {
    G.banner = { text: text, sub: sub || '', t: dur || 1.8, total: dur || 1.8 };
  }

  function startGame() {
    sfx.init();
    G.score = 0; G.lives = START_LIVES; G.level = 1;
    G.combo = 0; G.bestCombo = 0; G.ballsLost = 0; G.bricksBroken = 0;
    G.timeScale = 1; G.shake = 0; G.flash = 0;
    effects.wide = effects.laser = effects.slow = effects.shield = 0;
    paddle.w = PADDLE_W; paddle.x = W / 2; paddle.target = W / 2;
    drops.length = 0; bullets.length = 0; particles.length = 0; texts.length = 0;
    syncHud();
    startLevel(1);
  }

  function startLevel(n) {
    G.level = n;
    G.combo = 0;
    G.timeScale = 1;
    effects.slow = 0;
    buildLevel(n);
    drops.length = 0;
    bullets.length = 0;
    resetBallOnPaddle();
    setBanner('第 ' + n + ' 关', n === 1 ? '准备好，发射！' : '球速提升 · 布局变化', 1.7);
    G.state = 'play';
    hideOverlay();
    syncHud();
  }

  function levelCleared() {
    if (G.state !== 'play') return;
    G.state = 'clear';
    var bonus = 300 + G.level * 150 + G.lives * 100;
    addScore(bonus);
    sfx.levelUp();
    G.flash = Math.max(G.flash, 0.5);
    for (var i = 0; i < 5; i++) {
      setTimeout(function () {
        burst(rand(WALL + 40, W - WALL - 40), rand(80, H * 0.5), 20,
          pick(['#00f0ff', '#ff2fb9', '#a3ff12', '#ffb020']), 320);
      }, i * 130);
    }
    setBanner('关卡完成', '奖励 +' + bonus, 1.9);
    G.clearT = 2.1;
  }

  function nextLevel() {
    startLevel(G.level + 1);
  }

  function gameOver() {
    G.state = 'over';
    G.combo = 0;
    sfx.gameOver();
    addShake(18);
    burst(paddle.x, paddle.y, 40, '#ff3b5c', 380);
    var isRecord = G.score >= G.high && G.score > 0;
    if (isRecord) localStorage.setItem(LS_HIGH, String(G.high));
    syncHud();
    setTimeout(function () {
      showOverlay(
        '<h2>GAME OVER</h2>' +
        '<p class="tag">霓虹网格已被你撕开一道口子</p>' +
        '<div class="result">' +
          '<div' + (isRecord ? ' class="new"' : '') + '><span>得分</span><b>' + G.score.toLocaleString('en-US') + '</b></div>' +
          '<div><span>抵达关卡</span><b>' + G.level + '</b></div>' +
          '<div><span>最高连击</span><b>x' + clamp(1 + Math.floor(G.bestCombo / 4), 1, 10) + '</b></div>' +
          '<div><span>历史最高</span><b>' + G.high.toLocaleString('en-US') + '</b></div>' +
        '</div>' +
        (isRecord ? '<p style="color:var(--amber);letter-spacing:.2em;font-size:13px">★ 新纪录 ★</p>' : '') +
        '<div><button class="btn" data-action="restart">再来一局</button>' +
        '<button class="btn ghost" data-action="menu">返回标题</button></div>'
      );
    }, 620);
  }

  function togglePause(force) {
    if (G.state === 'play' && force !== false) {
      G.state = 'pause';
      sfx.ui();
      showOverlay(
        '<h2>已暂停</h2><p class="tag">休息一下，网格不会跑掉</p>' +
        '<div><button class="btn" data-action="resume">继续游戏</button>' +
        '<button class="btn ghost" data-action="restart">重新开始</button>' +
        '<button class="btn ghost" data-action="menu">返回标题</button></div>'
      );
    } else if (G.state === 'pause' && force !== true) {
      G.state = 'play';
      hideOverlay();
      sfx.ui();
    }
  }

  function showMenu() {
    G.state = 'menu';
    balls.length = 0; drops.length = 0; bullets.length = 0;
    particles.length = 0; texts.length = 0;
    effects.wide = effects.laser = effects.slow = effects.shield = 0;
    paddle.w = PADDLE_W;
    G.level = 1; G.score = 0; G.lives = START_LIVES; G.combo = 0;
    buildLevel(1);
    syncHud();
    showOverlay(
      '<h1>NEON BREAKER</h1>' +
      '<p class="tag">霓 虹 突 围 · 街 机 打 砖 块</p>' +
      '<p>用挡板反弹能量球，击碎全部霓虹砖块。<br/>接住掉落的道具，把连击堆到 <b style="color:var(--lime)">x10</b> 拿高分。</p>' +
      '<div class="legend">' +
        '<i data-i="W">加长挡板</i><i data-i="×3">三球分身</i>' +
        '<i data-i="L">激光炮</i><i data-i="S">底部护盾</i>' +
        '<i data-i="↓">子弹时间</i><i data-i="♥">额外生命</i>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--muted);margin-top:14px">' +
        (G.isTouch ? '滑动屏幕移动挡板，点击发射能量球' : '← → / 鼠标移动 · 空格发射 · P 暂停') +
        ' · 红色 ✸ 砖块会爆炸</p>' +
      '<div style="margin-top:6px"><button class="btn" data-action="start">开 始 游 戏</button></div>' +
      (G.high > 0 ? '<p style="font-size:12px;color:var(--amber);margin-top:14px;letter-spacing:.14em">历史最高 ' + G.high.toLocaleString('en-US') + '</p>' : '')
    );
  }

  function toggleMute() {
    G.muted = !G.muted;
    sfx.setMuted(G.muted);
    localStorage.setItem(LS_MUTE, G.muted ? '1' : '0');
    btnSound.textContent = G.muted ? '🔇' : '🔊';
    btnSound.classList.toggle('off', G.muted);
    if (!G.muted) sfx.ui();
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  /* ================= 输入 ================= */
  function bindInput() {
    // 键盘
    global.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; e.preventDefault(); }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; e.preventDefault(); }
      if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        sfx.init();
        if (G.state === 'menu') startGame();
        else if (G.state === 'over') { if (overlay.classList.contains('show')) startGame(); }
        else if (G.state === 'clear') nextLevel();
        else if (G.state === 'play') launchBall();
      }
      if (k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); togglePause(); }
      if (k === 'm' || k === 'M') { toggleMute(); }
      if (k === 'r' || k === 'R') { sfx.init(); startGame(); }
      if (k === 'f' || k === 'F') { toggleFullscreen(); }
      if (k === 'Enter' && (G.state === 'menu' || G.state === 'over')) { sfx.init(); startGame(); }
    }, { passive: false });

    global.addEventListener('keyup', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
      if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    });

    // 指针（鼠标 / 触摸 / 触控笔统一处理）
    function onMove(cx, cy) {
      var p = toVirtual(cx, cy);
      paddle.target = clamp(p.x, WALL + paddle.w / 2, W - WALL - paddle.w / 2);
      pointerInside = true;
    }
    stage.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;   // 触摸用 drag 逻辑，避免抖动
      onMove(e.clientX, e.clientY);
    });
    stage.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'touch') pointerInside = false;
    });
    stage.addEventListener('pointerdown', function (e) {
      sfx.init();
      if (e.pointerType === 'touch') {
        G.isTouch = true;
        onMove(e.clientX, e.clientY);
        if (e.target === canvas) e.preventDefault();
      } else {
        onMove(e.clientX, e.clientY);
      }
      if (G.state === 'play') launchBall();
      else if (G.state === 'clear') nextLevel();
    }, { passive: false });

    // 触摸拖动
    stage.addEventListener('touchmove', function (e) {
      if (!e.touches.length) return;
      e.preventDefault();
      G.isTouch = true;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    // 覆盖层按钮（事件委托）
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      sfx.init();
      var act = btn.getAttribute('data-action');
      sfx.ui();
      if (act === 'start' || act === 'restart') startGame();
      else if (act === 'resume') togglePause(false);
      else if (act === 'menu') showMenu();
    });

    btnSound.addEventListener('click', function () { sfx.init(); toggleMute(); });
    btnPause.addEventListener('click', function () { togglePause(); });
    btnFull.addEventListener('click', function () { toggleFullscreen(); });

    // 失焦自动暂停
    global.addEventListener('blur', function () { if (G.state === 'play') togglePause(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && G.state === 'play') togglePause(true);
    });
    global.addEventListener('resize', function () { setupCanvas(); fitCanvas(); });
    global.addEventListener('load', function () { fitCanvas(); });
    document.addEventListener('fullscreenchange', function () {
      setTimeout(function () { fitCanvas(); }, 80);
    });

    // 首次触摸提示
    if ('ontouchstart' in global || navigator.maxTouchPoints > 0) {
      G.isTouch = true;
      touchHint.classList.add('show');
      setTimeout(function () { touchHint.classList.remove('show'); }, 4200);
    }
  }

  /* ================= 主循环 ================= */
  var last = 0, acc = 0;
  function frame(now) {
    global.requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;         // 切标签页回来不要"瞬移"

    if (G.state === 'play') {
      acc += dt;
      var guard = 0;
      while (acc >= STEP && guard < 16) { stepPhysics(STEP); acc -= STEP; guard++; }
      if (guard >= 16) acc = 0;
    } else {
      acc = 0;
      updatePaddle(dt);               // 菜单/暂停时挡板仍跟随，画面不死板
      if (G.state === 'clear') {
        G.clearT -= dt;
        if (G.clearT <= 0) nextLevel();
      }
    }
    updateDecor(dt);
    draw();
  }

  /* ================= 启动 ================= */
  function boot() {
    btnSound.textContent = G.muted ? '🔇' : '🔊';
    btnSound.classList.toggle('off', G.muted);
    bindInput();
    syncHud();
    fitCanvas();
    showMenu();
    global.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 调试 / 自动化测试钩子（不影响正常游戏）
  global.NeonBreaker = {
    G: G, start: startGame, menu: showMenu, pause: togglePause,
    state: function () { return G.state; },
    _debug: {
      applyPower: applyPower, rollPower: rollPower, damageBrick: damageBrick,
      destroyBrick: destroyBrick, levelCleared: levelCleared, loseBall: loseBall,
      launchBall: launchBall, splitBalls: splitBalls, buildLevel: buildLevel,
      stepPhysics: stepPhysics, balls: balls, bricks: bricks, drops: drops,
      bullets: bullets, effects: effects, paddle: paddle, multiplier: multiplier
    }
  };
})(window);