#!/usr/bin/env node
// Headless check for js/sfx.js: every sound plays without errors, haptics fire,
// mute persists and silences both audio and vibration, and no AudioContext
// exists before unlock()/play(). Usage: node tools/sfx-check.js  (exit 1 on failure)
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const SFX_PATH = path.join(__dirname, '..', 'js', 'sfx.js');
const REQUIRED = ['move', 'undo', 'program', 'sniff', 'brute', 'noise', 'tick', 'ping', 'footstep',
  'scanHit', 'bump', 'dodge', 'honeypot', 'cache', 'extract', 'breach', 'ai', 'aiType', 'star',
  'starMiss', 'bandUp', 'win', 'traced', 'blip200'];
const WITH_HAPTIC = ['move', 'program', 'sniff', 'brute', 'ping', 'scanHit', 'bump', 'dodge',
  'honeypot', 'cache', 'extract', 'breach', 'star', 'bandUp', 'win', 'traced'];
const ORIGIN = 'http://sfx-check.test/'; // fake origin so localStorage works (about:blank has none)

let failures = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures++; }

// Instrument before sfx.js loads: count AudioContexts and sources, record vibrate calls.
function instrument() {
  window.__vib = []; window.__ctx = 0; window.__src = 0;
  Object.defineProperty(Navigator.prototype, 'vibrate', {
    configurable: true, value: function (p) { window.__vib.push(p); return true; } });
  const AC = window.AudioContext;
  window.AudioContext = function () { window.__ctx++; return new AC(); };
  for (const m of ['createOscillator', 'createBufferSource']) {
    const orig = AC.prototype[m];
    AC.prototype[m] = function () { window.__src++; return orig.apply(this, arguments); };
  }
}

async function newPage(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(ORIGIN + '**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>sfx</title>' }));
  await page.goto(url);
  await page.evaluate(instrument);
  await page.addScriptTag({ path: SFX_PATH });
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- 1. about:blank: every sound, haptics, ambient ----
    console.log('about:blank');
    let { page, errors } = await newPage(browser, 'about:blank');
    const names = await page.evaluate(() => SFX.names);
    for (const n of REQUIRED) check(names.includes(n), `SFX.names has "${n}"`);
    check(await page.evaluate(() => window.__ctx) === 0, 'no AudioContext before unlock()');
    await page.evaluate(() => SFX.play('nope'));
    check(await page.evaluate(() => window.__ctx) === 0, 'unknown name is a no-op (no context)');
    await page.evaluate(() => SFX.unlock());
    check(await page.evaluate(() => window.__ctx) === 1, 'unlock() creates exactly one AudioContext');

    for (const n of names) {
      const r = await page.evaluate(n => {
        window.__vib = []; const s0 = window.__src;
        SFX.play(n, { i: 1 });
        return { vib: window.__vib.slice(), src: window.__src - s0 };
      }, n);
      check(r.src > 0, `${n}: synthesized ${r.src} source(s)`);
      if (WITH_HAPTIC.includes(n)) check(r.vib.length === 1, `${n}: vibrate ${JSON.stringify(r.vib[0])}`);
      else check(r.vib.length === 0, `${n}: no haptic`);
    }
    for (const i of [0, 1, 2, 7]) await page.evaluate(i => SFX.play('star', { i }), i);
    const noHap = await page.evaluate(() => { window.__vib = []; SFX.play('bump', { haptic: false }); return window.__vib.length; });
    check(noHap === 0, 'opts.haptic === false suppresses vibrate');

    const amb = await page.evaluate(async () => {
      window.__vib = [];
      SFX.ambient({ band: 0 }); SFX.ambient({ band: 0 }); SFX.ambient({ band: 1 });
      SFX.ambient({ band: 2, breach: true });
      SFX.ambient({ band: 2, breach: true, tracing: true });
      SFX.ambient({ band: 2, breach: true, tracing: true });
      const s0 = window.__src;
      await new Promise(r => setTimeout(r, 1000));
      const beats = window.__src - s0;
      SFX.ambient({ band: 1, tracing: false }); SFX.stopAmbient(); SFX.stopAmbient();
      return { vib: window.__vib, beats };
    });
    check(amb.vib.length === 1 && JSON.stringify(amb.vib[0]) === '[20,100,20]', `tracing flip vibrates once (${JSON.stringify(amb.vib)})`);
    check(amb.beats >= 2, `heartbeat schedules hits while tracing (${amb.beats} in 1 s)`);

    const muted = await page.evaluate(() => {
      SFX.setMuted(true); window.__vib = []; const s0 = window.__src;
      SFX.ambient({ band: 2, tracing: true });
      SFX.names.forEach(n => SFX.play(n)); SFX.haptic([50]);
      return { m: SFX.isMuted(), vib: window.__vib.length, src: window.__src - s0 };
    });
    check(muted.m === true, 'isMuted() after setMuted(true)');
    check(muted.vib === 0, `no vibrate while muted (${muted.vib})`);
    check(muted.src === 0, `no sounds synthesized while muted (${muted.src})`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();

    // ---- 2. persistence across reload on a real origin ----
    console.log(ORIGIN);
    ({ page, errors } = await newPage(browser, ORIGIN));
    check(await page.evaluate(() => SFX.isMuted()) === false, 'starts unmuted with empty storage');
    await page.evaluate(() => SFX.setMuted(true));
    await page.reload();
    await page.evaluate(instrument);
    await page.addScriptTag({ path: SFX_PATH });
    const after = await page.evaluate(() => {
      const m = SFX.isMuted(); SFX.play('bump'); SFX.play('win');
      return { m, ls: localStorage.getItem('backdoor.mute'), vib: window.__vib.length, src: window.__src, ctx: window.__ctx };
    });
    check(after.m === true && after.ls === '1', 'mute persists across reload (backdoor.mute=1)');
    check(after.vib === 0 && after.src === 0, 'muted after reload: no vibrate, no audio');
    check(after.ctx === 0, 'muted play() does not create an AudioContext');
    const un = await page.evaluate(() => { SFX.setMuted(false); window.__vib = []; SFX.play('bump');
      return { ls: localStorage.getItem('backdoor.mute'), vib: window.__vib.length, ctx: window.__ctx, src: window.__src }; });
    check(un.ls === '0' && un.vib === 1 && un.ctx === 1 && un.src > 0, 'unmute: first play() creates context, sound + vibrate');
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally { await browser.close(); }
  console.log(failures ? `\nsfx-check: ${failures} FAILURE(S)` : '\nsfx-check: all passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
