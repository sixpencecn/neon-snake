/*!
 * neon-snake — game.js
 * Pure simulation. No DOM, no timers, no rendering assumptions.
 * Deterministic when a seed is provided, which is what makes it testable.
 * Copyright (c) 2026 sixpencecn — MIT
 */
(function (root) {
  'use strict';

  var VECTORS = {
    up:    { x: 0,  y: -1 },
    down:  { x: 0,  y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1,  y: 0 }
  };

  var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  /** Small, fast, seedable PRNG (mulberry32). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * @param {object} [opts]
   * @param {number} [opts.cols=24]
   * @param {number} [opts.rows=24]
   * @param {number} [opts.seed]      deterministic RNG seed
   * @param {number} [opts.bonusEvery=5]  spawn a bonus every N apples
   * @param {number} [opts.bonusTtlSteps=26]
   */
  function Snake(opts) {
    opts = opts || {};
    this.cols = opts.cols || 24;
    this.rows = opts.rows || 24;
    this.seed = opts.seed;
    this.bonusEvery = opts.bonusEvery || 5;
    this.bonusTtlSteps = opts.bonusTtlSteps || 26;
    this.reset();
  }

  Snake.prototype.reset = function () {
    this.rng = mulberry32(this.seed != null ? this.seed : (Math.random() * 4294967296) >>> 0);
    var cx = Math.floor(this.cols / 2);
    var cy = Math.floor(this.rows / 2);

    this.body = [
      { x: cx,     y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy }
    ];
    this.previous = this.cloneCells(this.body);
    this.direction = 'right';
    this.pending = [];
    this.score = 0;
    this.apples = 0;
    this.alive = true;
    this.won = false;
    this.bonus = null;
    this.food = null;
    this.food = this.spawnFood();
    return this;
  };

  Snake.prototype.cloneCells = function (cells) {
    var out = new Array(cells.length);
    for (var i = 0; i < cells.length; i++) out[i] = { x: cells[i].x, y: cells[i].y };
    return out;
  };

  Snake.prototype.freeCells = function () {
    var taken = new Set();
    var i;
    for (i = 0; i < this.body.length; i++) taken.add(this.body[i].y * this.cols + this.body[i].x);
    if (this.food)  taken.add(this.food.y * this.cols + this.food.x);
    if (this.bonus) taken.add(this.bonus.y * this.cols + this.bonus.x);

    var free = [];
    for (var y = 0; y < this.rows; y++) {
      for (var x = 0; x < this.cols; x++) {
        if (!taken.has(y * this.cols + x)) free.push({ x: x, y: y });
      }
    }
    return free;
  };

  Snake.prototype.spawnFood = function () {
    var free = this.freeCells();
    if (!free.length) { this.won = true; return null; }
    return free[Math.floor(this.rng() * free.length)];
  };

  /** Queue a turn. Rejects reversals and duplicate directions. Buffers 2 deep. */
  Snake.prototype.turn = function (name) {
    if (!VECTORS[name]) return false;
    var last = this.pending.length ? this.pending[this.pending.length - 1] : this.direction;
    if (name === last) return false;
    if (name === OPPOSITE[last]) return false;
    if (this.pending.length >= 2) return false;
    this.pending.push(name);
    return true;
  };

  /** Milliseconds per cell — tightens as the snake grows, floored. */
  Snake.prototype.stepMs = function () {
    var progress = Math.min(1, (this.body.length - 3) / 26);
    return Math.round(140 - 78 * progress);
  };

  /** Cells per second, for the HUD. */
  Snake.prototype.speed = function () {
    return Math.round(1000 / this.stepMs() * 10) / 10;
  };

  /**
   * Advance one cell.
   * @returns {{type: 'food'|'bonus'|'wall'|'self'|null, score: number, at?: {x:number,y:number}}}
   */
  Snake.prototype.step = function () {
    if (!this.alive) return { type: null, score: this.score };

    if (this.pending.length) this.direction = this.pending.shift();
    var v = VECTORS[this.direction];
    var head = this.body[0];
    var next = { x: head.x + v.x, y: head.y + v.y };

    if (next.x < 0 || next.y < 0 || next.x >= this.cols || next.y >= this.rows) {
      this.alive = false;
      return { type: 'wall', score: this.score, at: { x: head.x, y: head.y } };
    }

    var eatsFood  = !!(this.food  && next.x === this.food.x  && next.y === this.food.y);
    var eatsBonus = !!(this.bonus && next.x === this.bonus.x && next.y === this.bonus.y);
    var grows = eatsFood || eatsBonus;

    // The tail cell is only solid when the snake is not growing this step.
    var solid = grows ? this.body.length : this.body.length - 1;
    for (var i = 0; i < solid; i++) {
      if (this.body[i].x === next.x && this.body[i].y === next.y) {
        this.alive = false;
        return { type: 'self', score: this.score, at: { x: next.x, y: next.y } };
      }
    }

    this.previous = this.cloneCells(this.body);
    this.body.unshift(next);

    var event = { type: null, score: this.score };

    if (eatsFood) {
      this.score += 1;
      this.apples += 1;
      event = { type: 'food', score: this.score, at: { x: next.x, y: next.y } };
      this.food = this.spawnFood();
      if (this.apples % this.bonusEvery === 0 && !this.bonus) {
        var free = this.freeCells();
        if (free.length) {
          var cell = free[Math.floor(this.rng() * free.length)];
          this.bonus = { x: cell.x, y: cell.y, ttl: this.bonusTtlSteps, max: this.bonusTtlSteps };
        }
      }
    } else if (eatsBonus) {
      this.score += 5;
      this.bonus = null;
      event = { type: 'bonus', score: this.score, at: { x: next.x, y: next.y } };
    } else {
      this.body.pop();
    }

    if (this.bonus) {
      this.bonus.ttl -= 1;
      if (this.bonus.ttl <= 0) this.bonus = null;
    }

    return event;
  };

  /**
   * Interpolated cell centre for segment `index`, for rendering between steps.
   * @param {number} index
   * @param {number} t 0..1 progress of the current step
   */
  Snake.prototype.renderCell = function (index, t) {
    var to = this.body[index];
    var from = this.previous[Math.min(index, this.previous.length - 1)] || to;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t
    };
  };

  Snake.DIRS = VECTORS;
  Snake.mulberry32 = mulberry32;

  if (typeof module === 'object' && module.exports) module.exports = Snake;
  root.Snake = Snake;
})(typeof window !== 'undefined' ? window : this);
