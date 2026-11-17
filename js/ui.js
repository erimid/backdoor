/*
 * Backdoor prototype UI (v2): the board, its overlays (AI offer, abort, help)
 * and routing. Every other screen comes from js/meta.js (BackdoorMeta). All
 * rules live in engine.js; this file only stages the engine's events.
 *
 * Layers:
 *  - #app: innerHTML-rendered screens (tiles, links, HUD, dock).
 *  - #fx:  a fixed, persistent layer on top. It holds the player and Sentry
 *          tokens (inside .fxboard, which tracks the board's rect), effect
 *          sprites, the whisper strip and the tip bubble.
 *
 * Sequences (enemy phase, big moments, win/lose) run through runSeq(): input
 * is blocked while one plays, and a pointerdown anywhere skips to its end.
 * ?fast=1 (window.__backdoorFast) makes every sequence instant.
 */
(function () {
  'use strict';
  var E = window.BackdoorEngine;
  var JOBS = window.BACKDOOR_JOBS;
  var icon = window.BackdoorIcons.icon;
  var Meta = window.BackdoorMeta;
  var SFX = window.SFX || null;
  var Voice = window.BackdoorVoice || null;
  var VARS = window.BACKDOOR_VARIANTS || null;
  var app = document.getElementById('app');
  var fx = document.getElementById('fx');
  if (!fx) { fx = document.createElement('div'); fx.id = 'fx'; fx.setAttribute('aria-hidden', 'true'); document.body.appendChild(fx); }

  var FAST = /[?&]fast=1\b/.test(location.search) || !!window.__backdoorFast;
  if (FAST) window.__backdoorFast = true;
  var RM = false;
  try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
  if (RM) document.body.classList.add('rm');

  Meta.init({ E: E, JOBS: JOBS, icon: icon, sfx: SFX || undefined });

  var TIPS_KEY = 'backdoor.tips';

  var ui = {
    screen: 'select',   // select | briefing | board | result | log
    jobId: null,
    pick: null,
    job: null,          // raw job from jobs.js
    game: null,
    selected: null,     // targeted program waiting for a node
    info: null,         // node id the player tapped for info
    feed: [],
    overlay: null,      // ai | abort | help
    busy: false,
    playback: false,    // enemy phase playing: old token spots, no intents
    preBreach: false,   // extract playing: hold BREACH visuals back
    intentIn: false,    // next render staggers the intents in
    hudHeat: null,      // heat shown in the HUD while a sequence plays
    hold: null,         // turn, $ and feed shown while the enemy phase plays
    msgUntil: 0,        // the threat toast / heat banner on screen until then
    shown: { player: null, s: {} },
    run: null,
    band: 0,
    barkTurn: 0,
    coachSeen: [],
    firstSeen: null,
    justMoved: null,    // [from, to] for the link draw-in
    chipLostAt: 0,
    bonusWasMet: null,
    unlocked: false
  };

  // ---------- small helpers ----------

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function def(id) { return E.nodeDef(ui.game ? ui.game.job : ui.job, id); }
  function lbl(id) { var d = def(id); return d ? d.label : id; }
  function jobById(id) { for (var i = 0; i < JOBS.length; i++) if (JOBS[i].id === id) return JOBS[i]; return null; }
  function money(n) { return (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)); }
  function sfx(name, opts) { if (!FAST && SFX) try { SFX.play(name, opts); } catch (e) { /* ignore */ } }
  function bandOf(heat) { return heat >= 7 ? 2 : heat >= 4 ? 1 : 0; }
  function heatColor(i) {
    var c = ['#FFB25E', '#FFA74F', '#FF9F43', '#FF923D', '#FF8A3D', '#FF7A38', '#FF6A35', '#FF5A33', '#FF4A31', '#FF3B30'];
    return c[Math.max(0, Math.min(9, i))];
  }
  // The threat toast and the heat-band banner sit at about the same height,
  // so they never overlap: each waits until the one before it has gone, and
  // one that would have to wait longer than maxWait is dropped.
  function inTurn(ms, fn, maxWait) {
    var now = Date.now();
    var at = Math.max(now, ui.msgUntil || 0);
    if (maxWait !== undefined && at - now > maxWait) return false;
    ui.msgUntil = at + ms;
    if (at === now || FAST) fn(); else setTimeout(fn, at - now);
    return true;
  }
  function toast(msg, cls) {
    var t = document.createElement('div');
    t.className = 'toast' + (cls ? ' ' + cls : ''); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, FAST ? 0 : 1600);
  }
  function loadTips() { try { return JSON.parse(localStorage.getItem(TIPS_KEY)) || {}; } catch (e) { return {}; } }
  function saveTips(t) { try { localStorage.setItem(TIPS_KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }
  function bfsDist(from, nextFn) {
    var d = {}; d[from] = 0; var q = [from];
    while (q.length) { var n = q.shift(); nextFn(n).forEach(function (m) { if (d[m] === undefined) { d[m] = d[n] + 1; q.push(m); } }); }
    return d;
  }

  var SPEAKER_ON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  var SPEAKER_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

  // ---------- sequences ----------

  var seq = null;
  // steps: [[ms, fn], ...]. done() renders the end state. In fast mode the
  // steps are skipped and done() runs at once.
  function runSeq(steps, total, done) {
    if (seq) finishSeq(seq, true);
    if (FAST) { done(); return; }
    var s = { timers: [], done: done };
    seq = s; ui.busy = true;
    steps.forEach(function (st) {
      s.timers.push(setTimeout(function () { if (seq === s) try { st[1](); } catch (e) { console.error(e); } }, Math.max(0, st[0])));
    });
    s.timers.push(setTimeout(function () { finishSeq(s); }, Math.max(0, total)));
  }
  function finishSeq(s, skipped) {
    if (seq !== s) return;
    s.timers.forEach(clearTimeout);
    seq = null; ui.busy = false;
    if (skipped) clearSprites();
    s.done();
  }
  function skipSeq() { if (seq) finishSeq(seq, true); }

  // ---------- routing ----------

  function render() {
    var html;
    var s = ui.screen;
    if (s === 'select') html = Meta.renderSelect();
    else if (s === 'briefing') html = Meta.renderBriefing(ui.jobId, ui.pick);
    else if (s === 'result') html = Meta.renderResult(ui.run);
    else if (s === 'log') html = Meta.renderLog();
    else html = renderBoard();
    html += renderOverlay();
    app.innerHTML = html;
    if (s === 'board') afterBoardRender();
    else {
      hideBoardFx();
      Meta.afterRender(s, app);
    }
  }

  function go(screen) {
    ui.screen = screen; ui.overlay = null;
    render();
    window.scrollTo(0, 0);
  }

  function doCmd(c) {
    if (!c) return;
    if (c.start) { startJob(c.start); return; }
    if (c.go) {
      if (c.jobId) ui.jobId = c.jobId;
      if (c.pick) ui.pick = c.pick;
      go(c.go);
      return;
    }
    if (c.rerender) render();
  }

  function startJob(pick) {
    var job = jobById(pick.jobId);
    ui.pick = pick; ui.jobId = pick.jobId; ui.job = job;
    ui.game = E.newGame(job, { variant: pick.variant, par: pick.par });
    ui.selected = null; ui.info = null; ui.overlay = null; ui.feed = [];
    ui.playback = false; ui.preBreach = false; ui.intentIn = false; ui.hudHeat = null;
    ui.hold = null; ui.msgUntil = 0;
    ui.band = 0; ui.barkTurn = 0; ui.coachSeen = []; ui.firstSeen = null; ui.justMoved = null;
    ui.chipLostAt = 0; ui.bonusWasMet = null; ui.helloLater = null;
    ui.shown = { player: null, s: {} };
    resetFx();
    ui.feed = [{ kind: 'info', text: 'You’re in. Tap a glowing node to move.' }];
    ui.screen = 'board';
    render();
    window.scrollTo(0, 0);
    syncFx(0);
    tipCheck();
    if (job.id === 'job01') {
      ui.barkTurn = 1;
      var game0 = ui.game;
      var hello = function () {
        if (ui.screen !== 'board' || ui.game !== game0) return;
        // "watching." belongs to turn 1. Once the turn has moved on, drop it
        // rather than let it replace a bark about what just happened.
        if (game0.state.turn > 1) return;
        if (tipEl) { ui.helloLater = hello; return; } // after the first tip is dismissed
        whisper(Voice ? Voice.line('job01Start') : 'watching.');
      };
      setTimeout(hello, FAST ? 0 : 700);
    }
  }

  function finishJob() {
    var game = ui.game, st = game.state;
    var run = Meta.finish(game, ui.pick, {
      deals: st.ai ? st.ai.deals : 0,
      aiAnswers: st.ai ? E.clone(st.ai.answers) : {},
      coachSeen: ui.coachSeen.slice(),
      firstSeen: ui.firstSeen || undefined
    });
    ui.run = run;
    if (SFX) try { SFX.stopAmbient(); } catch (e) { /* ignore */ }
    document.body.removeAttribute('data-band');
    document.body.removeAttribute('data-breach');
    document.body.classList.remove('glitch');
    go('result');
  }

  // ---------- board ----------

  function geometry() {
    var W = Math.min(app.clientWidth || window.innerWidth, 560) - 32;
    W = Math.max(300, W);
    var s = W / 358;
    var N = Math.round(Math.max(56, Math.min(76, 60 * s)));
    var H = Math.round(396 * s);
    var padX = Math.round(10 * s), padY = Math.round(16 * s);
    return {
      W: W, H: H, N: N,
      x: function (c) { return padX + c * (W - 2 * padX - N) / 3; },
      y: function (r) { return padY + r * (H - 2 * padY - N) / 4; }
    };
  }
  function tile(g, id) { var d = def(id); return { x: g.x(d.col), y: g.y(d.row), N: g.N }; }
  function center(g, id) { var t = tile(g, id); return { x: t.x + t.N / 2, y: t.y + t.N / 2 }; }

  function displayHeat() { return ui.hudHeat !== null ? ui.hudHeat : ui.game.state.heat; }
  function breachShown() { return ui.game.state.breach && !ui.preBreach; }
  // While Extract plays, the exit stays as it looked before.
  function exitKnownShown() { return breachShown() || (E.exitInfo(ui.game).known && !(ui.preBreach && !ui.exitKnownBefore)); }

  function renderBoard() {
    var job = ui.game.job, game = ui.game, st = game.state;
    var h = '<div class="screen board-screen">';
    var muted = SFX ? SFX.isMuted() : true;

    // Header
    h += '<div class="hdr">' +
      '<button class="icon-btn" data-act="abort" aria-label="Abort job">' + icon('close') + '</button>' +
      '<div class="mid"><div class="kicker">JOB ' + esc(job.number) + (ui.pick && ui.pick.label ? ' · ' + esc(ui.pick.label) : '') + '</div><div class="title">' + esc(job.name) + '</div></div>' +
      '<button class="icon-btn sm" data-act="mute" aria-label="' + (muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off') + '" aria-pressed="' + (muted ? 'true' : 'false') + '">' + (muted ? SPEAKER_OFF : SPEAKER_ON) + '</button>' +
      '<button class="icon-btn sm" data-act="help" aria-label="How to play">' + icon('help', 16) + '</button>' +
      '</div>';

    h += renderHud();
    h += renderChips();
    h += renderGrid();

    // Dock
    // Feed + warning share three lines at most, so the dock stays short.
    var warn = renderWarning();
    h += '<div class="dock">';
    h += '<div class="feed" aria-live="polite">' + ui.feed.slice(/empty/.test(warn) ? -2 : -1).map(function (e) {
      return '<div class="e-' + e.kind + '">' + esc(e.text) + '</div>';
    }).join('') + '</div>';
    h += warn;
    h += renderTray();
    h += renderActions();
    h += '</div>';
    return h + '</div>';
  }

  function renderHud() {
    var game = ui.game, st = game.state, job = game.job;
    var hold = ui.playback && ui.hold ? ui.hold : null;
    var trace = hold ? hold.trace : E.tracing(game);
    var heat = displayHeat();
    var segs = '';
    for (var i = 0; i < E.HEAT_MAX; i++) {
      if (i === 4 || i === 7) segs += '<u class="notch"></u>';
      segs += '<i data-seg="' + i + '"' + (i < heat ? ' class="on" style="background:' + heatColor(i) + '"' : '') + '></i>';
    }
    var nPips = st.banked || st.actions > E.ACTIONS_PER_TURN ? E.ACTIONS_MAX : E.ACTIONS_PER_TURN;
    var pips = '';
    for (var j = 0; j < nPips; j++) pips += '<i class="' + (j < st.actions ? 'on' : '') + (j === 2 ? ' bank' : '') + '"></i>';
    var p = E.payout(game);
    var total = hold ? hold.total : p.total;
    var ok = total >= p.par;
    return '<div class="card hud">' +
      '<div class="h-turn' + (trace ? ' trace' : '') + '"><span class="k">' + (trace ? 'TRACE' : 'TURN') + '</span><b>' + (hold ? hold.turn : st.turn) + '<span>/' + job.turnLimit + '</span></b></div>' +
      '<div class="h-heat"><span class="k">HEAT <b>' + heat + '</b></span><div class="segs" data-heat="' + heat + '">' + segs + '</div></div>' +
      '<div class="h-act" data-anchor="pips"><span class="k">ACT</span><div class="pips' + (st.banked ? ' banked' : '') + '" aria-label="' + st.actions + ' actions left">' + pips + '</div></div>' +
      '<div class="h-pay' + (ok ? ' ok' : '') + '"><span class="k">PAR $' + p.par + '</span><b class="cash">$' + total + '</b></div>' +
      '</div>';
  }

  function renderChips() {
    var game = ui.game, st = game.state, job = game.job;
    var info = E.exitInfo(game);
    var p = E.payout(game);
    var h = '<div class="chips">';
    if (!st.hasData || ui.preBreach) {
      var tgt = job.nodes.filter(function (n) { return n.type === 'target'; })[0];
      h += '<div class="chip gold">◆ ' + esc(tgt ? tgt.label : job.goal) + '</div>';
    } else {
      h += '<div class="chip gold solid">▶ EXIT ' + esc(lbl(info.exit || st.exit)) + '</div>';
    }
    h += '<div class="chip star' + (st.status === 'won' ? ' done' : st.hasData ? ' warm' : '') + '">★ Out</div>';
    h += '<div class="chip star' + (p.total >= p.par ? ' ok' : ' mute') + '">★ PAR</div>';
    if (job.bonus) {
      var met = ui.playback && ui.bonusWasMet !== null ? ui.bonusWasMet : E.bonusMet(game);
      var cls = 'chip star';
      var anim = '';
      if ((E.LOSSY_BONUS || ['ghost']).indexOf(job.bonus.id) !== -1) {
        if (!met) {
          cls += ' lost';
          var el = Date.now() - ui.chipLostAt;
          if (el < 600 && !FAST) { cls += ' lose-anim'; anim = ' style="animation-delay:-' + el + 'ms"'; }
        }
      } else if (met) cls += ' done';
      h += '<div class="' + cls + '" data-chip="bonus"' + anim + ' title="' + esc(job.bonus.text) + '">★ ' + esc(job.bonus.short || 'Bonus') + '</div>';
    }
    return h + '</div>';
  }

  function intentSummary() {
    var game = ui.game, st = game.state;
    if (st.status !== 'playing') return '';
    return st.sentries.map(function (s) {
      var it = s.intent || {};
      if (it.type === 'move') return s.id + (it.target === st.player ? ' bumps you' : (it.why === 'retreat' ? ' backs off → ' : ' → ') + lbl(it.target));
      if (it.type === 'scan') return s.id + ' scans ' + (it.target === st.player ? 'you' : lbl(it.target));
      if (it.type === 'stunned') return s.id + ' stunned';
      if (it.why === 'rest') return s.id + ' rests';
      if (it.type === 'watch') return s.id + ' watches' + (it.nodes.indexOf(st.player) !== -1 ? ' you' : '');
      return s.id + ' waits';
    }).join(' · ');
  }

  function renderTray() {
    var game = ui.game, st = game.state, job = game.job;
    var h = '<div class="tray">';
    E.PROGRAM_ORDER.forEach(function (p) {
      if (job.programs[p] === undefined && !st.charges[p]) return;
      var c = st.charges[p] || 0;
      var cost = E.programCost(p);
      var cls = 'prog';
      var short = cost > 1 && c > 0 && st.actions < cost && !E.canAct(game);
      if (c === 0) cls += ' used';
      else if (ui.selected === p) cls += ' sel';
      else if (p === 'spoof' && st.spoof) cls += ' active';
      else if (short) cls += ' off';
      else if (!E.canRun(game, p)) cls += ' idle';
      var label = E.PROGRAMS[p].name + ', ' + (c ? c + ' left' : 'used') + (cost > 1 ? ', costs ' + cost + ' actions' : '') +
        (short ? ', needs ' + cost + ' actions' : '') + (ui.selected === p ? ', selected' : '') + (p === 'spoof' && st.spoof ? ', running' : '');
      h += '<button class="' + cls + '" data-act="prog" data-prog="' + p + '" data-anchor="prog-' + p + '" aria-label="' + label + '"' + (short ? ' aria-disabled="true"' : '') + '>' +
        icon(p, 18) + '<span class="n">' + E.PROGRAMS[p].name + '</span>' +
        (cost > 1 ? '<span class="cost">' + cost + ' actions</span>' : '') +
        '<span class="c">' + (p === 'spoof' && st.spoof ? 'ON' : '×' + c) + '</span></button>';
    });
    return h + '</div>';
  }

  function renderActions() {
    var game = ui.game, st = game.state;
    var canUndo = game.undoStack.length > 0 && st.status === 'playing' && !(st.ai && st.ai.pending);
    var hold = st.actions > 0;
    var sub = ui.playback ? '' : intentSummary();
    // With EXTRACT in the row the End button is narrow: shorter label, and the
    // threat summary may wrap to two lines instead of being cut off.
    var tight = E.canExtract(game);
    return '<div class="actions' + (tight ? ' tight' : '') + '">' +
      '<button class="btn undo" data-act="undo"' + (canUndo ? '' : ' disabled') + '>' + icon('undo', 15) + 'Undo</button>' +
      (E.canExtract(game) ? '<button class="btn gold extract" data-act="extract" data-anchor="extract">' + icon('extract', 15) + 'EXTRACT</button>' : '') +
      '<button class="btn primary end' + (hold ? ' hold' : ' nudge') + '" data-act="end"' + (st.status === 'playing' ? '' : ' disabled') + '>' +
      '<span class="l1">' + (hold ? (tight ? 'HOLD · +1' : 'HOLD · +1 next turn') : 'END TURN') + '</span>' +
      (sub ? '<span class="l2">' + esc(sub) + '</span>' : '') + '</button>' +
      '</div>';
  }

  function renderWarning() {
    var game = ui.game, st = game.state;
    if (st.status !== 'playing' || ui.playback || ui.preBreach) return '<div class="warn empty"></div>';
    var th = E.threats(game);
    var msg = null, cls = '', ic = 'warn';
    if (ui.selected) {
      cls = ' safe'; ic = ui.selected;
      msg = E.PROGRAMS[ui.selected].name + ': tap a highlighted node. Tap the card again to cancel.';
    } else if (th.length) {
      var t = th[0];
      if (st.spoof) { msg = 'Spoof is up. Sentry ' + t.sentry + '’s ' + (t.type === 'scan' ? 'scan' : 'bump') + ' will miss you.'; cls = ' safe'; }
      else if (t.type === 'scan') msg = 'Sentry ' + t.sentry + ' scans your node next (+' + t.heat + '). Move or Spoof.';
      else msg = 'Sentry ' + t.sentry + ' walks into you next (+' + t.heat + '). Move or Spoof.';
      if (th.length > 1 && !st.spoof) msg += ' ' + th[1].sentry + ' too.';
    } else if (breachShown()) {
      msg = 'BREACH. Run for ' + lbl(st.exit) + '.' + (E.tracing(game) ? ' Trace: +1 heat every turn.' : ' Trace starts next turn.');
      cls = ' gold'; ic = 'extract';
    } else if (st.actions === 0) {
      msg = 'Out of actions. End your turn.'; cls = ' safe';
    }
    if (!msg) return '<div class="warn empty"></div>';
    return '<div class="warn' + cls + '" role="status">' + icon(ic, 14) + '<span>' + esc(msg) + '</span></div>';
  }

  function nodeClasses(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var info = E.exitInfo(game);
    var breach = breachShown();
    var c = ['node'];
    if (ns.hidden) c.push('hidden');
    else if (d.type === 'honeypot') c.push('trap');
    else if (d.type === 'entry') { c.push('entry'); if (breach && E.isBurned(game, id)) c.push('burned'); }
    else if (d.type === 'target') { c.push('target'); if (st.hasData) c.push('copied'); }
    else if (d.type === 'firewall' || d.type === 'lock') { c.push('barrier'); if (ns.open) c.push('open'); }
    else if (d.type === 'ai') { c.push('ai'); if (st.ai.trusted) c.push('trusted'); if (st.ai.refused) c.push('refused'); }
    if (game.job.exits.indexOf(id) !== -1) {
      var known = exitKnownShown();
      if (breach && id === st.exit) c.push('exit', 'live');
      else if (known && id === info.exit) c.push('exit');
      else if (!known) c.push('exitc');
    }
    if (st.player === id) c.push('you');
    else if (ui.picks.indexOf(id) !== -1) c.push('pick');
    else if (!ui.selected && ui.moves.indexOf(id) !== -1) c.push('valid');
    if (ui.info === id) c.push('sel-info');
    return c.join(' ');
  }

  function nodeInner(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var info = E.exitInfo(game);
    var breach = breachShown();
    var inner;
    if (ns.hidden) inner = '<div class="q">?</div>';
    else if (d.type === 'ai') inner = '<div class="q">?</div>';
    else if (d.type === 'honeypot') inner = icon('trap', 18);
    else if (d.type === 'lock' && ns.open) inner = icon('unlock', 18);
    else inner = icon(d.icon, d.type === 'target' ? 20 : 18);
    inner += '<div class="lbl">' + esc(d.label) + '</div>';
    if (d.cache && !ns.hidden && !st.taken[id]) {
      inner += '<i class="cache-chip' + (d.cache.kind === 'charge' ? ' charge' : '') + '" title="' + (d.cache.kind === 'charge' ? 'Spare program charge' : 'Cache') + '"></i>';
    }
    if (breach && d.type === 'entry' && E.isBurned(game, id)) {
      inner += '<svg class="burn-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>';
    }
    var badges = [];
    if (!ns.hidden && d.type === 'honeypot') badges.push(['trap', 'TRAP']);
    if (ns.decoy) badges.push(['mine', 'DECOY']);
    if (ns.infected) badges.push(['mine', 'WORM']);
    if ((d.type === 'firewall' || d.type === 'lock') && ns.open) badges.push(['open', 'OPEN']);
    if (d.type === 'target' && st.hasData) badges.push(['data', 'COPIED']);
    if (breach && d.type === 'entry' && E.isBurned(game, id)) badges.push(['trap', 'BURNED']);
    if (game.job.exits.indexOf(id) !== -1) {
      if (breach && id === st.exit) badges.unshift(['exit', 'EXIT']);
      else if (exitKnownShown() && id === info.exit) badges.unshift(['exit', 'YOUR EXIT']);
      else if (!exitKnownShown()) badges.push(['exitq', 'EXIT?']);
    }
    badges.slice(0, 2).forEach(function (b, i) {
      inner += '<div class="badge ' + b[0] + (i ? ' b2' : '') + '">' + b[1] + '</div>';
    });
    return inner;
  }

  function nodeAria(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var parts = [ns.hidden ? 'Unknown node ' + d.label : d.label];
    if (st.player === id) parts.push('you are here');
    if (ui.moves.indexOf(id) !== -1 && !ui.selected) parts.push('tap to move');
    if (ui.picks.indexOf(id) !== -1) parts.push('tap to target');
    if (d.cache && !ns.hidden && !st.taken[id]) parts.push('cache');
    var s = E.sentryAt(game, id);
    if (s) parts.push('Sentry ' + s.id);
    return parts.join(', ');
  }

  function renderGrid() {
    var game = ui.game, st = game.state, job = game.job;
    var g = geometry();
    ui.geo = g;
    ui.moves = ui.playback ? [] : E.legalMoves(game);
    ui.picks = ui.selected && !ui.playback ? E.programTargets(game, ui.selected) : [];

    var svg = '<svg class="layer" width="' + g.W + '" height="' + g.H + '" viewBox="0 0 ' + g.W + ' ' + g.H + '" aria-hidden="true">' +
      '<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#FF9F43"/></marker></defs>';

    // Links
    var walked = {};
    for (var i = 1; i < st.path.length; i++) {
      var a = st.path[i - 1], b = st.path[i];
      if (a !== b) walked[a < b ? a + b : b + a] = true;
    }
    var jm = ui.justMoved; var jmKey = jm ? (jm[0] < jm[1] ? jm[0] + jm[1] : jm[1] + jm[0]) : null;
    var aiId = job.ai ? job.ai.node : null;
    var base = '', aiLinks = '', walkedLinks = '';
    E.allLinks(game).forEach(function (l) {
      var p = center(g, l[0]), q = center(g, l[1]);
      var k = l[0] < l[1] ? l[0] + l[1] : l[1] + l[0];
      var attrs = ' data-a="' + l[0] + '" data-b="' + l[1] + '"';
      if (l[0] === aiId || l[1] === aiId) {
        var trusted = st.ai && st.ai.trusted;
        aiLinks += '<line class="lk ai-link" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"' + attrs + ' stroke="#B48CFF" stroke-width="2" stroke-dasharray="' + (trusted ? '6 4' : '3 5') + '" opacity="' + (st.ai && st.ai.refused ? 0.4 : 1) + '"/>';
      } else if (walked[k]) {
        // The newest hop draws in from where you came from.
        var from = jm && k === jmKey ? (l[0] === jm[0] ? p : q) : p, to = jm && k === jmKey ? (l[0] === jm[0] ? q : p) : q;
        var len = Math.round(Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2)));
        walkedLinks += '<line class="lk walked' + (k === jmKey && !FAST ? ' draw-in' : '') + '" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '"' + attrs + ' style="--len:' + len + '"/>';
      } else {
        base += '<line class="lk" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"' + attrs + '/>';
      }
    });
    svg += '<g class="links" stroke="#223040" stroke-width="2" fill="none">' + base + '</g>';
    svg += aiLinks;
    svg += '<g class="links-walked" stroke="#3DDCFF" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.85">' + walkedLinks + '</g>';

    // Intents: none while the enemy phase plays or the BREACH is held back.
    if (!ui.playback && !ui.preBreach && st.status === 'playing') svg += renderIntents(g);
    svg += '</svg>';

    var nodes = '';
    job.nodes.forEach(function (d) {
      nodes += '<button class="' + nodeClasses(d.id) + '" data-act="node" data-node="' + d.id + '" aria-label="' + esc(nodeAria(d.id)) + '" style="left:' + g.x(d.col) + 'px;top:' + g.y(d.row) + 'px;width:' + g.N + 'px;height:' + g.N + 'px">' + nodeInner(d.id) + '</button>';
    });

    return '<div class="board' + (breachShown() ? ' breach' : '') + '" style="width:' + g.W + 'px;height:' + g.H + 'px">' + svg + nodes + '</div>';
  }

  function renderIntents(g) {
    var st = ui.game.state;
    var list = [];
    st.sentries.forEach(function (s) {
      var it = s.intent;
      if (it && it.type === 'watch') { list.push({ s: s, it: it, mine: it.nodes.indexOf(st.player) !== -1 }); return; }
      if (!it || (it.type !== 'move' && it.type !== 'scan')) return;
      list.push({ s: s, it: it, mine: it.target === st.player });
    });
    // Intents aimed at you land last.
    list.sort(function (a, b) { return (a.mine ? 1 : 0) - (b.mine ? 1 : 0); });
    ui.intentOrder = list.filter(function (x) { return x.it.type !== 'watch' || x.mine; }).map(function (x) { return x.mine; });
    var out = '';
    var ringCount = {};
    list.forEach(function (x, i) {
      var s = x.s, it = x.it;
      var cls = 'intent' + (ui.intentIn && !FAST ? ' intent-in' : '') + (x.mine ? ' at-you' : '');
      var g0 = '<g class="' + cls + '" data-intent="' + s.id + '" style="--i:' + i + '">';
      if (it.type === 'watch') {
        // A camera's zone: a thin dotted ring on every node it watches.
        it.nodes.forEach(function (id) {
          var cz = center(g, id);
          out += g0 + '<circle class="cam-zone" cx="' + cz.x + '" cy="' + cz.y + '" r="' + (g.N * 0.62) + '" fill="none" stroke="#FF9F43" stroke-width="1.5" stroke-dasharray="1.5 4"/></g>';
        });
      } else if (it.type === 'move') {
        var p = center(g, s.pos), q = center(g, it.target);
        var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = g.N * 0.42;
        var x1 = p.x + dx / len * off, y1 = p.y + dy / len * off;
        var x2 = q.x - dx / len * (off + 4), y2 = q.y - dy / len * (off + 4);
        var hunt = it.why === 'hunt', noise = it.why === 'noise', lure = it.why === 'decoy';
        out += g0 + '<path class="ipath' + (hunt ? ' hunt' : noise ? ' noise' : '') + '" d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="#FF9F43" stroke-width="3"' +
          (hunt ? '' : ' stroke-dasharray="' + (noise ? '3 4' : '6 5') + '"') + ' marker-end="url(#ah)" fill="none"/>';
        out += '</g>';
      } else {
        var c = center(g, it.target);
        var n = ringCount[it.target] = (ringCount[it.target] || 0) + 1;
        out += g0 + '<circle class="scan-ring" cx="' + c.x + '" cy="' + c.y + '" r="' + (g.N * 0.7 + (n - 1) * 6) + '" fill="none" stroke="#FF9F43" stroke-width="2.5" stroke-dasharray="4 4"/></g>';
      }
    });
    return out;
  }

  // ---------- fx layer ----------

  var fxb = document.createElement('div');
  fxb.className = 'fxboard';
  fx.appendChild(fxb);

  function hideBoardFx() {
    fxb.style.display = 'none';
    hideTip();
    var w = fx.querySelector('.whisper'); if (w) w.remove();
    fx.querySelectorAll('.spr-screen').forEach(function (s) { s.remove(); });
  }
  function resetFx() {
    fxb.innerHTML = '';
    fx.querySelectorAll('.whisper, .tipb, .spr-screen').forEach(function (s) { s.remove(); });
  }
  function clearSprites() {
    fx.querySelectorAll('.spr').forEach(function (s) { s.remove(); });
    var b = app.querySelector('.board');
    if (b) b.classList.remove('shake', 'shake-sm');
    fxb.classList.remove('shake', 'shake-sm');
    document.body.classList.remove('glitch', 'tint');
  }

  function placeFxBoard() {
    var b = app.querySelector('.board');
    if (!b || ui.screen !== 'board') { fxb.style.display = 'none'; return null; }
    var r = b.getBoundingClientRect();
    fxb.style.display = 'block';
    fxb.style.left = r.left + 'px'; fxb.style.top = r.top + 'px';
    fxb.style.width = r.width + 'px'; fxb.style.height = r.height + 'px';
    return r;
  }

  function tokenPos(kind, node) {
    var g = ui.geo, t = tile(g, node);
    if (kind === 'you') return { x: t.x + t.N / 2 - 7, y: t.y - 7 };
    return { x: t.x + t.N - 14, y: t.y - 14 };
  }

  // Places the tokens at ui.shown. ms = slide duration (0 = jump).
  function syncFx(ms, only) {
    if (!placeFxBoard() || !ui.game) return;
    var st = ui.game.state;
    fxb.classList.toggle('playing', !!ui.playback);
    if (!ui.shown.player) ui.shown.player = st.player;
    var you = fxb.querySelector('.tok-you');
    if (!you) { you = document.createElement('div'); you.className = 'tok tok-you'; you.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14"><path d="M7 0.8L13.2 7L7 13.2L0.8 7z"/></svg><i class="packet"></i>'; fxb.appendChild(you); ms = 0; }
    if (!only || only === 'you') {
      var p = tokenPos('you', ui.shown.player);
      you.style.transitionDuration = (ms || 0) + 'ms';
      you.style.left = p.x + 'px'; you.style.top = p.y + 'px';
    }
    you.classList.toggle('carry', !!breachShown() || (st.hasData && !ui.preBreach));
    var ids = {};
    st.sentries.forEach(function (s) {
      ids[s.id] = true;
      if (!ui.shown.s[s.id]) ui.shown.s[s.id] = s.pos;
      var el = fxb.querySelector('.tok-s[data-sentry="' + s.id + '"]');
      var fresh = false;
      if (!el) { el = document.createElement('div'); el.className = 'tok tok-s' + (s.camera ? ' cam' : ''); el.setAttribute('data-sentry', s.id); el.innerHTML = '<span class="sl">' + s.id + '</span><span class="zz">zz</span><span class="why"></span>'; fxb.appendChild(el); fresh = true; }
      if (!only || only === s.id) {
        var q = tokenPos('s', ui.shown.s[s.id]);
        el.style.transitionDuration = (fresh ? 0 : (ms || 0)) + 'ms';
        el.style.left = q.x + 'px'; el.style.top = q.y + 'px';
        // On the rightmost column the badges (HUNT, zz) would run off a
        // 390 px screen: hang them off the token's left side instead.
        var nd = def(ui.shown.s[s.id]);
        var maxCol = 0; ui.game.job.nodes.forEach(function (n) { if (n.col > maxCol) maxCol = n.col; });
        el.classList.toggle('flipl', !!nd && nd.col === maxCol);
      }
      if (!ui.playback) {
        el.classList.toggle('stunned', s.stun > 0 || (s.intent && s.intent.type === 'stunned'));
        // What drives its next step rides on the token (never on the arrows).
        var it = s.intent || {};
        var why = st.status !== 'playing' || ui.preBreach ? '' : (it.type === 'wait' && it.why === 'rest') || it.why === 'retreat' ? 'rest'
          : it.type === 'move' && it.why === 'hunt' ? 'HUNT' : it.why === 'noise' ? 'NOISE' : it.why === 'decoy' ? 'LURE' : s.camera ? 'CAM' : '';
        var w = el.querySelector('.why');
        w.textContent = why;
        w.className = 'why' + (why ? ' on' : '') + (why === 'rest' ? ' rest' : '');
      }
    });
    fxb.querySelectorAll('.tok-s').forEach(function (el) { if (!ids[el.getAttribute('data-sentry')]) el.remove(); });
  }

  function onScroll() { if (ui.screen === 'board') { placeFxBoard(); placeWhisper(); placeTip(); } }
  window.addEventListener('scroll', onScroll, { passive: true });

  // Sprites in board-local coordinates (move with the board).
  function spr(cls, x, y, html, life) {
    var el = document.createElement('div');
    el.className = 'spr ' + cls;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (html) el.innerHTML = html;
    fxb.appendChild(el);
    if (life) setTimeout(function () { el.remove(); }, life);
    return el;
  }
  // Sprites in screen coordinates.
  function sprScreen(cls, html, life) {
    var el = document.createElement('div');
    el.className = 'spr spr-screen ' + cls;
    if (html) el.innerHTML = html;
    fx.appendChild(el);
    if (life) setTimeout(function () { el.remove(); }, life);
    return el;
  }
  function tileEl(id) { return app.querySelector('.node[data-node="' + id + '"]'); }
  function flashClass(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function shake(small) {
    var b = app.querySelector('.board');
    [b, fxb].forEach(function (el) {
      if (!el) return;
      el.classList.remove('shake', 'shake-sm'); void el.offsetWidth;
      el.classList.add('shake'); if (small) el.classList.add('shake-sm');
      setTimeout(function () { el.classList.remove('shake', 'shake-sm'); }, 200);
    });
  }
  function banner(text, cls, ms) {
    fx.querySelectorAll('.banner').forEach(function (b) { b.remove(); });
    return sprScreen('banner ' + (cls || ''), '<span>' + esc(text) + '</span>', ms || 1200);
  }
  function stamp(node, text, cls) {
    var g = ui.geo, c = center(g, node);
    return spr('stamp ' + (cls || ''), c.x, c.y, '<span>' + esc(text) + '</span>', 650);
  }
  function ripple(node, cls) {
    var g = ui.geo, c = center(g, node);
    return spr('ripple ' + (cls || ''), c.x, c.y, '', 420);
  }

  // A float that rises 30 px and drifts toward the HEAT bar or the $ counter.
  function floatText(node, text, cls, towards) {
    var g = ui.geo, c = center(g, node);
    var fr = fxb.getBoundingClientRect();
    var sx = fr.left + c.x, sy = fr.top + c.y - g.N * 0.2;
    var el = sprScreen('float ' + (cls || ''), '<span>' + esc(text) + '</span>', 900);
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    var target = towards ? app.querySelector(towards) : null;
    var dx = 0, dy = -30;
    if (target) {
      var tr = target.getBoundingClientRect();
      dx = Math.max(-120, Math.min(120, (tr.left + tr.width / 2 - sx) * 0.35));
      dy = -30;
    }
    el.style.setProperty('--dx', dx + 'px'); el.style.setProperty('--dy', dy + 'px');
    return el;
  }

  function lightHeat(to) {
    var segs = app.querySelectorAll('.h-heat .segs i');
    var from = ui.hudHeat !== null ? ui.hudHeat : to;
    var k = 0;
    for (var i = 0; i < segs.length; i++) {
      var on = i < to;
      if (on && !segs[i].classList.contains('on')) {
        segs[i].classList.add('on'); segs[i].style.background = heatColor(i);
        segs[i].style.animationDelay = (k++ * 60) + 'ms';
        segs[i].classList.add('pop');
      }
    }
    ui.hudHeat = to;
    var b = app.querySelector('.h-heat .k b'); if (b) b.textContent = to;
    var flip = from < to && bandOf(to) > bandOf(from);
    if (bandOf(to) > ui.band) bandUp(bandOf(to));
    return flip;
  }

  // Ghost chip: flash orange 3x and strike through the moment it is lost.
  function checkBonusChip() {
    var met = E.bonusMet(ui.game);
    var b = ui.game.job.bonus;
    if (b && (E.LOSSY_BONUS || ['ghost']).indexOf(b.id) !== -1 && ui.bonusWasMet === true && !met) {
      ui.chipLostAt = Date.now();
      var chip = app.querySelector('[data-chip="bonus"]');
      if (chip) { chip.classList.add('lost'); if (!FAST) chip.classList.add('lose-anim'); }
      sfx('blip200');
    }
    ui.bonusWasMet = met;
  }

  function hitFx(node, kind, amount, total) {
    var g = ui.geo, c = center(g, node);
    spr('sweep', c.x, c.y, '', 360).style.setProperty('--n', g.N + 'px');
    flashClass(tileEl(node), 'hitflash', 360);
    shake(kind === 'bump');
    floatText(node, '+' + amount, 'heat', '.h-heat');
    lightHeat(total);
    sfx(kind === 'bump' ? 'bump' : 'scanHit');
    checkBonusChip();
  }

  // ---------- after render ----------

  function afterBoardRender() {
    var st = ui.game.state;
    syncFx(ui.syncMs || 0);
    ui.syncMs = 0;
    placeWhisper();
    ui.justMoved = null;
    if (ui.intentIn) {
      ui.intentIn = false;
    }
    if (!ui.playback) checkBonusChip();
    if (ui.playback || ui.hudHeat !== null) return;
    // Tension ramp.
    var band = bandOf(st.heat);
    document.body.setAttribute('data-band', band);
    if (breachShown()) document.body.setAttribute('data-breach', '1'); else document.body.removeAttribute('data-breach');
    var tracing = E.tracing(ui.game) && st.status === 'playing';
    if (SFX && !FAST) try { SFX.ambient({ band: band, breach: !!breachShown(), tracing: tracing }); } catch (e) { /* ignore */ }
    // Normally the banner already played inside the sequence (lightHeat);
    // this catches a heat rise that wasn't animated.
    if (band > ui.band) bandUp(band);
    ui.band = band;
  }

  // Heat crossed into a new band: a short banner, played with the heat-bar
  // fill so it's gone (or nearly) by the time you can act again.
  function bandUp(band) {
    var st = ui.game.state;
    ui.band = band;
    if (st.status !== 'playing') return;
    sfx('bandUp');
    ui.pendingBark = (ui.pendingBark || []).concat([{ kind: 'bandUp' }]);
    // A bigger banner (BREACH, TRACE) or the trap toast already has the
    // moment; the HUD, the vignette and the sound still mark the band.
    if (fx.querySelector('.banner')) return;
    inTurn(FAST ? 0 : 900, function () {
      if (ui.screen === 'board' && ui.game.state.status === 'playing' && !fx.querySelector('.banner')) {
        banner(band === 2 ? 'RUNNING HOT' : 'HEAT RISING', 'warmb', 900);
      }
    }, 250);
  }

  // ---------- whisper strip ----------

  var whisperTimers = [];
  function whisper(text) {
    if (!text || ui.screen !== 'board') return;
    whisperTimers.forEach(clearTimeout); whisperTimers = [];
    var old = fx.querySelector('.whisper'); if (old) old.remove();
    var w = document.createElement('div');
    w.className = 'whisper';
    w.innerHTML = '<span class="av">?</span><span class="tx"></span>';
    fx.appendChild(w);
    var tx = w.querySelector('.tx');
    // Place it at its full height (a long line can wrap), then type it.
    tx.textContent = text;
    placeWhisper();
    tx.textContent = '';
    if (FAST || RM) { tx.textContent = text; }
    else {
      for (var i = 1; i <= text.length; i++) (function (i) {
        whisperTimers.push(setTimeout(function () { tx.textContent = text.slice(0, i); if (i % 3 === 1) sfx('aiType'); }, i * 28));
      })(i);
    }
    var life = FAST ? 1500 : text.length * 28 + 4000;
    whisperTimers.push(setTimeout(function () { w.classList.add('out'); }, life));
    whisperTimers.push(setTimeout(function () { w.remove(); }, life + 500));
  }
  // Above the dock, between the board and the feed. When a tall dock leaves
  // no room there, it goes over the header title instead: it must never cover
  // nodes (you may be picking one) or the feed (it says what to do).
  function placeWhisper() {
    var w = fx.querySelector('.whisper'); if (!w) return;
    var dock = app.querySelector('.dock');
    var hdr = app.querySelector('.hdr');
    var top = dock ? dock.getBoundingClientRect().top : window.innerHeight - 200;
    var wh = w.offsetHeight;
    // The lowest node and its badge (8 px below it); the board's own bottom
    // padding may be covered.
    var floor = -Infinity;
    app.querySelectorAll('.board .node').forEach(function (n) { floor = Math.max(floor, n.getBoundingClientRect().bottom); });
    if (top - 4 - wh >= floor + 10 || !hdr) {
      w.style.top = 'auto';
      w.style.bottom = Math.max(8, window.innerHeight - top + 4) + 'px';
    } else {
      var hr = hdr.getBoundingClientRect();
      w.style.bottom = 'auto';
      w.style.top = Math.max(4, hr.top + (hr.height - wh) / 2) + 'px';
    }
  }
  function bark(events) {
    if (!Voice || !ui.game) return;
    var st = ui.game.state;
    var evs = (events || []).concat(ui.pendingBark || []);
    ui.pendingBark = [];
    if (ui.barkTurn === st.turn && st.status === 'playing') return;
    var line = Voice.pickBark(evs);
    if (!line) return;
    ui.barkTurn = st.turn;
    whisper(line);
  }

  // ---------- tips ----------

  var tipEl = null, tipAnchor = null;
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; tipAnchor = null; } }
  function tipCheck() {
    if (ui.screen !== 'board' || ui.busy || ui.overlay || !ui.game || tipEl) return;
    // Don't stack a tip on a banner (BREACH): wait until the banner is gone.
    if (fx.querySelector('.banner')) { if (!ui.tipWait) ui.tipWait = setTimeout(function () { ui.tipWait = null; tipCheck(); }, 250); return; }
    var game = ui.game, st = game.state, job = game.job;
    if (st.status !== 'playing' || !job.tips || !job.tips.length) return;
    var seen = loadTips(); var mine = seen[job.id] || [];
    var near = [st.player].concat(E.neighbors(game, st.player));
    for (var i = 0; i < job.tips.length; i++) {
      var t = job.tips[i];
      if (mine.indexOf(t.when) !== -1) continue;
      var anchor = null;
      if (t.when === 'start' && st.turn === 1) anchor = { node: (ui.moves[0] || st.player) };
      else if (t.when === 'threatNear') {
        var th = st.sentries.filter(function (s) { return s.intent && s.intent.target && near.indexOf(s.intent.target) !== -1; })[0];
        if (th) anchor = { node: th.intent.target };
      } else if (t.when === 'adjBarrier') {
        if ((st.charges.brute || 0) > 0 && st.actions >= E.programCost('brute') && E.neighbors(game, st.player).some(function (n) { return E.isClosed(game, n); })) anchor = { sel: '[data-anchor="prog-brute"]' };
      } else if (t.when === 'hiddenNear') {
        var d = bfsDist(st.player, function (n) { return E.neighbors(game, n); });
        var hid = job.nodes.filter(function (n) { return st.nodes[n.id].hidden && d[n.id] !== undefined && d[n.id] <= 2; })[0];
        if (hid) anchor = st.charges.sniff ? { sel: '[data-anchor="prog-sniff"]' } : { node: hid.id };
      } else if (t.when === 'banked' && st.banked && st.actions === E.ACTIONS_MAX) anchor = { sel: '[data-anchor="pips"]' };
      else if (t.when === 'onTarget' && E.canExtract(game)) anchor = { sel: '[data-anchor="extract"]' };
      else if (t.when === 'breach' && st.breach) anchor = { node: st.exit };
      if (!anchor) continue;
      mine.push(t.when); seen[job.id] = mine; saveTips(seen);
      ui.coachSeen.push(t.when);
      showTip(t, anchor);
      return;
    }
  }
  function showTip(t, anchor) {
    hideTip();
    tipEl = document.createElement('div');
    tipEl.className = 'tipb';
    tipEl.setAttribute('role', 'note');
    tipEl.innerHTML = '<div class="tt">' + t.html + '</div><div class="tx-hint">tap anywhere</div><i class="arrow"></i>';
    fx.appendChild(tipEl);
    tipAnchor = anchor;
    placeTip();
  }
  function anchorRect(a) {
    if (!a) return null;
    if (a.node) { var el = tileEl(a.node); return el ? el.getBoundingClientRect() : null; }
    var e2 = app.querySelector(a.sel); return e2 ? e2.getBoundingClientRect() : null;
  }
  // Puts the bubble above or below its anchor, whichever covers less of
  // what you need to see (legal moves, the anchor, the action buttons).
  function placeTip() {
    if (!tipEl) return;
    var r = anchorRect(tipAnchor);
    if (!r) { hideTip(); return; }
    var vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    var vh = window.innerHeight;
    var w = Math.min(260, vw - 24);
    tipEl.style.width = w + 'px';
    var h = tipEl.offsetHeight;
    var cx = r.left + r.width / 2;
    var left = Math.max(12, Math.min(vw - w - 12, cx - w / 2));
    var avoid = [];
    app.querySelectorAll('.node').forEach(function (n) {
      // A legal move under the bubble is a tap that only dismisses it, so
      // covering one costs far more than covering the feed.
      var wt = n.classList.contains('valid') || n.classList.contains('pick') ? 40 : n.classList.contains('you') ? 4 : 1;
      avoid.push([n.getBoundingClientRect(), wt]);
    });
    // The feed and the threat warning ("scans your node next") must stay readable.
    app.querySelectorAll('.actions, .tray, .feed, .warn:not(.empty)').forEach(function (n) { avoid.push([n.getBoundingClientRect(), 3]); });
    function cost(top) {
      if (top < 4 || top + h > vh - 4) return 1e9;
      var c = 0;
      avoid.forEach(function (a) {
        var q = a[0];
        var ox = Math.max(0, Math.min(left + w, q.right) - Math.max(left, q.left));
        var oy = Math.max(0, Math.min(top + h, q.bottom) - Math.max(top, q.top));
        c += ox * oy * a[1];
      });
      return c;
    }
    var upTop = r.top - h - 12, downTop = r.bottom + 12;
    var above = cost(upTop) <= cost(downTop);
    tipEl.style.left = left + 'px'; tipEl.style.top = (above ? upTop : downTop) + 'px';
    tipEl.classList.toggle('below', !above);
    var ar = tipEl.querySelector('.arrow');
    ar.style.left = Math.max(14, Math.min(w - 14, cx - left)) + 'px';
  }

  // ---------- node info ----------

  function describeNode(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var s = E.sentryAt(game, id);
    var bits = [];
    var info = E.exitInfo(game);
    if (ns.hidden) bits.push(d.label + ': unknown. Loot or a trap. Sniff tells you which; stepping in is final.');
    else if (d.type === 'honeypot') bits.push(d.label + ': honeypot. Entering costs +4 heat' + (ns.sprung ? ' (already tripped).' : '.'));
    else if (d.type === 'firewall') bits.push(d.label + (ns.open ? ': open.' : ': blocks you. Brute opens it (2 actions, loud).'));
    else if (d.type === 'lock') bits.push(d.label + (ns.open ? ': open.' : ': locked. Brute it, or find the password.'));
    else if (d.type === 'ai') bits.push(st.ai.trusted ? 'UNKNOWN: it let you in.' : st.ai.refused ? 'UNKNOWN: closed to you.' : 'UNKNOWN: something is in there. Get next to it.');
    else if (d.type === 'target') bits.push(d.label + (st.hasData ? ': copied. Run for the exit.' : ': the target. Stand on it and Extract.'));
    else if (d.type === 'entry') bits.push(st.breach && E.isBurned(game, id) ? 'ENTRY: burned. You can’t leave this way.' : 'ENTRY: your way in. It burns when you Extract.');
    else bits.push(d.label + '.');
    if (d.cache && !ns.hidden && !st.taken[id]) bits.push(d.cache.kind === 'charge' ? 'Spare ' + E.PROGRAMS[d.cache.prog || 'brute'].name + ' charge here.' : 'Cache: +$100 (+$200 after Extract).');
    if (game.job.exits.indexOf(id) !== -1) {
      if (st.breach && id === st.exit) bits.push('The EXIT. Get here with the data.');
      else if (info.known) bits.push(id === info.exit ? 'BREACH opens this exit.' : 'Not your exit tonight.');
      else bits.push('Possible exit. Sniff or Extract to find out.');
    }
    if (s) {
      var it = s.intent || {};
      var next = it.type === 'move' ? 'next: ' + (it.why === 'hunt' ? 'hunts toward ' : it.why === 'retreat' ? 'backs off to ' : 'moves to ') + lbl(it.target)
        : it.type === 'scan' ? 'next: scans ' + lbl(it.target)
          : it.type === 'stunned' ? 'stunned' : it.why === 'rest' ? 'catching its breath' : 'next: waits';
      if (s.camera) bits.push('Camera ' + s.id + ' never moves. It scans you if you end a turn on a node linked to it' + (it.type === 'wait' ? ' (resting this phase)' : '') + '.');
      else bits.push('Sentry ' + s.id + ' patrols ' + s.loop.map(function (n) { return lbl(n); }).join(' → ') + ', ' + next + '.');
    }
    if (id !== st.player && ui.moves.indexOf(id) === -1 && E.neighbors(game, st.player).indexOf(id) !== -1 && st.actions > 0) {
      bits.push(E.blockedReason(game, id));
    }
    return bits.join(' ');
  }

  // ---------- actions ----------

  var QUIET = { move: 1, program: 1, sentryWait: 1, sentryMove: 1 };
  function feedFrom(events, fallback) {
    var f = events.filter(function (e) { return !QUIET[e.kind] || (e.kind === 'program' && e.prog !== 'brute'); });
    ui.feed = f.length ? f.slice(-2) : (fallback ? [{ kind: 'info', text: fallback }] : []);
  }

  // Player-triggered events: one timeline of big moments.
  function afterAction(res, opts) {
    opts = opts || {};
    var game = ui.game, st = game.state;
    if (!res.ok) { ui.feed = [{ kind: 'err', text: res.reason }]; render(); return; }
    hideTip();
    ui.info = null;
    var ev = res.events;
    feedFrom(ev);
    var heatBefore = opts.heatBefore !== undefined ? opts.heatBefore : st.heat;
    var mv = ev.filter(function (e) { return e.kind === 'move'; })[0];
    var hasExtract = ev.some(function (e) { return e.kind === 'extract'; });
    var steps = [];
    var t = 0;
    if (mv) {
      ui.justMoved = [mv.from, mv.to];
      ui.shown.player = mv.to;
      ui.syncMs = RM ? 0 : 160;
      sfx('move');
      t = 160;
    }
    if (hasExtract) {
      ui.preBreach = true; ui.exitKnownBefore = !!opts.exitKnownBefore;
      // Hold the BREACH lines back until the BREACH beat.
      ui.feedAfter = ui.feed;
      ui.feed = ev.filter(function (e) { return e.kind === 'extract'; });
    }
    if (heatBefore < st.heat) ui.hudHeat = heatBefore;
    // Brute's noise: the Sentries that heard it re-aim, so their arrows ping in.
    if (ev.some(function (e) { return e.kind === 'noise' && e.sentries && e.sentries.length; })) ui.intentIn = true;
    render();
    if (mv) {
      steps.push([t, function () { ripple(mv.to); }]);
      if (breachShown() && mv.from) steps.push([0, function () { trail(mv.from, mv.to); }]);
    }
    var heatNow = heatBefore;
    ev.forEach(function (e) {
      if (e.kind === 'program') {
        var name = e.prog === 'sniff' ? 'sniff' : e.prog === 'brute' ? null : 'program';
        if (name) steps.push([t, function () { sfx(name); }]);
        if (e.prog === 'decoy' && e.lured) steps.push([t + 120, function () { flashToken(e.lured, 'lured'); }]);
        if (e.prog === 'sniff' || e.prog === 'spoof') steps.push([t, function () { ripple(st.player, 'scan'); }]);
      } else if (e.kind === 'reveal') {
        var nodes = e.nodes || (e.node ? [e.node] : []);
        var entered = !!e.node;
        var tt = t;
        nodes.forEach(function (n) {
          var trap = def(n).type === 'honeypot';
          steps.push([tt, function () { revealFx(n, trap, entered); }]);
        });
        if (e.trap && entered) {
          steps.push([tt, function () {
            document.body.classList.add('tint'); setTimeout(function () { document.body.classList.remove('tint'); }, 120);
            sfx('honeypot'); inTurn(FAST ? 0 : 1600, function () { toast('NO TAKE-BACKS', 'threat'); });
          }]);
        }
        t += e.trap ? 420 : 220;
      } else if (e.kind === 'heat') {
        heatNow = e.total;
        (function (total, amount, node) {
          steps.push([Math.max(0, t - 200), function () { if (node) floatText(node, '+' + amount, 'heat', '.h-heat'); lightHeat(total); }]);
        })(e.total, e.amount, e.node || st.player);
      } else if (e.kind === 'cache') {
        steps.push([t, function () {
          floatText(e.node, e.charge ? '+1 ' + E.PROGRAMS[e.charge].name.toUpperCase() : '+$' + e.value + (e.hot ? ' HOT' : ''), 'gold', e.charge ? '[data-anchor="prog-' + e.charge + '"]' : '.h-pay');
          sfx('cache');
          var c = app.querySelector('.h-pay'); flashClass(c, 'pop', 400);
        }]);
        t += 300;
      } else if (e.kind === 'open') {
        if (e.by === 'brute') { steps.push([t, function () { shardsFx(e.node); sfx('brute'); }]); t += 350; }
      } else if (e.kind === 'clue') {
        steps.push([t, function () { ripple(e.node, 'gold'); sfx('program'); }]);
        t += 200;
      } else if (e.kind === 'noise') {
        steps.push([t, function () { noiseFx(e.node, e.sentries || []); }]);
        t += 320;
      } else if (e.kind === 'exitKnown') {
        steps.push([t, function () { exitFlash(e.exit); }]);
        t += 400;
      } else if (e.kind === 'extract') {
        steps.push([t, function () { extractFx(e.node); }]);
        // DATA ACQUIRED lands at 700 ms; when the freeze offer follows, move on
        // as soon as it does so the hands-off stretch stays short.
        t += st.ai && st.ai.pending ? 800 : 1100;
      } else if (e.kind === 'breach') {
        steps.push([t, function () { breachFx(e); }]);
        t += st.ai && st.ai.pending ? 250 : 650; // an offer follows: don't hold as long
      } else if (e.kind === 'stun') {
        steps.push([t, function () { flashToken(e.sentry, 'stunfx'); }]);
        t += 60;
      } else if (e.kind === 'ai') {
        steps.push([t, function () { sfx('ai'); }]);
      }
    });
    var ended = st.status !== 'playing';
    // A program with no move still gets its beat (sound, haptic, ripple, lure
    // flash): its steps sit at t = 0, so give the sequence a minimum length.
    var total = Math.max(t, (mv || steps.length) ? 200 : 0);
    var done = function () {
      ui.preBreach = false; ui.hudHeat = null;
      if (ui.feedAfter) { ui.feed = ui.feedAfter; ui.feedAfter = null; }
      render();
      if (ended) { endSequence(ev); return; }
      bark(ev);
      if (st.ai && st.ai.pending) { openOffer(); return; }
      tipCheck();
    };
    if (steps.length === 0 && !mv) { done(); return; }
    // Plain moves don't lock input: the slide is cosmetic.
    if (!hasExtract && !ended && steps.length <= 1 && !(st.ai && st.ai.pending) && heatNow === heatBefore && !ev.some(function (e) { return e.kind === 'reveal' || e.kind === 'cache' || e.kind === 'open' || e.kind === 'noise' || e.kind === 'exitKnown'; })) {
      steps.forEach(function (s) { setTimeout(s[1], FAST ? 0 : s[0]); });
      ui.preBreach = false; ui.hudHeat = null;
      bark(ev);
      tipCheck();
      return;
    }
    runSeq(steps, total, done);
  }

  function trail(a, b) {
    if (FAST) return;
    var g = ui.geo, p = center(g, a), q = center(g, b);
    var len = Math.sqrt(Math.pow(q.x - p.x, 2) + Math.pow(q.y - p.y, 2));
    var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    var el = spr('trail', p.x, p.y, '', 1300);
    el.style.width = len + 'px';
    el.style.setProperty('--ang', ang + 'deg');
    el.style.rotate = ang + 'deg';
  }
  function flashToken(id, cls) {
    var el = fxb.querySelector('.tok-s[data-sentry="' + id + '"]');
    flashClass(el, cls, 600);
  }
  function revealFx(n, trap, entered) {
    var el = tileEl(n);
    if (trap) {
      flashClass(el, 'flip', 400);
      var g = ui.geo, c = center(g, n);
      var s = spr('trapglitch', c.x, c.y, '<span>#!%</span>', 420);
      var glyphs = '#!%&?$@*<>/\\=+';
      var span = s.querySelector('span');
      [60, 120, 180].forEach(function (ms, i) {
        setTimeout(function () {
          if (i === 2) { span.textContent = 'TRAP'; return; }
          var r = ''; for (var k = 0; k < 4; k++) r += glyphs[Math.floor(Math.random() * glyphs.length)];
          span.textContent = r;
        }, ms);
      });
    } else {
      flashClass(el, 'revealed', 500);
      ripple(n, 'gold');
    }
  }
  function shardsFx(node) {
    var g = ui.geo, c = center(g, node);
    var polys = ['0 0,60% 0,30% 50%', '60% 0,100% 0,100% 40%,50% 45%', '0 0,30% 50%,0 70%', '100% 40%,100% 100%,55% 60%', '0 70%,30% 50%,55% 60%,40% 100%,0 100%', '55% 60%,100% 100%,40% 100%'];
    polys.forEach(function (pp, i) {
      var a = (i / polys.length) * Math.PI * 2 + 0.4;
      var d = 20 + Math.random() * 20;
      var s = spr('shard', c.x - g.N / 2, c.y - g.N / 2, '', 420);
      s.style.width = g.N + 'px'; s.style.height = g.N + 'px';
      s.style.clipPath = 'polygon(' + pp + ')';
      s.style.setProperty('--sx', (Math.cos(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--sy', (Math.sin(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--sr', ((Math.random() * 60) - 30).toFixed(0) + 'deg');
    });
  }
  function noiseFx(node, heard) {
    var game = ui.game;
    var d = bfsDist(node, function (n) { return E.neighbors(game, n).concat(game.job.links.filter(function (l) { return l[0] === n || l[1] === n; }).map(function (l) { return l[0] === n ? l[1] : l[0]; })); });
    sfx('noise');
    Object.keys(d).forEach(function (n) {
      if (d[n] < 1 || d[n] > 3) return;
      setTimeout(function () { ripple(n, 'noise'); }, d[n] * 80);
    });
    heard.forEach(function (sid) { setTimeout(function () { flashToken(sid, 'lured'); }, 260); });
  }
  function exitFlash(exit) {
    flashClass(tileEl(exit), 'exitflash', 900);
    var g = ui.geo, c = center(g, exit);
    spr('stamp gold small', c.x, c.y - g.N / 2 - 4, '<span>YOUR EXIT</span>', 1200);
  }
  function extractFx(node) {
    var g = ui.geo, t = tile(g, node);
    var bar = spr('dlbar', t.x - 6, t.y + t.N + 12, '<i></i><b>0%</b>', 960);
    bar.style.width = (t.N + 12) + 'px';
    var b = bar.querySelector('b');
    for (var k = 1; k <= 10; k++) (function (k) { setTimeout(function () { b.textContent = (k * 10) + '%'; }, k * 70); })(k);
    setTimeout(function () {
      var c = center(g, node);
      var x = Math.max(110, Math.min(g.W - 110, c.x));
      spr('stamp gold big', x, c.y, '<span>DATA ACQUIRED</span>', 900);
      sfx('extract');
    }, 700);
  }
  function breachFx(e) {
    fxb.querySelectorAll('.stamp.big').forEach(function (x) { x.remove(); });
    if (ui.feedAfter) { ui.feed = ui.feedAfter; ui.feedAfter = null; }
    ui.preBreach = false;
    ui.hudHeat = null;
    render();
    shake(false);
    sfx('breach');
    banner('BREACH: run for the exit', 'breachb', 1200);
    if (e.exit) flashClass(tileEl(e.exit), 'exitflash', 900);
  }

  // Win / lose sequences, then the result screen.
  function endSequence(events) {
    var game = ui.game, st = game.state;
    hideTip();
    if (st.status === 'won') {
      var exit = st.player;
      var d = bfsDist(exit, function (n) { return E.neighbors(game, n); });
      var steps = [];
      steps.push([0, function () {
        sfx('win');
        flashClass(tileEl(exit), 'exitflash', 900);
        app.querySelectorAll('.board line.lk').forEach(function (ln) {
          var k = Math.min(d[ln.getAttribute('data-a')] || 0, d[ln.getAttribute('data-b')] || 0);
          setTimeout(function () { ln.classList.add('cyanflash'); }, k * 40);
        });
        var b = banner('', 'winb', 1500);
        var span = b.querySelector('span');
        var text = 'DISCONNECTED CLEAN';
        for (var i = 1; i <= text.length; i++) (function (i) { setTimeout(function () { span.textContent = text.slice(0, i); }, 200 + i * 30); })(i);
      }]);
      runSeq(steps, 1400, finishJob);
      return;
    }
    if (st.reason === 'traced') {
      var steps2 = [[0, function () {
        sfx('traced');
        var g = ui.geo, me = center(g, st.player);
        var svg = '<svg width="' + g.W + '" height="' + g.H + '">';
        st.sentries.forEach(function (s) {
          var p = center(g, s.pos);
          var len = Math.sqrt(Math.pow(me.x - p.x, 2) + Math.pow(me.y - p.y, 2));
          svg += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + me.x + '" y2="' + me.y + '" style="--len:' + len.toFixed(0) + '"/>';
        });
        svg += '</svg>';
        spr('tracelines', 0, 0, svg, 1300);
        var ip = sprScreen('ipread', '<small>TRACE COMPLETE</small><b>···.···.···.···</b>', 1300);
        var target = '10.' + (10 + Math.floor(Math.random() * 240)) + '.' + Math.floor(Math.random() * 250) + '.' + (2 + Math.floor(Math.random() * 250));
        var b = ip.querySelector('b');
        for (var k = 1; k <= target.length; k++) (function (k) {
          setTimeout(function () {
            var s = target.slice(0, k);
            for (var j = k; j < target.length; j++) s += target[j] === '.' ? '.' : String.fromCharCode(48 + Math.floor(Math.random() * 10));
            b.textContent = s;
          }, 150 + k * (600 / target.length));
        })(k);
      }], [900, function () { sprScreen('static', '', 260); }]];
      runSeq(steps2, 1150, finishJob);
      return;
    }
    if (st.reason === 'dropped') {
      runSeq([[0, function () { banner('CONNECTION DROPPED', 'loseb', 900); sfx('starMiss'); }], [600, function () { sprScreen('static', '', 260); }]], 900, finishJob);
      return;
    }
    finishJob();
  }

  // ---------- enemy phase ----------

  function onEnd() {
    var game = ui.game, st = game.state;
    ui.selected = null; ui.info = null;
    hideTip();
    var before = { heat: st.heat, turn: st.turn, pos: {} };
    st.sentries.forEach(function (s) { before.pos[s.id] = s.pos; });
    // While the phase plays, the HUD and feed show the turn as it was; the
    // outcome lands when the animation shows it.
    var hold = { turn: st.turn, total: E.payout(game).total, trace: E.tracing(game), feed: ui.feed };
    var res = E.endTurn(game);
    if (!res.ok) { ui.feed = [{ kind: 'err', text: res.reason }]; render(); return; }
    st = game.state;
    var events = res.events;
    if (!ui.firstSeen) {
      var hit = events.filter(function (e) { return e.kind === 'heat' && (e.cause === 'scan' || e.cause === 'bump'); })[0];
      if (hit) ui.firstSeen = { sentry: hit.sentry, turn: before.turn, kind: hit.cause };
    }
    // Feed: what hit you, or a one-line summary of a quiet phase.
    var hits = events.filter(function (e) { return (e.kind === 'heat') || e.kind === 'dodge' || e.kind === 'miss' || e.kind === 'stun' || e.kind === 'traceStart' || e.kind === 'lose' || e.kind === 'sentry'; });
    var summary = summarize(events);
    var gotHit = events.some(function (e) { return e.kind === 'heat' && (e.cause === 'scan' || e.cause === 'bump'); });
    var newFeed = gotHit ? hits.slice(-2)
      : [{ kind: 'info', text: summary || 'Quiet turn.' }].concat(hits.filter(function (e) { return e.kind !== 'sentry'; }).slice(-1));
    ui.feed = hold.feed;
    ui.hold = hold;

    ui.playback = true;
    ui.hudHeat = before.heat;
    ui.shown.s = before.pos;
    render();

    var steps = [];
    var t = 0;
    steps.push([0, function () { sprScreenBoard('scanline', 160); }]);
    t = 120;
    // Group enemy events by Sentry, in order.
    var groups = [];
    var cur = null;
    events.forEach(function (e) {
      if (e.phase === 'upkeep') return;
      var sid = e.sentry || (cur && cur.sid);
      if (!cur || (e.sentry && e.sentry !== cur.sid)) { cur = { sid: sid, evs: [] }; groups.push(cur); }
      cur.evs.push(e);
    });
    groups.forEach(function (gr) {
      var beat = 280;
      gr.evs.forEach(function (e) {
        if (e.kind === 'sentryMove') {
          steps.push([t, function () { ui.shown.s[e.sentry] = e.to; syncFx(RM ? 0 : 220, e.sentry); sfx('footstep'); }]);
        } else if (e.kind === 'scan') {
          steps.push([t, function () {
            var g = ui.geo, c = center(g, e.node);
            spr('scanring', c.x, c.y, '', 300).style.setProperty('--n', g.N + 'px');
            sfx('tick');
          }]);
        } else if (e.kind === 'bump') {
          steps.push([t, function () { lunge(e.sentry, e.node); }]);
        } else if (e.kind === 'heat') {
          var off = e.cause === 'bump' ? 120 : 180;
          steps.push([t + off, function () { hitFx(e.node || st.player, e.cause, e.amount, e.total); }]);
          beat = Math.max(beat, off + 260);
        } else if (e.kind === 'dodge') {
          steps.push([t + 200, function () { stamp(e.node, 'DODGED', 'you'); sfx('dodge'); }]);
          beat = Math.max(beat, 420);
        } else if (e.kind === 'miss') {
          steps.push([t + 180, function () { stamp(e.node, 'SPOOFED', 'you'); sfx('dodge'); }]);
          beat = Math.max(beat, 420);
        } else if (e.kind === 'stun') {
          steps.push([t + 200, function () { var el = fxb.querySelector('.tok-s[data-sentry="' + e.sentry + '"]'); if (el) el.classList.add('stunned'); flashToken(e.sentry, 'stunfx'); sfx('program'); }]);
          beat = Math.max(beat, 400);
        } else if (e.kind === 'sentry' && e.wiped) {
          steps.push([t + 150, function () { stamp(e.wiped, 'WIPED', 'threat'); }]);
        }
      });
      t += beat;
    });
    // Upkeep beat.
    var up = events.filter(function (e) { return e.phase === 'upkeep'; });
    if (up.length) {
      up.forEach(function (e) {
        if (e.kind === 'traceStart') steps.push([t, function () { banner('TRACE: +1 heat every turn', 'warmb', 1200); }]);
        if (e.kind === 'heat') steps.push([t + 60, function () { floatText(st.player, '+1', 'heat', '.h-heat'); lightHeat(e.total); sfx('tick'); }]);
      });
      t += 200;
    }
    t += 250;
    var ended = st.status !== 'playing';
    var done = function () {
      ui.playback = false;
      ui.hudHeat = null;
      ui.hold = null;
      ui.feed = newFeed;
      ui.shown.s = {};
      st.sentries.forEach(function (s) { ui.shown.s[s.id] = s.pos; });
      if (ended) { render(); endSequence(events); return; }
      ui.intentIn = !skipping;
      render();
      if (!skipping && !FAST) {
        (ui.intentOrder || []).forEach(function (mine, i) {
          setTimeout(function () { sfx(mine ? 'ping' : 'tick'); }, i * 120);
        });
      }
      skipping = false;
      bark(events);
      tipCheck();
    };
    runSeq(steps, t, done);
  }
  var skipping = false;

  function sprScreenBoard(cls, life) {
    var g = ui.geo;
    var el = spr(cls, 0, 0, '', life);
    el.style.width = g.W + 'px'; el.style.height = g.H + 'px';
    return el;
  }

  function lunge(sid, node) {
    var el = fxb.querySelector('.tok-s[data-sentry="' + sid + '"]');
    if (!el || RM || !el.animate) return;
    var a = tokenPos('s', ui.shown.s[sid]), b = tokenPos('s', node);
    var dx = (b.x - a.x) * 0.4, dy = (b.y - a.y) * 0.4;
    el.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }], { duration: 180, easing: 'ease-in-out' });
  }

  function summarize(events) {
    var per = {};
    var order = [];
    events.forEach(function (e) {
      if (e.phase !== 'enemy' || !e.sentry) return;
      if (!per[e.sentry]) { per[e.sentry] = null; order.push(e.sentry); }
      if (e.kind === 'sentryMove') per[e.sentry] = e.sentry + ' → ' + lbl(e.to);
      else if (e.kind === 'scan') per[e.sentry] = e.sentry + ' scans ' + lbl(e.node);
      else if (e.kind === 'bump') per[e.sentry] = e.sentry + ' bumps you';
      else if (e.kind === 'sentryWait' && !per[e.sentry]) per[e.sentry] = e.sentry + (e.why === 'stunned' ? ' is stunned' : e.why === 'rest' ? ' rests' : e.why === 'blocked' ? ' is blocked' : ' waits');
    });
    return order.map(function (s) { return per[s]; }).filter(Boolean).join(' · ');
  }

  // ---------- player input ----------

  function onNode(id) {
    var game = ui.game, heat = game.state.heat;
    if (ui.selected) {
      if (ui.picks.indexOf(id) !== -1) {
        var p = ui.selected; ui.selected = null;
        afterAction(E.runProgram(game, p, id), { heatBefore: heat });
      } else {
        ui.info = id;
        ui.feed = [{ kind: 'info', text: describeNode(id) }];
        render();
      }
      return;
    }
    if (ui.moves.indexOf(id) !== -1) { afterAction(E.move(game, id), { heatBefore: heat }); return; }
    ui.info = ui.info === id ? null : id;
    ui.feed = ui.info ? [{ kind: 'info', text: describeNode(id) }] : [];
    render();
  }

  function onProgram(p) {
    var game = ui.game, st = game.state, heat = st.heat;
    var info = E.PROGRAMS[p];
    if (!st.charges[p]) { ui.feed = [{ kind: 'err', text: info.name + ' is used up for this job.' }]; render(); return; }
    var blocked = E.canAct(game);
    if (blocked) { ui.feed = [{ kind: 'err', text: blocked }]; render(); return; }
    var cost = E.programCost(p);
    if (st.actions < cost) { ui.selected = null; ui.feed = [{ kind: 'err', text: info.name + ' needs ' + cost + ' actions. You have ' + st.actions + '. Hold to bank one.' }]; render(); return; }
    if (info.target === 'self') {
      ui.selected = null;
      if (p === 'spoof' && st.spoof) { ui.feed = [{ kind: 'err', text: 'Spoof is already running this turn.' }]; render(); return; }
      var pre = { heatBefore: heat, exitKnownBefore: st.exitKnown };
      afterAction(E.runProgram(game, p), pre);
      return;
    }
    if (ui.selected === p) { ui.selected = null; ui.feed = []; render(); return; }
    var targets = E.programTargets(game, p);
    if (!targets.length) {
      ui.selected = null;
      ui.feed = [{ kind: 'err', text: p === 'brute' ? 'Brute needs a closed lock or firewall linked to your node.' : info.name + ' needs an empty node linked to yours.' }];
      render(); return;
    }
    ui.selected = p;
    ui.info = null;
    ui.feed = [{ kind: 'info', text: info.name + ': ' + info.desc + (cost > 1 ? ' Costs ' + cost + ' actions.' : '') }];
    render();
  }

  // ---------- AI offer ----------

  function offerDef() {
    var st = ui.game.state, job = ui.game.job;
    var id = st.ai && st.ai.pending;
    var offers = (job.ai && job.ai.offers) || [];
    for (var i = 0; i < offers.length; i++) {
      if (offers[i].id === id) return { id: id, voice: offers[i].voice, terms: E.offerTerms ? E.offerTerms(ui.game, id) : offers[i].terms };
    }
    return { id: id, voice: job.ai ? job.ai.offer : '', terms: '' };
  }

  function openOffer() {
    var game = ui.game;
    if (!game.state.ai || !game.state.ai.pending) return;
    hideTip();
    var o = offerDef();
    // A tap that skipped the beat before this one (Extract) skips the intro too.
    var instant = FAST || skipping;
    ui.offerTyped = instant ? o.voice.length : 0;
    if (instant) { document.body.classList.remove('glitch'); ui.overlay = 'ai'; render(); return; }
    var steps = [];
    // The freeze offer follows Extract's own beat (download, DATA ACQUIRED,
    // BREACH), so its intro is clipped: no banner hold (the BREACH banner
    // keeps playing behind the sheet), a shorter glitch and faster typing.
    // Extract to the offer buttons takes about 2.2 s hands-off; any tap skips
    // straight to the end of whichever beat is playing.
    var quick = o.id === 'freeze';
    var GL = quick ? 250 : 600, CH = quick ? 12 : 28;
    // Let a BREACH banner land first.
    var d0 = fx.querySelector('.banner') && !quick ? 650 : 0;
    // Glitch (600 ms, 350 when quick): the violet node pulses, links flicker violet, RGB split.
    steps.push([d0, function () {
      document.body.classList.add('glitch');
      sfx('ai');
      var aiNode = game.job.ai && game.job.ai.node;
      if (aiNode) flashClass(tileEl(aiNode), 'aipulse', GL + 100);
      app.querySelectorAll('.board line.lk').forEach(function (ln, i) { if (i % 2 === 0) flashClass(ln, 'vflicker', GL); });
    }]);
    steps.push([d0 + GL, function () {
      document.body.classList.remove('glitch');
      ui.overlay = 'ai'; ui.offerTyped = 0; render();
    }]);
    var text = o.voice;
    for (var i = 1; i <= text.length; i++) (function (i) {
      steps.push([d0 + GL + i * CH, function () {
        ui.offerTyped = i;
        var tx = app.querySelector('.ai-offer .tx .typed'); if (tx) tx.textContent = text.slice(0, i);
        if (i % 3 === 0) sfx('aiType');
      }]);
    })(i);
    runSeq(steps, d0 + GL + text.length * CH + 60, function () {
      document.body.classList.remove('glitch');
      ui.offerTyped = text.length;
      ui.overlay = 'ai';
      render();
    });
  }

  // ---------- overlays ----------

  function renderOverlay() {
    var o = ui.overlay;
    if (!o) return '';
    var job = ui.screen === 'board' && ui.game ? ui.game.job : jobById(ui.jobId) || JOBS[0];
    var h = '<div class="overlay' + (o === 'ai' ? ' ai-ov' : '') + '" data-act="' + (o === 'ai' ? '' : 'close-overlay') + '">';
    if (o === 'ai') {
      var off = offerDef();
      var done = ui.offerTyped >= off.voice.length;
      h += '<div class="sheet violet" role="dialog" aria-label="UNKNOWN makes an offer" data-act="">' +
        '<div class="kicker" style="color:var(--ai)">INCOMING · UNKNOWN</div>' +
        '<div class="ai-offer"><div class="av">?</div><div class="tx"><span class="typed">' + esc(off.voice.slice(0, ui.offerTyped)) + '</span><i class="cursor' + (done ? ' blink' : '') + '"></i></div></div>' +
        (done ? '<p class="terms">' + esc(off.terms) + '<br>Refuse: costs nothing.</p>' +
          '<div class="row"><button class="btn" data-act="ai-refuse">Refuse</button><button class="btn violet" data-act="ai-trust">Trust it</button></div>' : '<p class="terms tap">tap to skip</p>') +
        '</div>';
    } else if (o === 'abort') {
      h += '<div class="sheet" role="dialog" aria-label="Abort job" data-act="">' +
        '<div class="title">Abort this job?</div><p>It counts as a failed run in the playtest log.</p>' +
        '<div class="row"><button class="btn" data-act="close-overlay">Keep going</button><button class="btn primary" data-act="abort-yes">ABORT</button></div></div>';
    } else if (o === 'help') {
      h += '<div class="sheet" role="dialog" aria-label="How to play" data-act="">' +
        '<div class="title">How to play</div>' +
        '<ol class="tips">' + (job.rules || []).map(function (t) { return '<li class="card"><span>' + t + '</span></li>'; }).join('') + '</ol>' +
        programRows(job) +
        '<p>Heat: scanned +3, bumped +2, honeypot +4, Brute +1, Extract +1, and +1 every turn once the trace starts. Tap any node to see what it is.</p>' +
        '<button class="btn primary" data-act="close-overlay">' + (ui.screen === 'board' ? 'BACK TO THE JOB' : 'GOT IT') + '</button></div>';
    }
    return h + '</div>';
  }

  function programRows(job) {
    var h = '<div class="prog-list">';
    E.PROGRAM_ORDER.forEach(function (p) {
      if (!job.programs[p]) return;
      var cost = E.programCost(p);
      h += '<div class="card prog-row">' + icon(p, 18) + '<b>' + E.PROGRAMS[p].name + ' ×' + job.programs[p] + '</b><span>' + E.PROGRAMS[p].desc + (cost > 1 && E.PROGRAMS[p].desc.indexOf(cost + ' actions') === -1 ? ' (' + cost + ' actions)' : '') + '</span></div>';
    });
    return h + '</div>';
  }

  // ---------- event wiring ----------

  var swallowUntil = 0; // clicks right after a tap that skipped a sequence
  var decisionGuardUntil = 0; // UNKNOWN's Trust/Refuse after a skip reached them
  var swallowTap = false; // the click that ends a tap on a tip bubble
  document.addEventListener('click', function (e) {
    if (!swallowTap) return;
    swallowTap = false;
    e.stopPropagation(); e.preventDefault();
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (!ui.unlocked && SFX) { ui.unlocked = true; try { SFX.unlock(); } catch (err) { /* ignore */ } }
    var hadTip = !!tipEl;
    // A tap on the bubble itself only dismisses it: the bubble can sit over
    // the program tray, and a dismissing tap must not run what's under it.
    swallowTap = false;
    if (hadTip && e.clientX !== undefined) {
      var tr = tipEl.getBoundingClientRect();
      if (e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom) swallowTap = true;
      // ...unless it lands on a legal node peeking out from under it: that tap
      // is a move (the bubble sits in #fx, so the node gets the click).
      if (swallowTap) {
        var hit = document.elementFromPoint(e.clientX, e.clientY);
        var nd = hit && hit.closest ? hit.closest('.node') : null;
        if (nd && (nd.classList.contains('valid') || nd.classList.contains('pick'))) swallowTap = false;
      }
    }
    hideTip();
    if (hadTip && ui.helloLater) { var h = ui.helloLater; ui.helloLater = null; setTimeout(h, 900); }
    var now = Date.now();
    if (seq) {
      skipping = true;
      skipSeq();
      skipping = false;
      swallowUntil = now + 450;
      // A skip that lands on UNKNOWN's buttons locks them briefly, so the
      // rest of a mash can't answer an irreversible offer by accident.
      if (ui.overlay === 'ai') decisionGuardUntil = now + 600;
    } else if (now < swallowUntil || now < decisionGuardUntil) {
      // Still mashing: every tap inside the window is eaten and keeps it
      // open a little longer, so input resumes once the taps stop.
      if (now < swallowUntil) swallowUntil = Math.max(swallowUntil, now + 300);
      if (now < decisionGuardUntil) decisionGuardUntil = Math.max(decisionGuardUntil, now + 400);
    }
  }, true);

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    if (Date.now() < swallowUntil) { e.stopPropagation(); return; }
    var act0 = el.getAttribute('data-act');
    if ((act0 === 'ai-trust' || act0 === 'ai-refuse') && Date.now() < decisionGuardUntil) { e.stopPropagation(); return; }
    if (ui.busy) return;
    var act = el.getAttribute('data-act');
    if (act === '') { e.stopPropagation(); return; }
    if (el.getAttribute('aria-disabled') === 'true' && act !== 'prog') return;
    switch (act) {
      case 'node': onNode(el.getAttribute('data-node')); return;
      case 'prog': onProgram(el.getAttribute('data-prog')); return;
      case 'undo': {
        var from = ui.game.state.player;
        var r = E.undo(ui.game); ui.selected = null; ui.info = null;
        ui.feed = r.ok ? [{ kind: 'info', text: 'Undone.' }] : [{ kind: 'err', text: r.reason }];
        if (r.ok) {
          ui.shown.player = ui.game.state.player;
          ui.syncMs = from !== ui.game.state.player && !RM ? 120 : 0;
          ui.shown.s = {};
          sfx('undo');
        }
        hideTip();
        render(); return;
      }
      case 'extract': {
        var st = ui.game.state;
        var pre = { heatBefore: st.heat, exitKnownBefore: st.exitKnown };
        afterAction(E.extract(ui.game), pre);
        return;
      }
      case 'end': onEnd(); return;
      case 'ai-trust': case 'ai-refuse': {
        var heat = ui.game.state.heat;
        var res = E.answerAI(ui.game, act === 'ai-trust');
        ui.overlay = null;
        afterAction(res, { heatBefore: heat });
        return;
      }
      case 'mute': {
        if (SFX) { SFX.setMuted(!SFX.isMuted()); if (!SFX.isMuted()) sfx('tick'); }
        render(); return;
      }
      case 'abort': ui.overlay = 'abort'; render(); return;
      case 'abort-yes': E.abort(ui.game); ui.overlay = null; finishJob(); return;
      case 'help': ui.overlay = 'help'; render(); return;
      case 'close-overlay':
        if (e.target !== el && el.classList.contains('overlay')) return;
        ui.overlay = null; render(); if (ui.screen === 'board') tipCheck(); return;
    }
    doCmd(Meta.onAct(act, el));
  });

  var lastW = 0;
  window.addEventListener('resize', function () {
    var w = app.clientWidth;
    if (ui.screen !== 'board') return;
    if (w !== lastW && !ui.busy) { lastW = w; render(); }
    else { placeFxBoard(); placeWhisper(); placeTip(); }
  });

  // Debug hook for automated checks.
  window.__backdoor = {
    ui: ui,
    fast: FAST,
    render: render,
    game: function () { return ui.game; },
    skip: skipSeq,
    busy: function () { return ui.busy; },
    startJob: function (jobIndex, variantIndex) {
      var job = JOBS[jobIndex || 0];
      var t = VARS && VARS[job.id];
      var i = variantIndex || 0;
      var pick;
      if (t && t.variants && t.variants[i]) {
        pick = { jobId: job.id, index: i, variant: t.variants[i], par: t.par, label: (i === 0 ? 'Canonical night' : 'Night #' + (i < 10 ? '0' : '') + i) };
      } else {
        pick = Meta.pick(job.id, 'canonical');
      }
      startJob(pick);
    }
  };

  render();
})();
