// Browser smoke test: plays solver-found lines through the real UI on a
// 390 px wide phone viewport and saves screenshots.
// Usage: node tools/smoke.js [outDir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || 'shots';

const LINES = [
  { job: 'job01', name: 'job01-firewall', moves: '>A >B end brute@F end end >F >H end >V extract end >H >F end >B >A end >E', expect: 'EXTRACTED' },
  { job: 'job01', name: 'job01-slip', moves: 'end end >C end >G >H end >V extract end end spoof end end >H end >G >C end >E', expect: 'EXTRACTED' },
  { job: 'job02', name: 'job02-ai', moves: '>R >W trust end >U end end >S spoof end >V extract end >S >U end >W >R end >E', expect: 'EXTRACTED' },
  { job: 'job02', name: 'job02-middle', moves: '>R >W refuse end brute@F >R end >E end >R end >W >F end >S spoof end >V extract end >S >F end >W >R end >E', expect: 'EXTRACTED' },
  { job: 'job02', name: 'job02-right', moves: '>R >P end >Q >T end >H end >S spoof end >V extract end >S >H end >T >Q end >P >R end >E', expect: 'EXTRACTED' },
  { job: 'job02', name: 'job02-left', moves: 'decoy@R >C end >M >A end >K >O end >V extract end >O >K end >A end >M >C end >E', expect: 'EXTRACTED' }
];

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (const line of LINES) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await page.goto('file://' + path.resolve(__dirname, '../index.html'));
    await page.click(`[data-job="${line.job}"]`);
    if (line.name === 'job02-ai') await page.screenshot({ path: `${out}/${line.job}-intro.png`, fullPage: true });
    await page.click('[data-act="start"]');
    let step = 0;
    for (const m of line.moves.split(' ')) {
      step++;
      if (m === 'end') { await page.click('[data-act="end"]'); await page.waitForTimeout(80); }
      else if (m === 'extract') await page.click('[data-act="extract"]');
      else if (m === 'trust' || m === 'refuse') {
        await page.screenshot({ path: `${out}/${line.name}-offer.png`, fullPage: true });
        await page.click(`[data-act="ai-${m}"]`);
      }
      else if (m[0] === '>') await page.click(`[data-node="${m.slice(1)}"]`);
      else { const [p, t] = m.split('@'); await page.click(`[data-prog="${p}"]`); if (t) await page.click(`[data-node="${t}"]`); }
      if (step === 6) await page.screenshot({ path: `${out}/${line.name}-mid.png`, fullPage: true });
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}/${line.name}-end.png`, fullPage: true });
    const head = await page.$eval('.result-head .big', e => e.textContent).catch(() => 'no result screen');
    const ok = !errors.length && (!line.expect || head === line.expect);
    if (!ok) failed = true;
    console.log((ok ? 'ok   ' : 'FAIL ') + line.name + ': ' + head + (errors.length ? ' errors: ' + errors.join(' | ') : ''));
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
