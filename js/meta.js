/*
 * Backdoor meta screens (v2): job board, compact briefing, results payoff,
 * seeded nights and the playtest store. Every non-board screen lives here as
 * an HTML string; ui.js routes to them and passes unknown data-act values to
 * Meta.onAct. Reads engine data only through BackdoorEngine (passed to init).
 *
 * Works in Node too (no DOM at load time) so the pure parts can be tested.
 */
(function (root) {
  var STORE_KEY = 'backdoor.proto.v2';
  var V1_KEY = 'backdoor.proto.v1';
  var CSV_COLS = ['when', 'job', 'variant', 'par', 'won', 'reason', 'stars', 'payout', 'heat', 'turns',
    'route', 'programs', 'deals', 'ai', 'again', 'note', 'close'];
  var T = { type: 30, line: 250, tween: 220, total: 420, star: 350, gap: 300 };

  var E = null, JOBS = [], iconFn = null, sfx = null;
  var store = null;
  var mem = {};                 // storage fallback (Node, blocked storage)
  var cur = null;               // {jobId, pick} shown on the briefing
  var last = null;              // {run, pick} of the most recent finish()
  var shown = null;             // run currently on the result screen
  var played = {};              // run ids whose reveal already ran
  var confirmClear = false;
  var anim = null;              // running reveal {timers, root, finish}

  // ---------- storage ----------

  function lsGet(k) {
    try { if (root.localStorage) return root.localStorage.getItem(k); } catch (e) { /* blocked */ }
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
  }
  function lsSet(k, v) {
    try { if (root.localStorage) { root.localStorage.setItem(k, v); return; } } catch (e) { /* blocked */ }
    mem[k] = v;
  }
  function blank() { return { best: {}, wins: {}, lastPick: {}, runs: [], migrated: false }; }
  function load() {
    var s = null;
    try { s = JSON.parse(lsGet(STORE_KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = blank();
    ['best', 'wins', 'lastPick'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
    if (!Array.isArray(s.runs)) s.runs = [];
    if (!s.migrated) {
      // One-time import of v1 playtest runs. v1 wins don't count toward v2 unlocks.
      try {
        var old = JSON.parse(lsGet(V1_KEY));
        if (old && Array.isArray(old.runs)) {
          old.runs.forEach(function (r) {
            s.runs.push({
              id: r.id || 0, when: r.when || '', job: r.job, variant: 'v1', par: '', won: !!r.won, reason: r.reason || '',
              stars: r.stars || 0, payout: '', payoutLines: [], heat: r.heat, turns: r.turns, route: r.route || '',
              programs: r.programs || [], deals: '', ai: r.ai || '', again: r.again === undefined ? null : r.again,
              note: r.note || '', close: null, v1: true
            });
          });
        }
      } catch (e) { /* ignore */ }
      s.migrated = true;
      store = s; save();
    }
    return s;
  }
  function save() { try { lsSet(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function icon(name, size) { return iconFn ? iconFn(name, size) : ''; }
  function jobById(id) { for (var i = 0; i < JOBS.length; i++) if (JOBS[i].id === id) return JOBS[i]; return null; }
  function nodeLabel(job, id) { var d = E && E.nodeDef ? E.nodeDef(job, id) : null; return d ? d.label : id; }
  function money(n, signed) {
    var a = Math.abs(Math.round(n));
    if (n < 0) return '−$' + a;
    return (signed && n > 0 ? '+$' : '$') + a;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function fast() { return !!root.__backdoorFast; }
  function reduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function play(name, opts) { if (sfx && !fast()) try { sfx.play(name, opts); } catch (e) { /* ignore */ } }
  function compressPath(path) {
    var out = [];
    (path || []).forEach(function (n) { if (out[out.length - 1] !== n) out.push(n); });
    return out;
  }
  function starIcons(n, size) {
    var out = '<span class="stars" aria-label="' + n + ' of 3 stars">';
    for (var i = 0; i < 3; i++) out += '<span class="' + (i < n ? 'on' : '') + '">' + icon('star', size || 14) + '</span>';
    return out + '</span>';
  }

  // ---------- seeded nights ----------

  function hashStr(str) { // FNV-1a, 32 bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateKey(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
  function tonightIndex(jobId, n, d) {
    if (n <= 1) return 0;
    return Math.floor(mulberry32(hashStr(dateKey(d || new Date()) + jobId))() * n) % n;
  }

  // WP3's table, or a canonical-only fallback when js/variants.js is missing.
  function table(jobId) {
    var V = root.BACKDOOR_VARIANTS;
    var t = V && V[jobId];
    if (t && Array.isArray(t.variants) && t.variants.length) {
      var job = jobById(jobId);
      return { par: t.par || (job && job.payout && job.payout.par) || 0, variants: t.variants };
    }
    var j = jobById(jobId);
    if (!j) return { par: 0, variants: [] };
    return { par: (j.payout && j.payout.par) || 0, variants: [E.canonicalVariant(j)] };
  }

  function labelFor(jobId, index, d) {
    var wins = store.wins[jobId] || 0;
    if (!wins && index === 0) return jobId === 'job01' ? 'Tutorial night' : 'First night';
    var n = table(jobId).variants.length;
    d = d || new Date();
    if (index === tonightIndex(jobId, n, d)) return 'Night ' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' · #' + pad2(index);
    return 'Random night · #' + pad2(index);
  }

  function choose(jobId, mode, d) {
    var t = table(jobId); var n = t.variants.length;
    if (!n) return 0;
    var lastIdx = store.lastPick[jobId];
    if (typeof lastIdx !== 'number' || lastIdx < 0 || lastIdx >= n) lastIdx = null;
    if (!(store.wins[jobId] > 0)) return 0; // first-ever runs are canonical
    if (mode === 'canonical') return 0;
    if (mode === 'same') return lastIdx !== null ? lastIdx : tonightIndex(jobId, n, d);
    if (mode === 'new') {
      if (n === 1) return 0;
      var avoid = lastIdx !== null ? lastIdx : tonightIndex(jobId, n, d);
      var k = Math.floor(Math.random() * (n - 1));
      return k >= avoid ? k + 1 : k;
    }
    return tonightIndex(jobId, n, d);
  }

  // mode: tonight | new | canonical | same. `date` is optional (tests).
  function pick(jobId, mode, date) {
    var d = date || new Date();
    var t = table(jobId);
    var index = choose(jobId, mode || 'tonight', d);
    store.lastPick[jobId] = index;
    save();
    return { jobId: jobId, index: index, variant: t.variants[index], par: t.par, label: labelFor(jobId, index, d) };
  }

  // ---------- run record ----------

  function targetOf(job) {
    for (var i = 0; i < job.nodes.length; i++) if (job.nodes[i].type === 'target') return job.nodes[i].id;
    return null;
  }
  function hops(game, from, to) {
    if (!from || !to) return null;
    if (from === to) return 0;
    var dist = {}; dist[from] = 0; var q = [from];
    while (q.length) {
      var x = q.shift();
      var ns = E.neighbors(game, x) || [];
      for (var i = 0; i < ns.length; i++) {
        if (dist[ns[i]] !== undefined) continue;
        dist[ns[i]] = dist[x] + 1;
        if (ns[i] === to) return dist[ns[i]];
        q.push(ns[i]);
      }
    }
    return null;
  }

  function firstSeen(game, extra) {
    if (extra && extra.firstSeen) return extra.firstSeen;
    if (game.metaSeen) return game.metaSeen;
    var log = (game.state && game.state.log) || [];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.kind === 'heat' && (e.cause === 'scan' || e.cause === 'bump')) return { sentry: e.sentry, turn: null, kind: e.cause };
    }
    return game.state && game.state.detected ? { sentry: null, turn: null, kind: 'scan' } : null;
  }

  // The "so close" analysis. Pure: reads the finished game only.
  function closeInfo(game, extra) {
    var st = game.state, job = game.job;
    var won = st.status === 'won';
    var dest = st.hasData ? (st.exit || (job.exits && job.exits[job.exitIndex || 0])) : targetOf(job);
    var n = won ? 0 : hops(game, st.player, dest);
    var lastHeat = null;
    var log = st.log || [];
    for (var i = log.length - 1; i >= 0; i--) if (log[i].kind === 'heat') { lastHeat = log[i]; break; }
    var info = {
      hops: n, to: dest, toLabel: dest ? nodeLabel(job, dest) : '', hasData: !!st.hasData,
      heat: st.heat, heatMax: E.HEAT_MAX || 10, cause: lastHeat ? lastHeat.cause : null,
      seen: firstSeen(game, extra), text: ''
    };
    if (won) return info;
    var where;
    var dl = st.hasData ? 'the exit' : info.toLabel;
    if (n === 0) where = st.hasData ? 'You were on the exit with the data.' : 'You were standing on ' + dl + '.';
    else if (n === null) where = '';
    else if (st.reason === 'dropped') where = 'Out of time ' + plural(n, 'hop') + ' from ' + dl + (st.hasData ? ' with the data.' : '.');
    else if (st.reason === 'aborted') where = 'You pulled out ' + plural(n, 'hop') + ' from ' + dl + (st.hasData ? ' with the data.' : '.');
    else where = 'You were ' + plural(n, 'hop') + ' from ' + dl + (st.hasData ? ' with the data.' : '.');
    var why = '';
    if (st.reason === 'traced') {
      why = {
        scan: 'One less scan and you walk.',
        bump: 'One less bump and you walk.',
        honeypot: 'Skip that honeypot and you walk.',
        trace: 'One turn faster and you walk.',
        brute: 'One less Brute and you walk.',
        extract: 'One less slip and you walk.'
      }[info.cause] || 'One less slip and you walk.';
    } else if (st.reason === 'dropped' && n === 0 && !st.hasData) {
      why = 'Extract next time.';
    }
    info.text = [where, why].filter(Boolean).join(' ');
    return info;
  }

  function aiSummary(st, answers) {
    if (!st.ai) return '';
    var a = answers || st.ai.answers || {};
    var keys = Object.keys(a);
    if (!keys.length) return 'not met';
    return keys.map(function (k) { return k + ':' + a[k]; }).join(' ');
  }

  function aiLine(job, st, won) {
    if (!won) return '';
    if (!job.ai) return job.id === 'job01' ? 'not bad. see you soon.' : '';
    var a = st.ai || {};
    var vals = Object.keys(a.answers || {}).map(function (k) { return a.answers[k]; });
    if (a.deals > 0 || a.trusted) return job.ai.trustedLine;
    if (a.refused || vals.indexOf('refused') !== -1) return job.ai.refusedLine;
    return job.ai.ignoredLine;
  }

  function finish(game, pk, extra) {
    extra = extra || {};
    var st = game.state, job = game.job;
    var jobId = job.id;
    pk = pk || { jobId: jobId, index: 0, variant: { id: job.variantId || 'v00' }, par: E.payout(game).par, label: '' };
    var won = st.status === 'won';
    var p = E.payout(game);
    var s = E.stars(game);
    var prev = store.best[jobId] || null;
    var total = won ? p.total : 0;
    var run = {
      id: Date.now(),
      when: new Date().toISOString(),
      job: jobId,
      variant: (pk.variant && pk.variant.id) || job.variantId || ('#' + pk.index),
      vindex: pk.index,
      label: pk.label || '',
      par: p.par || pk.par || 0,
      won: won,
      reason: won ? 'escaped' : (st.reason || 'lost'),
      stars: s.count,
      starFlags: { escaped: !!s.escaped, par: !!s.par, bonus: !!s.bonus },
      bonus: job.bonus ? { id: job.bonus.id, text: job.bonus.text } : null,
      payout: total,
      payoutLines: p.lines.map(function (l) { return { id: l.id, label: l.label, amount: l.amount }; }),
      heat: st.heat,
      turns: st.turn,
      turnLimit: job.turnLimit,
      route: compressPath(st.path).map(function (n) { return nodeLabel(job, n); }).join(' > '),
      programs: (st.programsUsed || []).slice(),
      deals: extra.deals !== undefined ? extra.deals : (st.ai ? st.ai.deals : 0),
      ai: aiSummary(st, extra.aiAnswers),
      aiLine: aiLine(job, st, won),
      coachSeen: extra.coachSeen || null,
      prevBest: prev && typeof prev.payout === 'number' ? prev.payout : null,
      again: null,
      note: '',
      close: closeInfo(game, extra)
    };
    run.newBest = won && (run.prevBest === null || total > run.prevBest);
    store.runs.push(run);
    if (won) {
      store.wins[jobId] = (store.wins[jobId] || 0) + 1;
      var b = store.best[jobId] || { stars: 0, payout: 0 };
      store.best[jobId] = { stars: Math.max(b.stars || 0, s.count), payout: Math.max(b.payout || 0, total) };
    }
    store.lastPick[jobId] = pk.index;
    save();
    last = { run: run, pick: pk };
    return run;
  }

  // ---------- mute (every screen has one: results play sounds too) ----------

  var SPK_ON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var SPK_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  function muteBtn(cls) {
    var S = root.SFX;
    if (!S || !S.isMuted) return '';
    var m = S.isMuted();
    return '<button class="icon-btn sm' + (cls ? ' ' + cls : '') + '" data-act="mute" aria-label="' + (m ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off') +
      '" aria-pressed="' + (m ? 'true' : 'false') + '">' + (m ? SPK_OFF : SPK_ON) + '</button>';
  }

  // ---------- job board ----------

  function renderSelect() {
    var h = '<div class="screen mscreen meta-select">' + muteBtn('m-mute');
    h += '<div class="brand"><div class="logo">BACK<span>DOOR</span></div><div class="sub">HACKING MINIGAME · PROTOTYPE</div></div>';
    h += '<div class="kicker">Job board</div>';
    JOBS.forEach(function (job, i) {
      var best = store.best[job.id] || null;
      var wins = store.wins[job.id] || 0;
      var n = table(job.id).variants.length;
      var tonight = wins ? tonightIndex(job.id, n) : 0;
      var prevJob = JOBS[i - 1];
      var hint = prevJob && !(store.wins[prevJob.id] > 0) ? '<div class="m-hint">Clear Job ' + prevJob.number + ' first?</div>' : '';
      h += '<div class="card m-job" data-jobcard="' + job.id + '">' +
        '<div class="m-row"><span class="kicker">JOB ' + esc(job.number) + '</span>' + starIcons(best ? best.stars : 0) + '</div>' +
        '<div class="m-name">' + esc(job.name) + '</div>' +
        '<div class="m-tag">' + esc(job.tagline) + '</div>' +
        '<div class="m-row m-stats"><span class="m-best">' + (best ? 'Best <b>' + money(best.payout) + '</b>' : 'No escape yet') + '</span>' +
        '<span class="m-night">' + esc(labelFor(job.id, tonight)) + '</span></div>' +
        hint +
        '<div class="m-row m-btns"><button class="btn primary" data-act="job" data-job="' + job.id + '">Tonight</button>' +
        (wins ? '<button class="btn" data-act="new-night" data-job="' + job.id + '">New night</button>' : '') +
        '</div></div>';
    });
    h += '<div class="footer-links"><button class="btn" data-act="log">Playtest log (' + store.runs.length + ')</button></div>';
    h += '<p class="note">Throwaway prototype. Progress and the playtest log are saved in this browser only.</p>';
    return h + '</div>';
  }

  // ---------- briefing ----------

  function renderBriefing(jobId, pk) {
    var job = jobById(jobId);
    if (!job) return renderSelect();
    pk = pk || (cur && cur.jobId === jobId ? cur.pick : pick(jobId, 'tonight'));
    cur = { jobId: jobId, pick: pk };
    var par = pk.par || (job.payout && job.payout.par) || 0;
    var exits = (job.exits || []).map(function (id) { return nodeLabel(job, id); });
    var progs;
    if (job.loadout) {
      // v4 loadout: tap programs to pick exactly `pick` of them.
      var lo = job.loadout;
      if (!pk.loadout) pk.loadout = lo.default.slice();
      progs = '<span class="m-lo-k">Loadout: pick ' + lo.pick + ' (' + pk.loadout.length + '/' + lo.pick + ')</span>' +
        (E.PROGRAM_ORDER || []).filter(function (p) { return lo.pool[p]; }).map(function (p) {
          var on = pk.loadout.indexOf(p) !== -1;
          return '<button class="chip lo' + (on ? ' on' : '') + '" data-act="loadout" data-prog="' + p + '" aria-pressed="' + on + '" title="' + esc(E.PROGRAMS[p].desc) + '">' +
            icon(p, 12) + ' ' + esc(E.PROGRAMS[p].name) + ' ×' + lo.pool[p] + '</button>';
        }).join('');
    } else {
      progs = (E.PROGRAM_ORDER || []).filter(function (p) { return job.programs[p]; }).map(function (p) {
        return '<span class="chip">' + icon(p, 12) + ' ' + esc(E.PROGRAMS[p].name) + ' ×' + job.programs[p] + '</span>';
      }).join('');
    }
    var alerts = (job.alerts || []).map(function (a) {
      return '<div class="m-alert"><b>⚠ ' + a.at + ' heat</b> ' + esc(a.text) + '</div>';
    }).join('');
    var h = '<div class="screen mscreen meta-brief">';
    h += '<div class="hdr"><button class="icon-btn" data-act="back" aria-label="Back to job board">' + icon('close') + '</button>' +
      '<div class="mid"><div class="kicker">JOB ' + esc(job.number) + ' · BRIEFING</div><div class="title">' + esc(job.name) + '</div></div>' + muteBtn() + '</div>';
    h += '<div class="card m-goal"><span class="t-gold">◆</span> ' + esc(job.goal) + '. Extract it, then get out.</div>';
    h += '<div class="m-stars">' +
      briefStar('Get out with the data') +
      briefStar('Payout ≥ PAR ' + money(par)) +
      briefStar(job.bonus ? job.bonus.text : 'Bonus objective') + '</div>';
    if (exits.length > 1) h += '<div class="m-exit">Exit: <b class="t-gold">' + exits.map(esc).join('</b> or <b class="t-gold">') + '</b> <span>(Sniff or Extract to find out)</span></div>';
    else if (exits.length) h += '<div class="m-exit">Exit: <b class="t-gold">' + esc(exits[0]) + '</b></div>';
    h += '<div class="chips m-progs">' + progs + '<span class="chip">' + job.turnLimit + ' turns</span></div>';
    if (alerts) h += '<div class="m-alerts">' + alerts + '</div>';
    h += '<div class="m-label">' + esc(pk.label) + '</div>';
    var short = job.loadout ? job.loadout.pick - pk.loadout.length : 0;
    h += '<div class="m-go"><button class="btn primary m-start" data-act="start"' + (short > 0 ? ' disabled' : '') + '>' + (short > 0 ? 'PICK ' + short + ' MORE' : 'START') + '</button>' +
      '<button class="m-link" data-act="help">How to play</button></div>';
    return h + '</div>';
  }
  function briefStar(text) {
    return '<div class="m-srow"><span class="stars"><span class="on">' + icon('star', 14) + '</span></span><span>' + esc(text) + '</span></div>';
  }

  // ---------- results ----------

  function headOf(run) {
    if (run.won) return 'EXTRACTED';
    if (run.reason === 'traced') return 'TRACED';
    if (run.reason === 'dropped') return 'CONNECTION DROPPED';
    return 'JOB ABORTED';
  }
  function typed(text, cls) {
    var out = '<span class="' + cls + '" data-type aria-label="' + esc(text) + '">';
    for (var i = 0; i < text.length; i++) out += '<span class="m-ch">' + esc(text[i]) + '</span>';
    return out + '</span>';
  }
  function starReason(run, i) {
    var f = run.starFlags || {};
    if (i === 0) return f.escaped ? '' : 'Didn’t get out';
    if (i === 1) return f.par ? '' : 'Payout ' + money(run.payout) + ' < PAR ' + money(run.par);
    if (f.bonus) return '';
    var b = run.bonus || {};
    if (b.id === 'ghost') {
      var s = run.close && run.close.seen;
      if (!s) return 'You were seen';
      return (s.kind === 'bump' ? 'Bumped' : 'Seen') + (s.sentry ? ' by Sentry ' + s.sentry : '') + (s.turn ? ' on turn ' + s.turn : '');
    }
    if (b.id === 'wormStun') return 'No Worm stun';
    if (b.id === 'greedy') return 'Left a cache behind';
    if (b.id === 'quiet') return 'Used Brute';
    if (b.id === 'speed') return 'Too slow';
    if (b.id === 'cool') return 'Ran too hot';
    if (b.id === 'bare') return 'Ran a program';
    return 'Bonus missed';
  }

  function renderResult(run) {
    run = run || (last && last.run);
    if (!run) return renderSelect();
    shown = run;
    var job = jobById(run.job) || { number: '?', name: run.job };
    var animate = !played[run.id] && !fast() && !reduced();
    var h = '<div class="screen mscreen meta-result ' + (run.won ? 'win' : 'lose') + (animate ? ' m-anim' : '') + '" data-run="' + run.id + '">' + muteBtn('m-mute');
    h += '<div class="result-head ' + (run.won ? 'win' : 'lose') + '">' +
      '<div class="kicker">JOB ' + esc(job.number) + ' · ' + esc(job.name) + (run.label ? ' · ' + esc(run.label) : '') + '</div>' +
      '<div class="big">' + typed(headOf(run), 'm-type') + '</div>';
    if (run.won) {
      h += '</div>';
      h += '<div class="card m-pay">';
      (run.payoutLines || []).forEach(function (l) {
        h += '<div class="m-pl m-step' + (l.id === 'cut' ? ' cut' : '') + (l.amount < 0 ? ' neg' : '') + '">' +
          '<span>' + esc(l.label) + '</span><span class="m-num" data-to="' + l.amount + '" data-signed="' + (l.id === 'base' ? '' : '1') + '">' + money(l.amount, l.id !== 'base') + '</span></div>';
      });
      h += '<div class="m-pl m-total m-step"><span>Payout</span><span class="m-num" data-to="' + run.payout + '">' + money(run.payout) + '</span></div>';
      h += '<div class="m-par">PAR ' + money(run.par) + '</div></div>';
      h += '<div class="m-stars-res">';
      var labels = ['Got out with the data', 'Payout ≥ PAR ' + money(run.par), run.bonus ? run.bonus.text : 'Bonus'];
      var flags = run.starFlags || {};
      [flags.escaped, flags.par, flags.bonus].forEach(function (on, i) {
        var why = on ? '' : starReason(run, i);
        h += '<div class="card m-star m-step ' + (on ? 'got' : 'miss') + '" data-star="' + i + '">' +
          '<span class="m-sicon">' + icon('star', 22) + '</span><span class="m-stext"><span>' + esc(labels[i]) + '</span>' +
          (why ? '<span class="m-why">' + esc(why) + '</span>' : '') + '</span></div>';
      });
      h += '</div>';
      if (run.newBest) {
        var delta = run.prevBest === null ? '' : ' ' + money(run.payout - run.prevBest, true);
        h += '<div class="m-ribbon m-step">NEW BEST' + (run.prevBest === null ? ' ' + money(run.payout) : delta) + '</div>';
      }
      // Narration that already names UNKNOWN drops the 'UNKNOWN ·' speaker tag.
      if (run.aiLine) h += '<div class="m-whisper m-step' + (/unknown/i.test(run.aiLine) ? ' narr' : '') + '">' + typed(run.aiLine, 'm-type2') + '</div>';
      h += '<div class="m-btns2 m-step">' +
        '<button class="btn primary" data-act="new-night" data-job="' + esc(run.job) + '">NEW NIGHT</button>' +
        '<div class="m-row2"><button class="btn" data-act="retry">Retry same night</button>' +
        nextJobBtn(run) + '</div>' +
        '<button class="btn ghost" data-act="back">Back to jobs</button></div>';
    } else {
      var sub = run.reason === 'traced' ? 'Heat hit ' + (run.close ? run.close.heatMax : 10) + '. They know who you are.' :
        run.reason === 'dropped' ? 'You ran out of turns.' : 'You pulled out.';
      h += '<div class="note">' + esc(sub) + '</div></div>';
      if (run.close && run.close.text) h += '<div class="m-close m-step">' + esc(run.close.text) + '</div>';
      h += '<div class="m-btns2 m-step">' +
        '<button class="btn primary m-retry" data-act="retry-fast">RETRY · same night</button>' +
        '<button class="btn" data-act="back">Back to jobs</button></div>';
    }
    h += '<details class="card m-details"><summary>Run stats</summary><dl class="m-kv">' +
      '<dt>Turns</dt><dd>' + run.turns + (run.turnLimit ? ' / ' + run.turnLimit : '') + '</dd>' +
      '<dt>Heat</dt><dd>' + run.heat + ' / ' + (run.close ? run.close.heatMax : 10) + '</dd>' +
      '<dt>Programs</dt><dd>' + (run.programs.length ? run.programs.map(function (p) { return esc(E.PROGRAMS[p] ? E.PROGRAMS[p].name : p); }).join(', ') : 'none') + '</dd>' +
      '<dt>Route</dt><dd>' + esc(run.route) + '</dd>' +
      (run.ai ? '<dt>UNKNOWN</dt><dd>' + esc(run.ai) + '</dd>' : '') +
      '<dt>Night</dt><dd>' + esc(run.variant) + '</dd>' +
      '</dl></details>';
    h += '<div class="card again m-again"><div class="q">Playtest: do you want another round?</div><div class="row">' +
      '<button class="btn' + (run.again === true ? ' picked' : '') + '" data-act="again-yes">Yes</button>' +
      '<button class="btn' + (run.again === false ? ' picked' : '') + '" data-act="again-no">Not really</button></div>' +
      '<textarea data-meta-note placeholder="Anything that felt like a chore, confusing, or great? (optional)">' + esc(run.note) + '</textarea></div>';
    h += '</div>';
    // Failsafe: if the router never calls afterRender, still reveal everything.
    if (animate && root.setTimeout && root.document) {
      var id = run.id;
      root.setTimeout(function () {
        if (anim || played[id]) return;
        var el = root.document.querySelector('.meta-result[data-run="' + id + '"]');
        if (el) afterRender('result', el.parentNode || el);
      }, 120);
    }
    return h;
  }
  function nextJobBtn(run) {
    for (var i = 0; i < JOBS.length - 1; i++) {
      if (JOBS[i].id === run.job) return '<button class="btn" data-act="job" data-job="' + JOBS[i + 1].id + '">Next: Job ' + esc(JOBS[i + 1].number) + '</button>';
    }
    return '';
  }

  // ---------- result reveal ----------

  function stopAnim(final) {
    if (!anim) return;
    var a = anim; anim = null;
    a.timers.forEach(function (t) { clearTimeout(t); });
    a.rafs.forEach(function (r) { try { cancelAnimationFrame(r); } catch (e) { /* ignore */ } });
    if (a.off) a.off();
    if (final) showAll(a.el);
  }

  function showAll(el) {
    if (!el) return;
    el.classList.remove('m-anim');
    el.querySelectorAll('.m-step, .m-ch').forEach(function (x) { x.classList.add('on'); });
    el.querySelectorAll('.m-num').forEach(function (x) {
      var v = +x.getAttribute('data-to');
      x.textContent = money(v, !!x.getAttribute('data-signed'));
    });
    el.querySelectorAll('.m-whisper').forEach(function (x) { x.classList.add('done'); });
  }

  function wireNote(el) {
    var ta = el.querySelector('[data-meta-note]');
    if (!ta || ta.__metaWired) return;
    ta.__metaWired = true;
    ta.addEventListener('input', function () { if (shown) { shown.note = ta.value; save(); } });
  }

  function afterRender(screen, rootEl) {
    if (screen !== 'result' || !rootEl || !rootEl.querySelector) return;
    var el = rootEl.classList && rootEl.classList.contains('meta-result') ? rootEl : rootEl.querySelector('.meta-result');
    if (!el) return;
    wireNote(el);
    var run = shown;
    if (!run) return;
    stopAnim(false);
    if (played[run.id]) { showAll(el); return; }
    played[run.id] = true;
    if (fast() || reduced() || !el.classList.contains('m-anim')) {
      showAll(el);
      if (!fast()) instantSounds(el, run);
      return;
    }
    runReveal(el, run);
  }

  function instantSounds(el, run) {
    if (!run.won) return;
    var f = run.starFlags || {};
    [f.escaped, f.par, f.bonus].forEach(function (on, i) { if (on) play('star', { i: i }); });
  }

  function runReveal(el, run) {
    var a = { el: el, timers: [], rafs: [] };
    anim = a;
    var at = 0;
    function later(ms, fn) { a.timers.push(setTimeout(function () { if (anim === a) fn(); }, ms)); }
    function tween(node, ms) {
      var to = +node.getAttribute('data-to'); var signed = !!node.getAttribute('data-signed');
      var t0 = null;
      function step(ts) {
        if (anim !== a) return;
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / ms);
        var e = 1 - Math.pow(1 - k, 3);
        node.textContent = money(k >= 1 ? to : Math.round(to * e / 10) * 10, signed);
        if (k < 1) a.rafs.push(requestAnimationFrame(step));
      }
      node.textContent = money(0, signed);
      a.rafs.push(requestAnimationFrame(step));
    }
    // Tap anywhere to skip to the end state.
    var skip = function (ev) {
      if (ev && ev.target && ev.target.closest && ev.target.closest('textarea, details')) return;
      stopAnim(true);
    };
    var doc = el.ownerDocument;
    doc.addEventListener('pointerdown', skip, true);
    a.off = function () { doc.removeEventListener('pointerdown', skip, true); };

    // 1. headline types out
    el.querySelectorAll('.m-type .m-ch').forEach(function (ch) {
      later(at, function () { ch.classList.add('on'); });
      at += T.type;
    });
    at += 150;
    if (run.won) {
      // 2. payout lines count up one by one
      var lines = el.querySelectorAll('.m-pay .m-pl');
      lines.forEach(function (ln) {
        var total = ln.classList.contains('m-total');
        later(at, function () {
          ln.classList.add('on');
          var num = ln.querySelector('.m-num');
          if (num) tween(num, total ? T.total : T.tween);
          play(total ? 'cache' : 'tick', total ? { haptic: false } : undefined);
        });
        at += total ? T.total + 120 : T.line;
      });
      at += 120;
      // 3. stars, 350 ms apart
      el.querySelectorAll('.m-star').forEach(function (s, i) {
        later(at, function () {
          s.classList.add('on');
          if (s.classList.contains('got')) play('star', { i: i }); else play('starMiss');
        });
        at += T.star;
      });
      // 4. NEW BEST ribbon
      var rib = el.querySelector('.m-ribbon');
      if (rib) { later(at, function () { rib.classList.add('on'); play('cache'); }); at += 500; }
      // 5. the AI consequence types out
      var wh = el.querySelector('.m-whisper');
      if (wh) {
        later(at, function () { wh.classList.add('on'); });
        at += 200;
        wh.querySelectorAll('.m-ch').forEach(function (ch, i) {
          later(at, function () { ch.classList.add('on'); if (i % 3 === 0) play('aiType'); });
          at += T.type;
        });
        later(at, function () { wh.classList.add('done'); });
      }
    } else {
      el.querySelectorAll('.m-close, .m-btns2').forEach(function (x) {
        later(at, function () { x.classList.add('on'); });
        at += T.gap;
      });
    }
    later(at, function () { stopAnim(true); });
    // Buttons and survey are usable during the reveal.
    el.querySelectorAll('.m-btns2').forEach(function (x) { if (run.won) later(Math.min(at, 1200), function () { x.classList.add('on'); }); });
  }

  // ---------- playtest log ----------

  function renderLog() {
    var h = '<div class="screen mscreen meta-log">';
    h += '<div class="hdr"><button class="icon-btn" data-act="back" aria-label="Back to job board">' + icon('close') + '</button>' +
      '<div class="mid"><div class="kicker">PLAYTEST</div><div class="title">Playtest log</div></div></div>';
    if (!store.runs.length) {
      h += '<p class="note">No runs yet. Play a job and it shows up here.</p>';
      return h + '<button class="btn" data-act="back">Back to jobs</button></div>';
    }
    JOBS.forEach(function (job) {
      var rs = store.runs.filter(function (r) { return r.job === job.id; });
      if (!rs.length) return;
      var v2 = rs.filter(function (r) { return !r.v1; });
      var wins = rs.filter(function (r) { return r.won; }).length;
      var yes = rs.filter(function (r) { return r.again === true; }).length;
      var asked = rs.filter(function (r) { return r.again !== null && r.again !== undefined; }).length;
      var avgStars = (rs.reduce(function (a, r) { return a + (r.stars || 0); }, 0) / rs.length).toFixed(1);
      var paid = v2.filter(function (r) { return r.won; });
      var avgPay = paid.length ? Math.round(paid.reduce(function (a, r) { return a + (r.payout || 0); }, 0) / paid.length / 10) * 10 : null;
      var nights = {};
      v2.forEach(function (r) { nights[r.variant] = 1; });
      h += '<dl class="card m-kv"><dt>Job ' + esc(job.number) + '</dt><dd>' + esc(job.name) + '</dd>' +
        '<dt>Runs</dt><dd>' + rs.length + ' (' + wins + ' won' + (rs.length - v2.length ? ', ' + (rs.length - v2.length) + ' from v1' : '') + ')</dd>' +
        '<dt>Avg stars</dt><dd>' + avgStars + '</dd>' +
        '<dt>Avg payout</dt><dd>' + (avgPay === null ? 'no v2 wins' : money(avgPay) + ' (wins)') + '</dd>' +
        '<dt>Nights</dt><dd>' + Object.keys(nights).length + ' different</dd>' +
        '<dt>Again?</dt><dd>' + (asked ? yes + ' of ' + asked + ' said yes' : 'not answered') + '</dd></dl>';
    });
    h += '<div class="m-recent">' + store.runs.slice(-8).reverse().map(function (r) {
      return '<div class="m-rrow"><span>' + esc(r.job) + ' ' + esc(r.variant) + '</span><span>' + (r.won ? '<b class="t-gold">' + money(r.payout || 0) + '</b> ' + (r.stars || 0) + '★' : esc(String(r.reason).toUpperCase())) + '</span></div>';
    }).join('') + '</div>';
    h += '<p class="note">Copy the log and paste it into the project thread.</p>';
    var framed = false; try { framed = root.self !== root.top; } catch (e) { framed = true; }
    h += '<div class="m-row2"><button class="btn primary" data-act="log-copy">COPY</button>' + (framed ? '' : '<button class="btn" data-act="log-csv">Download CSV</button>') + '</div>';
    h += '<div class="m-row2"><button class="btn ghost' + (confirmClear ? ' m-danger' : '') + '" data-act="log-clear">' +
      (confirmClear ? 'Tap again to delete ' + store.runs.length + ' runs' : 'Clear log') + '</button>' +
      '<button class="btn" data-act="back">Back</button></div>';
    return h + '</div>';
  }

  function csvCell(v) {
    if (Array.isArray(v)) v = v.join(' ');
    if (v && typeof v === 'object') v = v.text || '';
    if (v === null || v === undefined) v = '';
    v = String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function logCsv() {
    var rows = [CSV_COLS.join(',')];
    store.runs.forEach(function (r) { rows.push(CSV_COLS.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return rows.join('\n');
  }
  function logText() {
    return store.runs.map(function (r, i) {
      return '#' + (i + 1) + ' ' + r.job + ' ' + r.variant + ' ' + (r.won ? 'WON $' + r.payout + (r.par ? ' (par $' + r.par + ')' : '') : String(r.reason).toUpperCase()) +
        ' ' + r.stars + '★ heat ' + r.heat + ' turns ' + r.turns +
        ' | ' + r.route + ' | programs: ' + ((r.programs || []).join(', ') || 'none') + (r.ai ? ' | AI: ' + r.ai : '') +
        (r.deals ? ' | deals: ' + r.deals : '') + (r.close && r.close.text ? ' | ' + r.close.text : '') +
        ' | again: ' + (r.again === null || r.again === undefined ? '?' : r.again ? 'yes' : 'no') + (r.note ? ' | ' + r.note : '');
    }).join('\n');
  }
  function toast(msg) {
    var d = root.document; if (!d) return;
    var t = d.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    d.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }
  function copy(text) {
    var n = store.runs.length;
    var done = function () { toast('Copied ' + n + ' runs'); };
    if (root.navigator && navigator.clipboard && root.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var d = root.document;
    var ta = d.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    d.body.appendChild(ta); ta.select();
    try { d.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function download(name, text) {
    var d = root.document;
    var a = d.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    d.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- acts ----------

  function onAct(act, el) {
    var jobId = el && el.getAttribute ? el.getAttribute('data-job') : null;
    if (act !== 'log-clear') confirmClear = false;
    switch (act) {
      case 'job': {
        if (!jobById(jobId)) return null;
        stopAnim(false);
        var p = pick(jobId, 'tonight');
        cur = { jobId: jobId, pick: p };
        return { go: 'briefing', jobId: jobId, pick: p };
      }
      case 'new-night': {
        if (!jobById(jobId)) return null;
        stopAnim(false);
        var q = pick(jobId, 'new');
        cur = { jobId: jobId, pick: q };
        return { go: 'briefing', jobId: jobId, pick: q };
      }
      case 'start': {
        var c = cur || (JOBS[0] ? { jobId: JOBS[0].id, pick: pick(JOBS[0].id, 'tonight') } : null);
        if (!c) return null;
        var sj = jobById(c.jobId);
        if (sj && sj.loadout && c.pick.loadout && c.pick.loadout.length !== sj.loadout.pick) return { rerender: true };
        return { start: c.pick };
      }
      case 'loadout': {
        var lj = cur ? jobById(cur.jobId) : null;
        var prog = el && el.getAttribute ? el.getAttribute('data-prog') : null;
        if (!lj || !lj.loadout || !prog || !lj.loadout.pool[prog]) return null;
        var lst = cur.pick.loadout || (cur.pick.loadout = lj.loadout.default.slice());
        var at = lst.indexOf(prog);
        if (at !== -1) lst.splice(at, 1);
        else if (lst.length < lj.loadout.pick) lst.push(prog);
        return { rerender: true };
      }
      case 'retry':
      case 'retry-fast': {
        stopAnim(false);
        var lp = last ? last.pick : (cur ? cur.pick : null);
        if (!lp) return { go: 'select' };
        cur = { jobId: lp.jobId, pick: lp };
        return act === 'retry' ? { go: 'briefing', jobId: lp.jobId, pick: lp } : { start: lp };
      }
      case 'back': stopAnim(false); return { go: 'select' };
      case 'again-yes':
      case 'again-no':
        if (!shown) return { rerender: false };
        shown.again = act === 'again-yes';
        save();
        return { rerender: true };
      case 'log': stopAnim(false); return { go: 'log' };
      case 'log-copy': copy(logText()); return { rerender: false };
      case 'log-csv': download('backdoor-playtest-log.csv', logCsv()); return { rerender: false };
      case 'log-clear':
        if (!confirmClear) { confirmClear = true; return { rerender: true }; }
        confirmClear = false;
        store.runs = []; store.best = {}; save();
        return { rerender: true };
    }
    return null;
  }

  // ---------- init ----------

  function init(opts) {
    opts = opts || {};
    E = opts.E || root.BackdoorEngine;
    JOBS = opts.JOBS || root.BACKDOOR_JOBS || [];
    iconFn = opts.icon || (root.BackdoorIcons && root.BackdoorIcons.icon) || null;
    sfx = opts.sfx || null;
    store = load();
    // Record the first scan/bump (sentry + turn) on the game object, for the
    // "Seen by Sentry B on turn 4" star reason. Doesn't touch engine state.
    if (E && E.endTurn && !E.endTurn.__metaWrapped) {
      var orig = E.endTurn;
      var wrapped = function (game) {
        var turn = game && game.state ? game.state.turn : null;
        var r = orig.apply(this, arguments);
        try {
          if (r && r.ok && game && !game.metaSeen) {
            for (var i = 0; i < r.events.length; i++) {
              var e = r.events[i];
              if (e.kind === 'heat' && (e.cause === 'scan' || e.cause === 'bump')) { game.metaSeen = { sentry: e.sentry || null, turn: turn, kind: e.cause }; break; }
            }
          }
        } catch (err) { /* never break the game */ }
        return r;
      };
      wrapped.__metaWrapped = true;
      E.endTurn = wrapped;
    }
    return Meta;
  }

  var Meta = {
    init: init, pick: pick, renderSelect: renderSelect, renderBriefing: renderBriefing, renderResult: renderResult,
    renderLog: renderLog, afterRender: afterRender, onAct: onAct, finish: finish,
    // extras for tests and the router
    store: function () { return store; }, logCsv: logCsv, logText: logText, closeInfo: closeInfo,
    _hash: hashStr, _tonightIndex: tonightIndex, CSV_COLS: CSV_COLS
  };
  root.BackdoorMeta = Meta;
  if (typeof module !== 'undefined' && module.exports) module.exports = Meta;
})(typeof window !== 'undefined' ? window : globalThis);
