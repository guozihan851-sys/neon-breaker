/* =========================================================
   audio.js — 纯 WebAudio 合成音效（无外部音频文件）
   ========================================================= */
(function (global) {
  'use strict';

  function Sfx() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.ready = false;
  }

  /** 首次用户交互时创建 AudioContext（浏览器自动播放策略要求） */
  Sfx.prototype.init = function () {
    if (this.ready) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // 轻微的总线压缩 + 混响感，让合成音更"街机"
      var comp = this.ctx.createDynamicsCompressor ? this.ctx.createDynamicsCompressor() : null;
      if (comp) {
        comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 6;
        comp.attack.value = 0.003; comp.release.value = 0.18;
        this.master.connect(comp); comp.connect(this.ctx.destination);
      } else {
        this.master.connect(this.ctx.destination);
      }
      this.ready = true;
    } catch (e) { this.ready = false; }
  };

  Sfx.prototype.setMuted = function (m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  };

  /** 基础发声：osc -> gain 包络 -> master */
  Sfx.prototype.tone = function (opt) {
    if (!this.ready || this.muted) return;
    var c = this.ctx, t0 = c.currentTime + (opt.delay || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = opt.type || 'square';
    var f0 = opt.freq, f1 = (opt.to == null) ? opt.freq : opt.to;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + (opt.dur || 0.12));
    var vol = (opt.vol == null) ? 0.22 : opt.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opt.atk || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (opt.dur || 0.12));
    var node = osc;
    if (opt.filter) {
      var bp = c.createBiquadFilter();
      bp.type = 'lowpass'; bp.frequency.value = opt.filter;
      osc.connect(bp); node = bp;
    }
    node.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + (opt.dur || 0.12) + 0.05);
  };

  /** 噪声：用于爆炸/碎裂 */
  Sfx.prototype.noise = function (opt) {
    if (!this.ready || this.muted) return;
    opt = opt || {};
    var c = this.ctx, t0 = c.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.24;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = opt.type || 'bandpass';
    bp.frequency.setValueAtTime(opt.freq || 1400, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, (opt.to || 300)), t0 + dur);
    bp.Q.value = opt.q == null ? 1.1 : opt.q;
    var g = c.createGain();
    g.gain.setValueAtTime(opt.vol == null ? 0.3 : opt.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  };

  /* ---------- 游戏事件音效 ---------- */
  Sfx.prototype.paddle = function () {
    this.tone({ type: 'triangle', freq: 320, to: 520, dur: 0.09, vol: 0.2 });
  };
  Sfx.prototype.wall = function () {
    this.tone({ type: 'square', freq: 240, to: 200, dur: 0.05, vol: 0.1 });
  };
  Sfx.prototype.brick = function (hp) {
    var base = 520 + (hp || 1) * 90;
    this.tone({ type: 'square', freq: base, to: base * 1.5, dur: 0.07, vol: 0.15 });
    this.noise({ freq: 2600, to: 900, dur: 0.09, vol: 0.13, q: 0.9 });
  };
  Sfx.prototype.breakBrick = function (combo) {
    var step = Math.min(combo || 0, 14);
    var f = 440 * Math.pow(2, step / 12);
    this.tone({ type: 'square', freq: f, to: f * 1.35, dur: 0.1, vol: 0.16 });
    this.tone({ type: 'sine', freq: f * 2, to: f * 2.4, dur: 0.14, vol: 0.1, delay: 0.01 });
    this.noise({ freq: 3200, to: 600, dur: 0.18, vol: 0.2 });
  };
  Sfx.prototype.explode = function () {
    this.noise({ type: 'lowpass', freq: 900, to: 90, dur: 0.45, vol: 0.42, q: 0.6 });
    this.tone({ type: 'sawtooth', freq: 150, to: 40, dur: 0.34, vol: 0.2, filter: 900 });
  };
  Sfx.prototype.powerup = function () {
    var notes = [523, 659, 784, 1046];
    for (var i = 0; i < notes.length; i++) {
      this.tone({ type: 'triangle', freq: notes[i], dur: 0.12, vol: 0.16, delay: i * 0.055 });
    }
  };
  Sfx.prototype.laser = function () {
    this.tone({ type: 'sawtooth', freq: 1200, to: 260, dur: 0.1, vol: 0.12, filter: 3200 });
    this.noise({ freq: 4200, to: 1200, dur: 0.07, vol: 0.07 });
  };
  Sfx.prototype.launch = function () {
    this.tone({ type: 'sine', freq: 300, to: 900, dur: 0.16, vol: 0.18 });
  };
  Sfx.prototype.loseLife = function () {
    this.tone({ type: 'sawtooth', freq: 420, to: 70, dur: 0.6, vol: 0.26, filter: 1400 });
    this.noise({ type: 'lowpass', freq: 700, to: 120, dur: 0.5, vol: 0.24 });
  };
  Sfx.prototype.shield = function () {
    this.tone({ type: 'sine', freq: 180, to: 700, dur: 0.24, vol: 0.22 });
    this.noise({ freq: 1800, to: 500, dur: 0.22, vol: 0.16 });
  };
  Sfx.prototype.levelUp = function () {
    var seq = [523, 659, 784, 1046, 1318];
    for (var i = 0; i < seq.length; i++) {
      this.tone({ type: 'square', freq: seq[i], dur: 0.16, vol: 0.15, delay: i * 0.085 });
      this.tone({ type: 'triangle', freq: seq[i] / 2, dur: 0.2, vol: 0.1, delay: i * 0.085 });
    }
  };
  Sfx.prototype.gameOver = function () {
    var seq = [440, 370, 294, 220, 165];
    for (var i = 0; i < seq.length; i++) {
      this.tone({ type: 'sawtooth', freq: seq[i], to: seq[i] * 0.94, dur: 0.42, vol: 0.2, delay: i * 0.17, filter: 1600 });
    }
  };
  Sfx.prototype.ui = function () {
    this.tone({ type: 'square', freq: 760, to: 1080, dur: 0.05, vol: 0.1 });
  };

  global.Sfx = Sfx;
})(window);