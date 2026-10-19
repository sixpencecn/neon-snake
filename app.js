/*!
 * neon-snake — app.js
 * Rendering, input, audio and the run loop. All simulation lives in game.js.
 * Copyright (c) 2026 sixpencecn — MIT
 */
(function () {
  'use strict';

  var canvas   = document.getElementById('board');
  var ctx      = canvas.getContext('2d');
  var stage    = document.getElementById('stage');
  var elScore  = document.getElementById('score');
  var elBest   = document.getElementById('best');
  var elSpeed  = document.getElementById('speed');
  var overlay  = document.getElementById('overlay');
  var ovTitle  = document.getElementById('ov-title');
  var ovBody   = document.getElementById('ov-body');
  var ovHint   = document.getElementById('ov-hint');
  var elMute   = document.getElementById('mute');

  var COLS = 24, ROWS = 24;
  var game = new Snake({ cols: COLS, rows: ROWS });

  var S = {
    phase: 'ready',          // ready | playing | paused | over
    acc: 0,
    last: 0,
    t: 0,
    shake: 0,
    flash: 0,
    particles: [],
    best: Number(localStorage.getItem('neon-snake:best') || 0) || 0,
    muted: localStorage.getItem('neon-snake:muted') === '1',
    reduce: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };

  var cell = 0;   // CSS px per cell
  var size = 0;   // CSS px board side

  /* ---------------------------------------------------------------- audio */

  var Audio2 = {
    ctx: null,
    ensure: function () {
      if (S.muted) return null;
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, gain, slideTo) {
      var ac = this.ensure();
      if (!ac) return;
      var osc = ac.createOscillator();
      var g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(gain || 0.08, ac.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur + 0.02);
    },
    eat: function () {
      this.tone(520, 0.09, 'triangle', 0.09);
      var self = this;
      setTimeout(function () { self.tone(780, 0.10, 'triangle', 0.07); }, 55);
    },
    bonus: function () {
      var self = this;
      [660, 880, 1100].forEach(function (f, i) {
        setTimeout(function () { self.tone(f, 0.12, 'square', 0.05); }, i * 60);
      });
    },
    die: function () {
      this.tone(320, 0.5, 'sawtooth', 0.09, 60);
    }
  };

  /* ---------------------------------------------------------------- layout */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight));
    if (!size) size = 480;
    canvas.width  = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = size / COLS;
  }

  window.addEventListener('resize', function () { resize(); });
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(stage);

  /* --------------------------------------------------------------- effects */

  function spawnBurst(cx, cy, count, hue, power) {
    var n = S.reduce ? Math.round(count * 0.35) : count;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.4 + Math.random()) * (power || 1);
      S.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp * cell * 0.06,
        vy: Math.sin(a) * sp * cell * 0.06,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        hue: hue + (Math.random() * 30 - 15),
        r: cell * (0.05 + Math.random() * 0.07)
      });
    }
  }

  function updateParticles(dt) {
    var f = dt / 16.67;
    for (var i = S.particles.length - 1; i >= 0; i--) {
      var p = S.particles[i];
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.vx *= 0.94;
      p.vy = p.vy * 0.94 + cell * 0.004 * f;
      p.life -= p.decay * f;
      if (p.life <= 0) S.particles.splice(i, 1);
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - 0.9 * f);
    if (S.flash > 0) S.flash = Math.max(0, S.flash - 0.05 * f);
  }

  /* ---------------------------------------------------------------- render */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    var rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y,     x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x,     y + h, rr);
    ctx.arcTo(x,     y + h, x,     y,     rr);
    ctx.arcTo(x,     y,     x + w, y,     rr);
    ctx.closePath();
  }

  function drawGrid() {
    ctx.save();
    var g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#0a0f1e');
    g.addColorStop(1, '#0d1526');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(90, 140, 200, 0.10)';
    ctx.lineWidth = 1;
    for (var i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFood(now) {
    if (!game.food) return;
    var cx = (game.food.x + 0.5) * cell;
    var cy = (game.food.y + 0.5) * cell;
    var pulse = 1 + Math.sin(now / 260) * 0.09;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 92, 122, 0.9)';
    ctx.shadowBlur = cell * 0.9;
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.3 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - cell * 0.08, cy - cell * 0.09, cell * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBonus(now) {
    if (!game.bonus) return;
    var b = game.bonus;
    var cx = (b.x + 0.5) * cell;
    var cy = (b.y + 0.5) * cell;
    var frac = b.ttl / b.max;
    var spin = now / 700;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.shadowColor = 'rgba(255, 205, 90, 0.95)';
    ctx.shadowBlur = cell * 1.1;
    ctx.fillStyle = '#ffcf5a';
    var r = cell * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 205, 90, 0.75)';
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }

  function drawSnake(t) {
    var n = game.body.length;
    for (var i = n - 1; i >= 0; i--) {
      var p = game.renderCell(i, t);
      var cx = (p.x + 0.5) * cell;
      var cy = (p.y + 0.5) * cell;
      var taper = 1 - (i / Math.max(1, n - 1)) * 0.22;
      var s = cell * 1.02 * taper;
      var hue = 186 + (i / Math.max(1, n - 1)) * 34;

      if (i === 0) {
        ctx.save();
        ctx.shadowColor = 'rgba(64, 224, 208, 0.85)';
        ctx.shadowBlur = cell * 1.0;
      }

      ctx.fillStyle = 'hsl(' + hue + ', 85%, ' + (i === 0 ? 68 : 56) + '%)';
      roundRect(cx - s / 2, cy - s / 2, s, s, s * 0.36);
      ctx.fill();

      if (i === 0) {
        ctx.restore();
        // eyes
        var v = Snake.DIRS[game.direction];
        var ex = cx + v.x * cell * 0.16;
        var ey = cy + v.y * cell * 0.16;
        var ox = v.x ? 0 : cell * 0.16;
        var oy = v.y ? 0 : cell * 0.16;
        ctx.fillStyle = '#04121f';
        ctx.beginPath();
        ctx.arc(ex - ox, ey - oy, cell * 0.075, 0, Math.PI * 2);
        ctx.arc(ex + ox, ey + oy, cell * 0.075, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    ctx.save();
    for (var i = 0; i < S.particles.length; i++) {
      var p = S.particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = 'hsl(' + p.hue + ', 90%, 65%)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  function draw(now) {
    ctx.save();
    if (S.shake > 0.05 && !S.reduce) {
      ctx.translate((Math.random() - 0.5) * S.shake * cell * 0.5,
                    (Math.random() - 0.5) * S.shake * cell * 0.5);
    }
    drawGrid();
    drawBonus(now);
    drawFood(now);
    drawSnake(S.phase === 'playing' ? S.t : (S.phase === 'ready' ? 1 : S.t));
    drawParticles();
    drawVignette();
    if (S.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + (S.flash * 0.18) + ')';
      ctx.fillRect(0, 0, size, size);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ game flow */

  function syncHud() {
    elScore.textContent = String(game.score);
    elBest.textContent  = String(S.best);
    elSpeed.textContent = game.speed().toFixed(1);
  }

  function setPhase(phase) {
    S.phase = phase;
    document.body.dataset.state = phase;
    if (phase === 'playing') {
      overlay.classList.remove('is-visible');
    }
  }

  function showOverlay(title, body, hint) {
    ovTitle.textContent = title;
    ovBody.innerHTML = body;
    ovHint.textContent = hint || '';
    overlay.classList.add('is-visible');
  }

  function start() {
    game.reset();
    S.acc = 0;
    S.t = 0;
    S.particles.length = 0;
    S.shake = 0;
    syncHud();
    setPhase('playing');
    Audio2.ensure();
  }

  function gameOver(reason) {
    setPhase('over');
    S.shake = S.reduce ? 0 : 1.4;
    var p = game.body[0];
    spawnBurst((p.x + 0.5) * cell, (p.y + 0.5) * cell, 34, 200, 1.6);
    Audio2.die();

    var isBest = game.score > S.best;
    if (isBest) {
      S.best = game.score;
      try { localStorage.setItem('neon-snake:best', String(S.best)); } catch (e) {}
    }
    syncHud();

    var why = reason === 'wall' ? 'You hit the wall.' : 'You bit yourself.';
    showOverlay(
      isBest ? 'New best!' : 'Game over',
      why + '<br>Score <strong>' + game.score + '</strong> · Best <strong>' + S.best + '</strong>',
      'Press R or tap to play again'
    );
  }

  function handleEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'food') {
      spawnBurst((ev.at.x + 0.5) * cell, (ev.at.y + 0.5) * cell, 10, 340, 1);
      S.flash = 0.55;
      Audio2.eat();
    } else if (ev.type === 'bonus') {
      spawnBurst((ev.at.x + 0.5) * cell, (ev.at.y + 0.5) * cell, 20, 45, 1.3);
      S.flash = 0.8;
      Audio2.bonus();
    } else if (ev.type === 'wall' || ev.type === 'self') {
      gameOver(ev.type);
    }
    syncHud();
  }

  function togglePause() {
    if (S.phase === 'playing') {
      setPhase('paused');
      showOverlay('Paused', 'Take your time.', 'Press Space to resume');
    } else if (S.phase === 'paused') {
      S.last = performance.now();
      setPhase('playing');
    }
  }

  /* ----------------------------------------------------------------- input */

  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right'
  };

  function primaryAction() {
    if (S.phase === 'ready' || S.phase === 'over') start();
    else if (S.phase === 'paused') togglePause();
  }

  window.addEventListener('keydown', function (e) {
    var dir = KEYMAP[e.key];
    if (dir) {
      e.preventDefault();
      if (S.phase === 'ready' || S.phase === 'over') { start(); }
      if (S.phase === 'playing') game.turn(dir);
      return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (S.phase === 'ready' || S.phase === 'over') start();
      else togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      start();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    }
  }, { passive: false });

  // swipe
  var touchStart = null;
  stage.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  stage.addEventListener('pointerup', function (e) {
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x;
    var dy = e.clientY - touchStart.y;
    var dist = Math.hypot(dx, dy);
    touchStart = null;

    if (S.phase !== 'playing') return;   // start/resume is handled by the overlay
    if (dist < 24) { togglePause(); return; }
    if (Math.abs(dx) > Math.abs(dy)) game.turn(dx > 0 ? 'right' : 'left');
    else game.turn(dy > 0 ? 'down' : 'up');
  });

  // on-screen dpad
  Array.prototype.forEach.call(document.querySelectorAll('[data-dir]'), function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (S.phase === 'ready' || S.phase === 'over') start();
      game.turn(btn.getAttribute('data-dir'));
    });
  });

  var overlayTap = function () { primaryAction(); };
  overlay.addEventListener('click', overlayTap);
  document.getElementById('restart').addEventListener('click', function (e) {
    e.stopPropagation();
    start();
  });

  function toggleMute() {
    S.muted = !S.muted;
    try { localStorage.setItem('neon-snake:muted', S.muted ? '1' : '0'); } catch (e) {}
    elMute.textContent = S.muted ? '🔇' : '🔊';
    elMute.setAttribute('aria-pressed', S.muted ? 'true' : 'false');
  }
  elMute.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
  elMute.textContent = S.muted ? '🔇' : '🔊';

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.phase === 'playing') togglePause();
  });

  window.addEventListener('blur', function () {
    if (S.phase === 'playing') togglePause();
  });

  /* ------------------------------------------------------------------ loop */

  function frame(now) {
    var dt = Math.min(now - (S.last || now), 120);
    S.last = now;

    if (S.phase === 'playing') {
      S.acc += dt;
      var stepMs = game.stepMs();
      var guard = 0;
      while (S.acc >= stepMs && guard++ < 8) {
        S.acc -= stepMs;
        handleEvent(game.step());
        if (S.phase !== 'playing') { S.acc = 0; break; }
        stepMs = game.stepMs();
      }
      S.t = S.phase === 'playing' ? Math.min(1, S.acc / stepMs) : 0;
    }

    updateParticles(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ boot */

  resize();
  syncHud();
  setPhase('ready');
  showOverlay('Neon Snake',
    'Eat the apples. Grab the golden shards.<br>Do not run into anything.',
    'Arrows / WASD · swipe · tap to start');
  S.last = performance.now();
  requestAnimationFrame(frame);

  // exposed for the headless smoke test
  window.__neonSnake = { game: game, state: S, start: start };
})();
