// Backdoor synth audio + haptics. No assets, no dependencies. Sets window.SFX.
// The AudioContext is created lazily on SFX.unlock() or the first SFX.play().
window.SFX = (function () {
  'use strict';
  var KEY = 'backdoor.mute', MASTER = 0.35;
  var ctx = null, master = null, amb = null, beat = null;
  var want = null; // last requested ambient state, applied once the context exists
  var muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  function init() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(ctx.destination);
    if (want) applyAmbient(want);
    return true;
  }
  function live() { return ctx && !muted; }

  // One enveloped oscillator. attack defaults to 8 ms (use a long attack for swells).
  function tone(f, dur, type, vol, slideTo, delay, attack) {
    if (!live()) return;
    var t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + Math.min(attack || 0.008, dur * 0.9));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, hp, delay) {
    if (!live()) return;
    var t = ctx.currentTime + (delay || 0);
    var b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = hp || 800;
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.buffer = b; s.connect(f); f.connect(g); g.connect(master);
    s.start(t);
  }
  function seq(freqs, dur, type, vol, step) {
    freqs.forEach(function (f, i) { tone(f, dur, type, vol, null, i * step); });
  }
  function blip(delay) { tone(300 + Math.random() * 900, 0.03, 'square', 0.06, null, delay || 0); }

  // name: [synth(opts), default haptic pattern or null]
  var S = {
    move: [function () { tone(1400, 0.04, 'square', 0.08); }, [8]],
    undo: [function () { tone(900, 0.04, 'square', 0.08); }, null],
    program: [function () { seq([660, 990], 0.05, 'triangle', 0.18, 0.05); }, [15]],
    sniff: [function () { tone(1760, 0.35, 'sine', 0.15, 1600); }, [15]],
    brute: [function () { noise(0.2, 0.3, 3000); seq([220, 110], 0.15, 'sawtooth', 0.25, 0.15); }, [30, 20, 30]],
    noise: [function () { seq([880, 660, 440], 0.09, 'sine', 0.15, 0.07); }, null],
    tick: [function () { tone(2400, 0.015, 'square', 0.04); }, null],
    ping: [function () { tone(1760, 0.35, 'sine', 0.12); }, [10]],
    footstep: [function () { tone(180, 0.03, 'triangle', 0.05); }, null],
    scanHit: [function () { tone(880, 0.25, 'sawtooth', 0.25, 220); noise(0.15, 0.2, 2000); }, [80]],
    bump: [function () { tone(110, 0.18, 'square', 0.35, 55); }, [40, 30, 40]],
    dodge: [function () { tone(660, 0.07, 'triangle', 0.2); tone(990, 0.1, 'triangle', 0.2, null, 0.07); }, [10]],
    honeypot: [function () { tone(70, 0.5, 'sawtooth', 0.4, 40); noise(0.3, 0.3, 300); }, [150]],
    cache: [function () { seq([1320, 1760], 0.045, 'square', 0.12, 0.05); noise(0.03, 0.12, 4000); }, [12, 20, 12]],
    extract: [function () { seq([523, 659, 784, 1047], 0.12, 'triangle', 0.2, 0.08); }, [30, 40, 60]],
    breach: [function () { seq([740, 587, 740, 587], 0.18, 'square', 0.18, 0.2); tone(55, 0.6, 'sawtooth', 0.3, null, 0, 0.45); }, [60, 40, 60]],
    ai: [function () { for (var i = 0; i < 5; i++) blip(i * 0.035); }, null],
    aiType: [function () { blip(0); }, null],
    star: [function (o) { var i = Math.max(0, Math.min(2, (o && o.i) | 0)); tone([523, 659, 784][i], 0.16, 'triangle', 0.2); }, [20]],
    starMiss: [function () { tone(140, 0.12, 'square', 0.18); }, null],
    bandUp: [function () { seq([587, 880], 0.12, 'sawtooth', 0.18, 0.12); }, [60, 40, 60]],
    win: [function () { seq([523, 659, 784, 1047, 1319], 0.14, 'triangle', 0.2, 0.07); }, [30, 40, 30, 40, 80]],
    traced: [function () { tone(880, 0.5, 'square', 0.2, 220); noise(0.6, 0.25, 600, 0.5); }, [100, 50, 100, 50, 300]],
    blip200: [function () { tone(200, 0.06, 'square', 0.12); }, null]
  };

  function haptic(p) {
    if (muted || !p) return;
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }
  function play(name, opts) {
    var s = S[name];
    if (!s) return;
    opts = opts || {};
    if (!muted && init()) {
      if (ctx.state === 'suspended') try { ctx.resume(); } catch (e) {}
      try { s[0](opts); } catch (e) {}
    }
    if (opts.haptic !== false) haptic(s[1]);
  }

  // ---- ambient hum ----
  function osc(type, f, dest) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(); return o; }
  function gain(v, dest) { var g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
  function ramp(param, v) { param.setTargetAtTime(v, ctx.currentTime, 0.5); }
  function build() {
    var out = gain(0, master), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 400; lp.connect(out);
    var hum = gain(1, lp), lfoAmt = gain(0, hum.gain), hi = gain(0, out);
    amb = { out: out, lp: lp, lfoAmt: lfoAmt, hi: hi,
      a: osc('sine', 55, hum), b: osc('sine', 55.4, hum), lfo: osc('sine', 1, lfoAmt), h: osc('sine', 3000, hi) };
  }
  function heartbeat(on) {
    if (on && !beat) {
      var hit = function () { tone(60, 0.1, 'sine', 0.35); tone(60, 0.1, 'sine', 0.25, null, 0.12); };
      hit(); beat = setInterval(hit, 900);
    } else if (!on && beat) { clearInterval(beat); beat = null; }
  }
  function applyAmbient(st) {
    if (!ctx) return;
    if (!amb) build();
    var band = st.band | 0;
    ramp(amb.out.gain, 0.04);
    ramp(amb.b.frequency, band >= 1 ? 56.5 : 55.4);
    ramp(amb.lfoAmt.gain, band >= 2 ? 0.6 : 0);
    ramp(amb.hi.gain, band >= 2 ? 0.008 / 0.04 : 0); // out gain is 0.04, so hi lands at 0.008 absolute
    ramp(amb.lp.frequency, st.breach ? 900 : 400);
    heartbeat(!!st.tracing);
  }
  function ambient(st) {
    st = st || {};
    var flip = !!st.tracing && !(want && want.tracing);
    want = { band: st.band | 0, breach: !!st.breach, tracing: !!st.tracing };
    applyAmbient(want);
    if (flip) haptic([20, 100, 20]);
  }
  function stopAmbient() {
    want = null; heartbeat(false);
    if (amb) ramp(amb.out.gain, 0);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.02);
  }

  return {
    unlock: function () { if (init() && ctx.state === 'suspended') try { ctx.resume(); } catch (e) {} },
    play: play, haptic: haptic, ambient: ambient, stopAmbient: stopAmbient,
    setMuted: setMuted, isMuted: function () { return muted; },
    names: Object.keys(S)
  };
})();
