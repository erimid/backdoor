// Browser smoke test: plays recorded witness lines (js/variants.js) through
// the real UI on a 390 px wide phone viewport with ?fast=1, and saves
// screenshots. Per job: variant 0 (canonical) plus 2 other variants.
// Usage: node tools/smoke.js [outDir] [--seed n]
//        node tools/smoke.js --juice [outDir]   (staged-feel checks, no fast mode)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const V = require('../js/variants.js');
const JOBS = require('../js/jobs.js');

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'shots';
const seedArg = args.indexOf('--seed');
let seed = seedArg !== -1 ? +args[seedArg + 1] : 20261116;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
fs.mkdirSync(out, { recursive: true });

// Canonical + 2 other variants per job (different on every seed).
const RUNS = [];
JOBS.forEach((job, ji) => {
  const vs = V[job.id].variants;
  const picks = [0];
  while (picks.length < Math.min(3, vs.length)) {
    const k = 1 + Math.floor(rnd() * (vs.length - 1));
    if (picks.indexOf(k) === -1) picks.push(k);
  }
  picks.forEach(vi => RUNS.push({ job: job.id, ji, vi, id: vs[vi].id, line: vs[vi].witness }));
});

if (args.indexOf('--juice') !== -1) { juice().then(code => process.exit(code)); return; }

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  const url = 'file://' + path.resolve(__dirname, '../index.html') + '?fast=1';
  for (const r of RUNS) {
    const name = `${r.job}-${r.id}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    if (r.vi === 0) await page.screenshot({ path: `${out}/${r.job}-select.png` });
    await page.evaluate(([ji, vi]) => window.__backdoor.startJob(ji, vi), [r.ji, r.vi]);
    let step = 0, breachShot = false, err = null;
    try {
      for (const m of r.line.split(' ')) {
        step++;
        if (m === 'end') await page.click('[data-act="end"]');
        else if (m === 'extract') await page.click('[data-act="extract"]');
        else if (m === 'trust' || m === 'refuse') {
          if (r.vi === 0) await page.screenshot({ path: `${out}/${name}-offer.png` });
          await page.click(`[data-act="ai-${m}"]`, { timeout: 3000 });
        } else if (m[0] === '>') await page.click(`[data-node="${m.slice(1)}"]`, { timeout: 3000 });
        else {
          const [p, t] = m.split('@');
          await page.click(`[data-prog="${p}"]`, { timeout: 3000 });
          if (t) await page.click(`[data-node="${t}"]`, { timeout: 3000 });
        }
        if (step === 3) await page.screenshot({ path: `${out}/${name}-board.png` });
        if (!breachShot && m !== 'extract' && await page.evaluate(() => { const g = window.__backdoor.game(); return g && g.state.breach && g.state.status === 'playing'; })) {
          breachShot = true;
          await page.screenshot({ path: `${out}/${name}-breach.png` });
        }
      }
    } catch (e) { err = 'step ' + step + ': ' + e.message.split('\n')[0]; }
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${name}-end.png`, fullPage: true });
    const head = await page.$eval('.result-head .big', e => e.textContent).catch(() => 'no result screen');
    const ok = !err && !errors.length && head === 'EXTRACTED';
    if (!ok) failed++;
    console.log((ok ? 'ok   ' : 'FAIL ') + name + ' (' + r.line.split(' ').length + ' steps): ' + head +
      (err ? ' | ' + err : '') + (errors.length ? ' | errors: ' + errors.join(' | ') : ''));
    await page.close();
  }
  await browser.close();
  console.log((RUNS.length - failed) + '/' + RUNS.length + ' runs reached EXTRACTED');
  process.exit(failed ? 1 : 0);
})();

// ---------- juice checks (real timings, no ?fast=1) ----------
async function juice() {
  const browser = await chromium.launch();
  const url = 'file://' + path.resolve(__dirname, '../index.html');
  const results = [];
  const check = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? ' (' + info + ')' : '')); };
  async function fresh(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, reducedMotion: opts.rm ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.goto(url);
    // Mark every tip seen so bubbles don't hide what we measure.
    await page.evaluate(() => { localStorage.setItem('backdoor.tips', JSON.stringify({ job01: ['start', 'threatNear', 'adjBarrier', 'hiddenNear', 'banked', 'onTarget', 'breach'], job02: ['start', 'breach'] })); });
    await page.evaluate(([ji, vi]) => window.__backdoor.startJob(ji, vi), [opts.job || 0, 0]);
    await page.waitForTimeout(250);
    return { ctx, page, errors };
  }
  const idle = page => page.waitForFunction(() => !window.__backdoor.busy(), null, { timeout: 10000 });
  async function act(page, m) {
    if (m === 'end') await page.click('[data-act="end"]');
    else if (m === 'extract') await page.click('[data-act="extract"]');
    else if (m[0] === '>') await page.click(`[data-node="${m.slice(1)}"]`);
    await idle(page);
  }
  const overlapCheck = page => page.evaluate(() => {
    const hit = [];
    document.querySelectorAll('#fx .tok-s').forEach(t => {
      const a = t.getBoundingClientRect();
      document.querySelectorAll('#app .node .lbl').forEach(l => {
        const b = l.getBoundingClientRect();
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hit.push(t.dataset.sentry + '/' + l.textContent);
      });
    });
    return hit;
  });

  // 1-2, 6-7: intents hidden during playback, scan hit fx, skip, labels.
  {
    const { ctx, page, errors } = await fresh();
    let labelHits = [];
    labelHits = labelHits.concat(await overlapCheck(page));
    await act(page, '>C');
    await page.click('[data-act="end"]');
    await page.waitForTimeout(30);
    const during = await page.evaluate(() => document.querySelectorAll('.board .intent').length);
    await idle(page);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.querySelectorAll('.board .intent').length);
    check('no intent paths 30 ms after END TURN, they appear after the sequence', during === 0 && after > 0, 'during ' + during + ', after ' + after);
    labelHits = labelHits.concat(await overlapCheck(page));
    await page.screenshot({ path: `${out}/juice-threat.png` });
    // The next phase scans you: watch for the shake class and a "+3" float.
    await page.evaluate(() => {
      window.__seen = { shake: false, plus3: false };
      new MutationObserver(() => {
        if (document.querySelector('.board.shake')) window.__seen.shake = true;
        document.querySelectorAll('#fx .float').forEach(f => { if (f.textContent === '+3') window.__seen.plus3 = true; });
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.click('[data-act="end"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/juice-hit.png` });
    await idle(page);
    const seen = await page.evaluate(() => window.__seen);
    check('a scan hit adds the shake class and a "+3" float', seen.shake && seen.plus3, JSON.stringify(seen));
    labelHits = labelHits.concat(await overlapCheck(page));
    // Tap during playback skips to the final state (and the tap does nothing else).
    await page.waitForTimeout(300);
    const turnBefore = await page.evaluate(() => window.__backdoor.game().state.turn);
    await page.click('[data-act="end"]');
    await page.waitForTimeout(60);
    const busyMid = await page.evaluate(() => window.__backdoor.busy());
    // Tap END TURN again mid-playback: it must only skip, not end another turn.
    await page.click('[data-act="end"]');
    const st = await page.evaluate(() => {
      const g = window.__backdoor.game().state; const u = window.__backdoor.ui;
      const tok = document.querySelector('#fx .tok-s'); const tile = document.querySelector('.node[data-node="' + g.sentries[0].pos + '"]');
      const a = tok.getBoundingClientRect(), b = tile.getBoundingClientRect();
      return { busy: window.__backdoor.busy(), playback: u.playback, intents: document.querySelectorAll('.board .intent').length, overlay: u.overlay,
        tokOk: Math.abs(a.left - (b.right - 14)) < 2 && Math.abs(a.top - (b.top - 14)) < 2, heat: g.heat, hud: +document.querySelector('.h-heat .k b').textContent, turn: g.turn };
    });
    check('a tap during playback skips to the final state', busyMid && !st.busy && !st.playback && st.intents > 0 && st.tokOk && st.hud === st.heat && !st.overlay && st.turn === turnBefore + 1, JSON.stringify(st) + ', turn before ' + turnBefore);
    check('Sentry tokens never overlap node labels', labelHits.length === 0, labelHits.join(', ') || '4 states');
    check('no console errors (run 1)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 3: honeypot clears Undo.
  {
    const { ctx, page, errors } = await fresh();
    for (const m of 'end >C >G end >H'.split(' ')) await act(page, m);
    const undoBefore = await page.$eval('[data-act="undo"]', b => b.disabled);
    await page.click('[data-node="X"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/juice-honeypot.png` });
    await idle(page);
    const undoAfter = await page.$eval('[data-act="undo"]', b => b.disabled);
    check('a honeypot reveal clears Undo (button disabled)', !undoBefore && undoAfter, 'before disabled=' + undoBefore + ', after disabled=' + undoAfter);
    check('no console errors (honeypot)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 4-5: BREACH visuals, chip row.
  {
    const { ctx, page, errors } = await fresh();
    const chips = await page.evaluate(() => {
      const row = document.querySelector('.chips'); const r = row.getBoundingClientRect();
      const bad = [...row.querySelectorAll('.chip')].filter(c => { const b = c.getBoundingClientRect(); return b.left < 0 || b.right > window.innerWidth || b.right > r.right + 0.5 || b.bottom > r.bottom + 0.5; });
      return { bad: bad.length, n: row.children.length, overflow: row.scrollWidth > row.clientWidth };
    });
    check('chip row is not clipped at 390 px', chips.bad === 0 && !chips.overflow && chips.n >= 4, JSON.stringify(chips));
    for (const m of '>C end >G >V end'.split(' ')) await act(page, m);
    await page.click('[data-act="extract"]');
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${out}/juice-breach.png` });
    await idle(page);
    const b = await page.evaluate(() => {
      const g = window.__backdoor.game().state;
      const exit = document.querySelector('.node[data-node="' + g.exit + '"]');
      return { burned: !!document.querySelector('.node.entry.burned .burn-x'), exitGold: exit.classList.contains('live') && getComputedStyle(exit).backgroundColor, breachAttr: document.body.hasAttribute('data-breach'), hunt: document.querySelectorAll('.ipath.hunt').length };
    });
    check('BREACH marks ENTRY burned and the exit gold', b.burned && b.exitGold === 'rgb(255, 209, 102)' && b.breachAttr, JSON.stringify(b));
    check('no console errors (breach)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 8: mute persists.
  {
    const { ctx, page } = await fresh();
    const m0 = await page.evaluate(() => window.SFX.isMuted());
    await page.click('[data-act="mute"]');
    await page.reload();
    await page.evaluate(() => window.__backdoor.startJob(0, 0));
    const m1 = await page.evaluate(() => ({ muted: window.SFX.isMuted(), ls: localStorage.getItem('backdoor.mute'), pressed: document.querySelector('[data-act="mute"]').getAttribute('aria-pressed') }));
    check('mute toggle persists across reloads', !m0 && m1.muted && m1.ls === '1' && m1.pressed === 'true', JSON.stringify(m1));
    await ctx.close();
  }
  // Reduced motion: nothing transforms during hits, BREACH and the win.
  {
    const { ctx, page, errors } = await fresh({ rm: true });
    await page.evaluate(() => {
      window.__tf = [];
      const scan = () => {
        document.querySelectorAll('#app *, #fx *, .toast').forEach(el => {
          const cs = getComputedStyle(el);
          if ((cs.transform !== 'none' || cs.translate !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none') && window.__tf.length < 5) window.__tf.push(el.className.baseVal !== undefined ? el.className.baseVal : el.className);
        });
        requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
    });
    for (const m of '>C end end >G >V end extract >G >C end >D'.split(' ')) {
      if (m === 'extract') await page.click('[data-act="extract"]');
      else if (m === 'end') await page.click('[data-act="end"]');
      else await page.click(`[data-node="${m.slice(1)}"]`);
      await page.waitForTimeout(120);
      await idle(page).catch(() => {});
    }
    await page.waitForTimeout(1600);
    const tf = await page.evaluate(() => window.__tf);
    check('reduced motion: no transforms during a full run', tf.length === 0, tf.join(', ') || 'sampled every frame');
    check('no console errors (reduced motion)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Coaching tips (Job 01, tips not yet seen): the Banked tip only shows on a
  // 3-action turn before you spend any, the Brute tip only when Brute is
  // affordable (2+ actions), and no tip ever covers the warning line.
  {
    const seqs = ['tap >C end tap >G tap >V tap end tap', '>A end tap >B tap >Y tap end', 'tap >A tap >B tap end tap'];
    const bad = []; const seen = { banked: 0, brute: 0 };
    for (const seq of seqs) {
      const { ctx, page, errors } = await fresh();
      await page.evaluate(() => { localStorage.removeItem('backdoor.tips'); window.__backdoor.startJob(0, 0); });
      await page.waitForTimeout(400);
      for (const m of seq.split(' ')) {
        if (m === 'tap') await page.mouse.click(5, 5);
        else await act(page, m);
        await page.waitForTimeout(400);
        const s = await page.evaluate(() => {
          const g = window.__backdoor.game(); const t = document.querySelector('.tipb'); const w = document.querySelector('.warn:not(.empty)');
          const a = t && t.getBoundingClientRect(), b = w && w.getBoundingClientRect();
          return { tip: t ? t.textContent : '', act: g.state.actions, banked: g.state.banked,
            cover: !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) };
        });
        if (/Banked:/.test(s.tip)) { seen.banked++; if (!(s.banked && s.act === 3)) bad.push(seq + ' @' + m + ': Banked tip with ' + s.act + ' actions'); }
        if (/Brute<\/b>|Brute takes/.test(s.tip)) { seen.brute++; if (s.act < 2) bad.push(seq + ' @' + m + ': Brute tip with ' + s.act + ' actions'); }
        if (s.cover) bad.push(seq + ' @' + m + ': tip covers the warning');
      }
      if (errors.length) bad.push('console: ' + errors.join(' | '));
      await ctx.close();
    }
    check('tips: Banked only on a fresh 3-action turn, Brute only with 2+ actions, never over the warning', !bad.length && seen.banked && seen.brute,
      bad.length ? bad.join('; ') : 'banked seen ' + seen.banked + ', brute seen ' + seen.brute);
  }
  // Extract to the freeze offer's buttons (Job 02): short hands-off, and one
  // tap skips straight to the buttons (without pressing one).
  {
    const { ctx, page, errors } = await fresh({ job: 1 });
    const toVault = () => page.evaluate(() => {
      const g = window.__backdoor.game(); g.state.player = 'V'; g.state.sentries[0].pos = 'H'; g.state.sentries[1].pos = 'C';
      window.BackdoorEngine.replan(g); window.__backdoor.render();
    });
    await toVault(); await page.waitForTimeout(200);
    let t0 = Date.now();
    await page.click('[data-act="extract"]');
    await page.waitForSelector('[data-act="ai-trust"]', { timeout: 8000 });
    const handsOff = Date.now() - t0;
    // No deal taken yet, so the terms must not say "another".
    const terms = await page.$eval('.terms', e => e.textContent);
    check('freeze offer with no earlier deal: "takes 25%", not "another"', /takes 25%/.test(terms) && !/another/.test(terms), terms);
    await page.click('[data-act="ai-refuse"]'); await idle(page);
    await page.evaluate(() => window.__backdoor.startJob(1, 0)); await page.waitForTimeout(250);
    await toVault(); await page.waitForTimeout(200);
    t0 = Date.now();
    await page.click('[data-act="extract"]');
    await page.waitForTimeout(150);
    await page.mouse.click(195, 300);
    await page.waitForSelector('[data-act="ai-trust"]', { timeout: 8000 });
    const tapped = Date.now() - t0;
    const pending = await page.evaluate(() => window.__backdoor.game().state.ai.pending);
    check('Extract to the freeze offer buttons: <= 2.8 s hands-off, one tap skips to them', handsOff <= 2800 && tapped <= 800 && pending === 'freeze',
      'hands-off ' + handsOff + ' ms, one tap ' + tapped + ' ms, still pending: ' + pending);
    // Mashing through Extract must not answer the offer: three more taps
    // 250 ms apart land on the Trust button's spot and are all eaten, then a
    // deliberate tap after a pause answers it.
    await page.click('[data-act="ai-refuse"]'); await idle(page);
    await page.evaluate(() => window.__backdoor.startJob(1, 0)); await page.waitForTimeout(250);
    await toVault(); await page.waitForTimeout(200);
    await page.click('[data-act="extract"]');
    await page.waitForTimeout(300);
    const tb = await (async () => { await page.mouse.click(195, 300); await page.waitForSelector('[data-act="ai-trust"]', { timeout: 8000 }); return page.$eval('[data-act="ai-trust"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); })();
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(250); await page.mouse.click(tb.x, tb.y); }
    await page.waitForTimeout(150);
    const mashed = await page.evaluate(() => window.__backdoor.game().state.ai.pending);
    await page.waitForTimeout(500);
    await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(200);
    const answered = await page.evaluate(() => window.__backdoor.game().state.ai.answers.freeze);
    check('mashing through Extract never answers the freeze offer; a deliberate tap does', mashed === 'freeze' && answered === 'trusted',
      'after mash pending: ' + mashed + ', after a deliberate tap: ' + answered);
    check('no console errors (freeze offer)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  const bad = results.filter(r => !r.ok).length;
  console.log((results.length - bad) + '/' + results.length + ' juice checks passed');
  return bad ? 1 : 0;
}
