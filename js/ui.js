/*
 * Backdoor prototype UI. Renders screens as HTML strings into #app and wires
 * events with delegation (data-act attributes). All rules live in engine.js.
 */
(function () {
  var E = window.BackdoorEngine;
  var JOBS = window.BACKDOOR_JOBS;
  var icon = window.BackdoorIcons.icon;
  var app = document.getElementById('app');
  var STORE_KEY = 'backdoor.proto.v1';

  var ui = {
    screen: 'select',   // select | intro | board | result
    job: null,
    game: null,
    selected: null,     // targeted program waiting for a node
    info: null,         // node id the player tapped for info
    feed: [],
    overlay: null,      // ai | abort | help | log | clear
    busy: false,
    prevSentry: {},
    run: null           // run record shown on the result screen
  };

  // ---------- storage ----------

  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.best && s.runs) return s;
    } catch (e) { /* ignore */ }
    return { best: {}, runs: [], seenIntro: {} };
  }
  var store = loadStore();
  if (!store.seenIntro) store.seenIntro = {};
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function def(id) { return E.nodeDef(ui.job, id); }
  function jobIndex(job) { return JOBS.indexOf(job); }
  function starIcons(n, size) {
    var out = '<span class="stars" aria-label="' + n + ' of 3 stars">';
    for (var i = 0; i < 3; i++) out += '<span class="' + (i < n ? 'on' : '') + '">' + icon('star', size || 14) + '</span>';
    return out + '</span>';
  }
  function heatColor(i) {
    var c = ['#FFB25E', '#FFA74F', '#FF9F43', '#FF923D', '#FF8A3D', '#FF7A38', '#FF6A35', '#FF5A33', '#FF4A31', '#FF3B30'];
    return c[i];
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  // ---------- screens ----------

  function render() {
    var html = '';
    if (ui.screen === 'select') html = renderSelect();
    else if (ui.screen === 'intro') html = renderIntro();
    else if (ui.screen === 'board') html = renderBoard();
    else if (ui.screen === 'result') html = renderResult();
    html += renderOverlay();
    app.innerHTML = html;
    if (ui.screen === 'board') animateSentries();
  }

  function renderSelect() {
    var h = '<div class="screen">';
    h += '<div class="brand"><div class="logo">BACK<span>DOOR</span></div><div class="sub">HACKING MINIGAME \u00b7 PROTOTYPE</div></div>';
    h += '<div class="kicker">Job board</div>';
    JOBS.forEach(function (job) {
      var best = store.best[job.id] || 0;
      var runs = store.runs.filter(function (r) { return r.job === job.id; }).length;
      h += '<button class="card job-card" data-act="pick" data-job="' + job.id + '">' +
        '<div class="row"><span class="kicker">JOB ' + job.number + '</span>' + starIcons(best) + '</div>' +
        '<div class="name">' + esc(job.name) + '</div>' +
        '<div class="tag">' + esc(job.tagline) + '</div>' +
        '<div class="meta">' + job.turnLimit + ' turns · ' + job.sentries.length + ' Sentr' + (job.sentries.length > 1 ? 'ies' : 'y') +
        ' · played ' + runs + '×</div></button>';
    });
    h += '<div class="footer-links">' +
      '<button class="btn" data-act="log">Playtest log (' + store.runs.length + ')</button>' +
      '</div>';
    h += '<p class="note">Throwaway prototype. Progress and the playtest log are saved in this browser only.</p>';
    return h + '</div>';
  }

  function programRows(job) {
    var h = '<div class="prog-list">';
    E.PROGRAM_ORDER.forEach(function (p) {
      if (!job.programs[p]) return;
      h += '<div class="card prog-row">' + icon(p, 18) + '<b>' + E.PROGRAMS[p].name + ' ×' + job.programs[p] + '</b><span>' + E.PROGRAMS[p].desc + '</span></div>';
    });
    return h + '</div>';
  }

  function renderIntro() {
    var job = ui.job;
    var h = '<div class="screen">';
    h += '<div class="hdr"><button class="icon-btn" data-act="home" aria-label="Back to job board">' + icon('close') + '</button>' +
      '<div class="mid"><div class="kicker">JOB ' + job.number + ' · BRIEFING</div><div class="title">' + esc(job.name) + '</div></div></div>';
    h += '<div class="chips"><div class="chip gold">◆ ' + esc(job.goal) + '</div><div class="chip">Exit at ENTRY</div><div class="chip">' + job.turnLimit + ' turns</div></div>';
    h += '<ol class="tips">' + job.tips.map(function (t) { return '<li class="card">' + t + '</li>'; }).join('') + '</ol>';
    h += '<div class="kicker">Programs this job</div>' + programRows(job);
    h += '<div class="kicker" style="margin-top:4px">Stars</div><div class="card prog-row"><span>1 for getting out with the data, 1 for finishing at heat ' + E.STAR_HEAT + ' or less, 1 for never being scanned or bumped.</span></div>';
    h += '<div style="margin-top:auto;padding-top:10px"><button class="btn primary" style="width:100%" data-act="start">START JOB</button></div>';
    return h + '</div>';
  }

  // ---------- board ----------

  function geometry() {
    var W = Math.min(app.clientWidth || window.innerWidth, 560) - 32;
    W = Math.max(300, W);
    var s = W / 358;
    var N = Math.round(Math.max(56, Math.min(76, 60 * s)));
    var H = Math.round(412 * s); // a little shorter than the mockup's 446 so a 740 px tall screen fits it all
    var padX = Math.round(10 * s), padY = Math.round(14 * s);
    return {
      W: W, H: H, N: N,
      x: function (c) { return padX + c * (W - 2 * padX - N) / 3; },
      y: function (r) { return padY + r * (H - 2 * padY - N) / 4; }
    };
  }

  function center(g, id) {
    var d = def(id);
    return { x: g.x(d.col) + g.N / 2, y: g.y(d.row) + g.N / 2 };
  }

  function renderBoard() {
    var job = ui.job, game = ui.game, st = game.state;
    var h = '<div class="screen">';

    // Header
    var trace = E.tracing(game);
    h += '<div class="hdr">' +
      '<button class="icon-btn" data-act="abort" aria-label="Abort job">' + icon('close') + '</button>' +
      '<div class="mid"><div class="kicker">JOB ' + job.number + ' · BACKDOOR</div><div class="title">' + esc(job.name) + '</div></div>' +
      '<button class="icon-btn" data-act="help" aria-label="How to play" style="width:36px;height:36px;border-radius:12px">' + icon('help', 16) + '</button>' +
      '<div class="turn' + (trace ? ' tracing' : '') + '"><div class="kicker">' + (trace ? 'TRACING' : 'TURN') + '</div><div class="title">' + st.turn + '<span>/' + job.turnLimit + '</span></div></div>' +
      '</div>';

    // Goal chips
    var heatOk = st.heat <= E.STAR_HEAT;
    h += '<div class="chips">' +
      '<div class="chip ' + (st.hasData ? 'done' : 'gold') + '">' + (st.hasData ? '✓ Data copied' : '◆ ' + esc(job.goal)) + '</div>' +
      '<div class="chip' + (st.hasData ? ' gold' : '') + '">Exit at ENTRY</div>' +
      '<div class="chip' + (heatOk ? '' : ' lost') + '">★ Heat ≤ ' + E.STAR_HEAT + '</div>' +
      '<div class="chip' + (st.detected ? ' lost' : '') + '">★ Unseen</div>' +
      '</div>';

    // Stats
    var segs = '';
    for (var i = 0; i < E.HEAT_MAX; i++) segs += '<i style="' + (i < st.heat ? 'background:' + heatColor(i) : '') + '"></i>';
    var pips = '';
    for (var j = 0; j < E.ACTIONS_PER_TURN; j++) pips += '<i style="' + (j < st.actions ? 'background:var(--you)' : '') + '"></i>';
    h += '<div class="stats">' +
      '<div class="card stat heat' + (ui.flashHeat ? ' flash' : '') + '"><div class="lbl"><span>HEAT</span><b style="color:var(--threat)">' + st.heat + ' / ' + E.HEAT_MAX + '</b></div><div class="segs">' + segs + '</div></div>' +
      '<div class="card stat"><div class="lbl"><span>ACTIONS</span><b style="color:var(--you)">' + st.actions + ' / ' + E.ACTIONS_PER_TURN + '</b></div><div class="segs" style="gap:6px">' + pips + '</div></div>' +
      '</div>';
    ui.flashHeat = false;

    h += renderGrid();

    // AI message
    if (st.ai && st.ai.offered) {
      var aiText;
      if (st.ai.trusted) aiText = 'good. the switch is open. <span>don’t make me regret it.</span>';
      else if (st.ai.refused) aiText = 'your call. <span>i hope the admin is asleep.</span>';
      else aiText = esc(job.ai.offer) + ' <span>' + esc(job.ai.offerTail) + '</span>';
      h += '<div class="ai-msg"><div class="av">?</div><div class="tx">' + aiText + '</div></div>';
    }

    // Dock: feedback lines, program tray and actions stay at the bottom.
    h += '<div class="dock">';
    // What just happened, or info about a tapped node
    h += '<div class="feed" aria-live="polite">' + ui.feed.slice(-2).map(function (e) {
      return '<div class="e-' + e.kind + '">' + esc(e.text) + '</div>';
    }).join('') + '</div>';

    h += renderWarning();
    h += '<div class="tray">';
    E.PROGRAM_ORDER.forEach(function (p) {
      if (job.programs[p] === undefined) return;
      var c = st.charges[p] || 0;
      var cls = 'prog';
      if (c === 0) cls += ' used';
      else if (ui.selected === p) cls += ' sel';
      else if (p === 'spoof' && st.spoof) cls += ' active';
      else if (!E.canRun(game, p)) cls += ' idle';
      var label = E.PROGRAMS[p].name + ', ' + (c ? c + ' left' : 'used') + (ui.selected === p ? ', selected' : '') + (p === 'spoof' && st.spoof ? ', running' : '');
      h += '<button class="' + cls + '" data-act="prog" data-prog="' + p + '" aria-label="' + label + '">' + icon(p, 18) +
        '<span class="n">' + E.PROGRAMS[p].name + '</span><span class="c">' + (p === 'spoof' && st.spoof ? 'ON' : c) + '</span></button>';
    });
    h += '</div>';

    // Actions
    var canUndo = game.undoStack.length > 0 && st.status === 'playing';
    h += '<div class="actions">' +
      '<button class="btn undo" data-act="undo"' + (canUndo ? '' : ' disabled') + '>' + icon('undo', 15) + 'Undo</button>' +
      (E.canExtract(game) ? '<button class="btn gold" data-act="extract">' + icon('extract', 15) + 'EXTRACT</button>' : '') +
      '<button class="btn primary end' + (st.actions === 0 ? ' nudge' : '') + '" data-act="end"' + (st.status === 'playing' ? '' : ' disabled') + '>END TURN</button>' +
      '</div></div>';

    return h + '</div>';
  }

  function renderWarning() {
    var game = ui.game, st = game.state;
    var th = E.threats(game);
    if (st.status !== 'playing') return '';
    if (th.length) {
      var t = th[0];
      var msg;
      if (st.spoof) msg = 'Spoof is up. Sentry ' + t.sentry + '’s ' + (t.type === 'scan' ? 'scan' : 'bump') + ' will miss you.';
      else if (t.type === 'scan') msg = 'Sentry ' + t.sentry + ' scans your node next turn (+' + t.heat + '). Move or Spoof.';
      else msg = 'Sentry ' + t.sentry + ' moves onto your node next turn (+' + t.heat + '). Move or Spoof.';
      if (th.length > 1 && !st.spoof) msg += ' Sentry ' + th[1].sentry + ' too.';
      return '<div class="warn' + (st.spoof ? ' safe' : '') + '" role="status">' + icon('warn', 14) + '<span>' + msg + '</span></div>';
    }
    if (ui.selected) {
      return '<div class="warn safe">' + icon(ui.selected, 14) + '<span>' + E.PROGRAMS[ui.selected].name + ': tap a highlighted node. Tap the card again to cancel.</span></div>';
    }
    if (E.tracing(game)) return '<div class="warn">' + icon('warn', 14) + '<span>Admin is tracing: +1 heat at the end of every turn.</span></div>';
    if (st.actions === 0) return '<div class="warn safe">' + icon('warn', 14) + '<span>Out of actions. End your turn.</span></div>';
    if (st.hasData) return '<div class="warn safe">' + icon('entry', 14) + '<span>You have the data. Get back to ENTRY.</span></div>';
    return '';
  }

  function nodeClasses(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var c = ['node'];
    var moves = ui.moves, picks = ui.picks;
    if (ns.hidden) c.push('hidden');
    else if (d.type === 'honeypot') c.push('trap');
    else if (d.type === 'entry') c.push('entry');
    else if (d.type === 'target') { c.push('target'); if (st.hasData) c.push('copied'); }
    else if (d.type === 'firewall' || d.type === 'lock') { c.push('barrier'); if (ns.open) c.push('open'); }
    else if (d.type === 'ai') { c.push('ai'); if (st.ai.trusted) c.push('trusted'); if (st.ai.refused) c.push('refused'); }
    if (st.player === id) c.push('you');
    else if (picks.indexOf(id) !== -1) c.push('pick');
    else if (!ui.selected && moves.indexOf(id) !== -1) c.push('valid');
    if (ui.info === id) c.push('sel-info');
    return c.join(' ');
  }

  function nodeInner(id) {
    var st = ui.game.state, d = def(id), ns = st.nodes[id];
    var inner;
    if (ns.hidden) inner = '<div class="q">?</div>';
    else if (d.type === 'ai') inner = '<div class="q">?</div>';
    else if (d.type === 'honeypot') inner = icon('trap', 18);
    else if (d.type === 'lock' && ns.open) inner = icon('unlock', 18);
    else inner = icon(d.icon, d.type === 'target' ? 20 : 18);
    inner += '<div class="lbl">' + esc(d.label) + '</div>';
    var badges = [];
    if (!ns.hidden && d.type === 'honeypot') badges.push(['trap', 'TRAP']);
    if (ns.decoy) badges.push(['mine', 'DECOY']);
    if (ns.infected) badges.push(['mine', 'WORM']);
    if (ns.bruteTimer > 0) badges.push(['brute', 'BRUTE ' + ns.bruteTimer]);
    if ((d.type === 'firewall' || d.type === 'lock') && ns.open) badges.push(['open', 'OPEN']);
    if (d.type === 'target' && st.hasData) badges.push(['data', 'COPIED']);
    badges.slice(0, 2).forEach(function (b, i) {
      inner += '<div class="badge ' + b[0] + (i ? ' b2' : '') + '">' + b[1] + '</div>';
    });
    return inner;
  }

  function nodeAria(id) {
    var st = ui.game.state, d = def(id), ns = st.nodes[id];
    var parts = [ns.hidden ? 'Unknown node ' + d.label : d.label];
    if (st.player === id) parts.push('you are here');
    if (ui.moves.indexOf(id) !== -1 && !ui.selected) parts.push('tap to move');
    if (ui.picks.indexOf(id) !== -1) parts.push('tap to target');
    var s = E.sentryAt(ui.game, id);
    if (s) parts.push('Sentry ' + s.id);
    return parts.join(', ');
  }

  function renderGrid() {
    var game = ui.game, st = game.state, job = ui.job;
    var g = geometry();
    ui.geo = g;
    ui.moves = E.legalMoves(game);
    ui.picks = ui.selected ? E.programTargets(game, ui.selected) : [];

    var svg = '<svg class="layer" width="' + g.W + '" height="' + g.H + '" viewBox="0 0 ' + g.W + ' ' + g.H + '" aria-hidden="true">' +
      '<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#FF9F43"/></marker></defs>';

    // Links
    var walked = {};
    for (var i = 1; i < st.path.length; i++) {
      var a = st.path[i - 1], b = st.path[i];
      walked[a < b ? a + b : b + a] = true;
    }
    var aiId = job.ai ? job.ai.node : null;
    var base = '', aiLinks = '', walkedLinks = '';
    E.allLinks(game).forEach(function (l) {
      var p = center(g, l[0]), q = center(g, l[1]);
      var line = '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"';
      var k = l[0] < l[1] ? l[0] + l[1] : l[1] + l[0];
      if (l[0] === aiId || l[1] === aiId) {
        var trusted = st.ai && st.ai.trusted;
        aiLinks += line + ' stroke="#B48CFF" stroke-width="2" stroke-dasharray="' + (trusted ? '6 4' : '3 5') + '" opacity="' + (st.ai && st.ai.refused ? 0.4 : 1) + '"/>';
      } else if (walked[k]) {
        walkedLinks += line + '/>';
      } else {
        base += line + '/>';
      }
    });
    svg += '<g stroke="#223040" stroke-width="2" fill="none">' + base + '</g>';
    svg += aiLinks;
    svg += '<g stroke="#3DDCFF" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.85">' + walkedLinks + '</g>';

    // Intents
    var ringCount = {};
    st.sentries.forEach(function (s) {
      var it = s.intent;
      if (!it || st.status !== 'playing') return;
      if (it.type === 'move') {
        var p = center(g, s.pos), q = center(g, it.target);
        var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = g.N * 0.42;
        var x1 = p.x + dx / len * off, y1 = p.y + dy / len * off;
        var x2 = q.x - dx / len * (off + 4), y2 = q.y - dy / len * (off + 4);
        svg += '<path d="M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + '" stroke="#FF9F43" stroke-width="3" stroke-dasharray="6 5" marker-end="url(#ah)" fill="none"/>';
      } else if (it.type === 'scan') {
        var c = center(g, it.target);
        var n = ringCount[it.target] = (ringCount[it.target] || 0) + 1;
        svg += '<circle class="scan-ring" cx="' + c.x + '" cy="' + c.y + '" r="' + (g.N * 0.7 + (n - 1) * 6) + '" fill="none" stroke="#FF9F43" stroke-width="2.5" stroke-dasharray="4 4"/>';
      }
    });
    svg += '</svg>';

    var nodes = '';
    job.nodes.forEach(function (d) {
      nodes += '<button class="' + nodeClasses(d.id) + '" data-act="node" data-node="' + d.id + '" aria-label="' + esc(nodeAria(d.id)) + '" style="left:' + g.x(d.col) + 'px;top:' + g.y(d.row) + 'px;width:' + g.N + 'px;height:' + g.N + 'px">' + nodeInner(d.id) + '</button>';
    });

    var tokens = '';
    st.sentries.forEach(function (s) {
      var prev = ui.prevSentry[s.id] || s.pos;
      var d = def(prev);
      tokens += '<div class="sentry' + (s.stun > 0 ? ' stunned' : '') + '" data-sentry="' + s.id + '" style="left:' + (g.x(d.col) - 10) + 'px;top:' + (g.y(d.row) - 12) + 'px">' + s.id +
        (s.stun > 0 ? '<span class="zz">STUN ' + s.stun + '</span>' : '') + '</div>';
    });

    return '<div class="board" style="width:' + g.W + 'px;height:' + g.H + 'px">' + svg + nodes + tokens + '</div>';
  }

  function animateSentries() {
    var g = ui.geo, st = ui.game.state;
    var move = function () {
      st.sentries.forEach(function (s) {
        var el = app.querySelector('[data-sentry="' + s.id + '"]');
        if (!el) return;
        var d = def(s.pos);
        el.style.left = (g.x(d.col) - 10) + 'px';
        el.style.top = (g.y(d.row) - 12) + 'px';
        ui.prevSentry[s.id] = s.pos;
      });
    };
    var changed = st.sentries.some(function (s) { return ui.prevSentry[s.id] && ui.prevSentry[s.id] !== s.pos; });
    if (changed) requestAnimationFrame(function () { requestAnimationFrame(move); });
    else move();
  }

  // ---------- node info ----------

  function describeNode(id) {
    var game = ui.game, st = game.state, d = def(id), ns = st.nodes[id];
    var s = E.sentryAt(game, id);
    var bits = [];
    if (ns.hidden) bits.push(d.label + ': unknown. Step on it or Sniff to find out what it is.');
    else if (d.type === 'honeypot') bits.push(d.label + ': honeypot. Entering it costs +4 heat' + (ns.sprung ? ' (already tripped).' : '.'));
    else if (d.type === 'firewall') bits.push(d.label + (ns.open ? ': open.' : ns.bruteTimer ? ': Brute opens it in ' + ns.bruteTimer + '.' : ': blocks you. Only Brute opens it.'));
    else if (d.type === 'lock') bits.push(d.label + (ns.open ? ': open.' : ns.bruteTimer ? ': Brute opens it in ' + ns.bruteTimer + '.' : ': locked. Brute it, or find the password.'));
    else if (d.type === 'ai') bits.push(st.ai.trusted ? 'UNKNOWN: it let you in.' : st.ai.refused ? 'UNKNOWN: closed to you.' : 'UNKNOWN: something is in there. Get next to it.');
    else if (d.type === 'target') bits.push(d.label + (st.hasData ? ': copied. Head for ENTRY.' : ': the target. Stand on it and Extract.'));
    else if (d.type === 'entry') bits.push('ENTRY: your way in and out.');
    else bits.push(d.label + '.');
    if (s) {
      var it = s.intent || {};
      var next = it.type === 'move' ? 'next: moves to ' + def(it.target).label
        : it.type === 'scan' ? 'next: scans ' + def(it.target).label
          : it.type === 'stunned' ? 'stunned' : 'next: waits';
      bits.push('Sentry ' + s.id + ' patrols ' + s.loop.map(function (n) { return def(n).label; }).join(' → ') + ', ' + next + '.');
    }
    if (id !== st.player && ui.moves.indexOf(id) === -1 && E.neighbors(game, st.player).indexOf(id) !== -1 && st.actions > 0) {
      bits.push(E.blockedReason(game, id));
    }
    return bits.join(' ');
  }

  // ---------- actions ----------

  function setFeed(events, fallback) {
    ui.feed = events.length ? events.slice() : (fallback ? [{ kind: 'info', text: fallback }] : []);
  }

  function afterAction(res, heatBefore) {
    if (!res.ok) { ui.feed = [{ kind: 'err', text: res.reason }]; render(); return; }
    ui.info = null;
    setFeed(res.events);
    if (ui.game.state.heat > heatBefore) ui.flashHeat = true;
    if (ui.game.state.ai && ui.game.state.ai.pending) ui.overlay = 'ai';
    render();
    checkEnd();
  }

  function checkEnd() {
    var st = ui.game.state;
    if (st.status === 'playing') return;
    ui.busy = true;
    setTimeout(function () { ui.busy = false; finishJob(); }, st.status === 'won' ? 650 : 900);
  }

  function onNode(id) {
    var game = ui.game, heat = game.state.heat;
    if (ui.selected) {
      if (ui.picks.indexOf(id) !== -1) {
        var p = ui.selected; ui.selected = null;
        afterAction(E.runProgram(game, p, id), heat);
      } else {
        ui.info = id;
        ui.feed = [{ kind: 'info', text: describeNode(id) }];
        render();
      }
      return;
    }
    if (ui.moves.indexOf(id) !== -1) { afterAction(E.move(game, id), heat); return; }
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
    if (info.target === 'self') {
      ui.selected = null;
      if (p === 'spoof' && st.spoof) { ui.feed = [{ kind: 'err', text: 'Spoof is already running this turn.' }]; render(); return; }
      afterAction(E.runProgram(game, p), heat);
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
    ui.feed = [{ kind: 'info', text: info.name + ': ' + info.desc }];
    render();
  }

  function onEnd() {
    var game = ui.game, heat = game.state.heat;
    ui.selected = null; ui.info = null;
    var res = E.endTurn(game);
    if (!res.ok) { ui.feed = [{ kind: 'err', text: res.reason }]; render(); return; }
    setFeed(res.events, 'Quiet turn.');
    if (game.state.heat > heat) ui.flashHeat = true;
    render();
    checkEnd();
  }

  function startJob(job) {
    ui.job = job;
    ui.game = E.newGame(job);
    ui.selected = null; ui.info = null; ui.overlay = null; ui.prevSentry = {};
    ui.feed = [{ kind: 'info', text: 'You’re in. Tap a glowing node to move.' }];
    ui.screen = 'board';
    render();
  }

  function finishJob() {
    var game = ui.game, st = game.state, job = ui.job;
    var stars = E.stars(game);
    var run = {
      id: Date.now(),
      when: new Date().toISOString(),
      job: job.id,
      won: st.status === 'won',
      reason: st.status === 'won' ? 'escaped' : st.reason,
      stars: stars.count,
      heat: st.heat,
      turns: st.turn,
      route: compressPath(st.path).map(function (n) { return def(n).label; }).join(' > '),
      programs: st.programsUsed.slice(),
      ai: st.ai ? (st.ai.trusted ? 'trusted' : st.ai.refused ? 'refused' : 'not met') : '',
      again: null,
      note: ''
    };
    store.runs.push(run);
    if (stars.count > (store.best[job.id] || 0)) store.best[job.id] = stars.count;
    save();
    ui.run = run;
    ui.overlay = null;
    ui.screen = 'result';
    render();
    window.scrollTo(0, 0);
  }

  function compressPath(path) {
    var out = [];
    path.forEach(function (n) { if (out[out.length - 1] !== n) out.push(n); });
    return out;
  }

  // ---------- results ----------

  function renderResult() {
    var run = ui.run, job = ui.job, game = ui.game, st = game.state;
    var stars = E.stars(game);
    var head = run.won ? 'EXTRACTED' : run.reason === 'traced' ? 'TRACED' : run.reason === 'dropped' ? 'CONNECTION DROPPED' : 'JOB ABORTED';
    var sub = run.won ? 'You got out with the data.' : run.reason === 'traced' ? 'Heat hit 10. They know who you are.' : run.reason === 'dropped' ? 'You ran out of turns.' : 'You pulled out.';
    var h = '<div class="screen">';
    h += '<div class="result-head ' + (run.won ? 'win' : 'lose') + '"><div class="kicker">JOB ' + job.number + ' · ' + esc(job.name) + '</div><div class="big">' + head + '</div>' + starIcons(stars.count, 34) + '<div class="note">' + sub + '</div></div>';
    h += '<div class="star-list">' +
      starRow(stars.finished, 'Got out with the data') +
      starRow(stars.lowHeat, 'Finished at heat ' + E.STAR_HEAT + ' or less' + (run.won ? ' (you had ' + st.heat + ')' : '')) +
      starRow(stars.unseen, 'Never scanned or bumped') +
      '</div>';
    if (job.ai) {
      var line = st.ai.trusted ? job.ai.trustedLine : st.ai.refused ? job.ai.refusedLine : job.ai.ignoredLine;
      h += '<div class="card consequence">' + esc(line) + '</div>';
    }
    h += '<dl class="card kv">' +
      '<dt>Heat</dt><dd>' + st.heat + ' / ' + E.HEAT_MAX + '</dd>' +
      '<dt>Turns</dt><dd>' + st.turn + ' / ' + job.turnLimit + '</dd>' +
      '<dt>Route</dt><dd>' + esc(run.route) + '</dd>' +
      '<dt>Programs</dt><dd>' + (run.programs.length ? run.programs.map(function (p) { return E.PROGRAMS[p].name; }).join(', ') : 'none') + '</dd>' +
      '</dl>';
    h += '<div class="card again"><div class="q">Playtest: do you want another round?</div><div class="row">' +
      '<button class="btn' + (run.again === true ? ' picked' : '') + '" data-act="again" data-v="yes">Yes</button>' +
      '<button class="btn' + (run.again === false ? ' picked' : '') + '" data-act="again" data-v="no">Not really</button></div>' +
      '<textarea data-act="note" placeholder="Anything that felt like a chore, confusing, or great? (optional)">' + esc(run.note) + '</textarea></div>';
    var next = JOBS[jobIndex(job) + 1];
    h += '<div class="btn-col">' +
      '<button class="btn primary" data-act="retry">RETRY JOB ' + job.number + '</button>' +
      (next ? '<button class="btn" data-act="next">Next: Job ' + next.number + ' · ' + esc(next.name) + '</button>' : '') +
      '<button class="btn ghost" data-act="home">Job board</button></div>';
    return h + '</div>';
  }

  function starRow(on, text) {
    return '<div class="card star-row"><span class="stars"><span class="' + (on ? 'on' : '') + '">' + icon('star', 16) + '</span></span><span>' + esc(text) + '</span></div>';
  }

  // ---------- overlays ----------

  function renderOverlay() {
    var o = ui.overlay;
    if (!o) return '';
    var h = '<div class="overlay" data-act="' + (o === 'ai' ? '' : 'close-overlay') + '">';
    if (o === 'ai') {
      var ai = ui.job.ai;
      h += '<div class="sheet violet" role="dialog" aria-label="UNKNOWN makes an offer" data-act="">' +
        '<div class="kicker" style="color:var(--ai)">INCOMING · UNKNOWN</div>' +
        '<div class="ai-offer"><div class="av">?</div><div class="tx">' + esc(ai.offer) + ' <span>' + esc(ai.offerTail) + '</span></div></div>' +
        '<p>Trust it: UNKNOWN becomes passable and opens a link to ' + esc(def(ai.trustLink[1]).label) + '. It gets a copy of whatever you take.<br>Refuse: it stays closed, and someone tips off the admin (+2 heat).</p>' +
        '<div class="row"><button class="btn" data-act="ai-refuse">Refuse</button><button class="btn violet" data-act="ai-trust">Trust it</button></div></div>';
    } else if (o === 'abort') {
      h += '<div class="sheet" role="dialog" aria-label="Abort job" data-act="">' +
        '<div class="title">Abort this job?</div><p>It counts as a failed run in the playtest log.</p>' +
        '<div class="row"><button class="btn" data-act="close-overlay">Keep going</button><button class="btn primary" data-act="abort-yes">ABORT</button></div></div>';
    } else if (o === 'help') {
      h += '<div class="sheet" role="dialog" aria-label="How to play" data-act="">' +
        '<div class="title">How to play</div>' +
        '<ol class="tips">' + JOBS[0].tips.concat(ui.job === JOBS[0] ? [] : ui.job.tips).map(function (t) { return '<li class="card">' + t + '</li>'; }).join('') + '</ol>' +
        programRows(ui.job) +
        '<p>Heat: scanned +3, bumped +2, honeypot +4, Brute +1, Extract +1, admin trace +1 on each of the last 3 turns. Tap any node to see what it is.</p>' +
        '<button class="btn primary" data-act="close-overlay">BACK TO THE JOB</button></div>';
    } else if (o === 'log') {
      h += '<div class="sheet" role="dialog" aria-label="Playtest log" data-act="">' + renderLog() + '</div>';
    } else if (o === 'clear') {
      h += '<div class="sheet" role="dialog" aria-label="Clear log" data-act="">' +
        '<div class="title">Clear the playtest log?</div><p>This deletes all ' + store.runs.length + ' recorded runs and best stars in this browser. Copy or download them first if you need them.</p>' +
        '<div class="row"><button class="btn" data-act="log">Cancel</button><button class="btn primary" data-act="clear-yes">CLEAR</button></div></div>';
    }
    return h + '</div>';
  }

  function renderLog() {
    var h = '<div class="title">Playtest log</div>';
    if (!store.runs.length) return h + '<p>No runs yet. Play a job and it shows up here.</p><button class="btn" data-act="close-overlay">Close</button>';
    JOBS.forEach(function (job) {
      var rs = store.runs.filter(function (r) { return r.job === job.id; });
      if (!rs.length) return;
      var wins = rs.filter(function (r) { return r.won; }).length;
      var yes = rs.filter(function (r) { return r.again === true; }).length;
      var asked = rs.filter(function (r) { return r.again !== null; }).length;
      var avgStars = (rs.reduce(function (a, r) { return a + r.stars; }, 0) / rs.length).toFixed(1);
      h += '<div class="card kv"><dt>Job ' + job.number + '</dt><dd>' + esc(job.name) + '</dd>' +
        '<dt>Runs</dt><dd>' + rs.length + ' (' + wins + ' won)</dd>' +
        '<dt>Avg stars</dt><dd>' + avgStars + '</dd>' +
        '<dt>Again?</dt><dd>' + (asked ? yes + ' of ' + asked + ' said yes' : 'not answered') + '</dd></div>';
    });
    h += '<p>Copy the log and paste it into the project thread, or download it as a spreadsheet.</p>';
    h += '<div class="row"><button class="btn primary" data-act="copy-log">COPY</button><button class="btn" data-act="csv">Download CSV</button></div>';
    h += '<div class="row"><button class="btn ghost" data-act="clear">Clear log</button><button class="btn" data-act="close-overlay">Close</button></div>';
    return h;
  }

  var CSV_COLS = ['when', 'job', 'won', 'reason', 'stars', 'heat', 'turns', 'route', 'programs', 'ai', 'again', 'note'];
  function logCsv() {
    var rows = [CSV_COLS.join(',')];
    store.runs.forEach(function (r) {
      rows.push(CSV_COLS.map(function (c) {
        var v = r[c];
        if (Array.isArray(v)) v = v.join(' ');
        if (v === null || v === undefined) v = '';
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    return rows.join('\n');
  }
  function logText() {
    return store.runs.map(function (r, i) {
      return '#' + (i + 1) + ' ' + r.job + ' ' + (r.won ? 'WON' : r.reason.toUpperCase()) + ' ' + r.stars + '★ heat ' + r.heat + ' turns ' + r.turns +
        ' | ' + r.route + ' | programs: ' + (r.programs.join(', ') || 'none') + (r.ai ? ' | AI: ' + r.ai : '') +
        ' | again: ' + (r.again === null ? '?' : r.again ? 'yes' : 'no') + (r.note ? ' | ' + r.note : '');
    }).join('\n');
  }
  function copy(text) {
    var done = function () { toast('Copied ' + store.runs.length + ' runs'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- event wiring ----------

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || ui.busy) return;
    var act = el.getAttribute('data-act');
    if (act === '') { e.stopPropagation(); return; }
    switch (act) {
      case 'pick': {
        var job = JOBS.filter(function (j) { return j.id === el.getAttribute('data-job'); })[0];
        ui.job = job; ui.screen = 'intro'; render(); window.scrollTo(0, 0); break;
      }
      case 'start': store.seenIntro[ui.job.id] = true; save(); startJob(ui.job); window.scrollTo(0, 0); break;
      case 'home': ui.screen = 'select'; ui.overlay = null; render(); window.scrollTo(0, 0); break;
      case 'node': onNode(el.getAttribute('data-node')); break;
      case 'prog': onProgram(el.getAttribute('data-prog')); break;
      case 'undo': {
        var r = E.undo(ui.game); ui.selected = null; ui.info = null;
        ui.feed = r.ok ? [{ kind: 'info', text: 'Undone.' }] : [{ kind: 'err', text: r.reason }];
        render(); break;
      }
      case 'extract': afterAction(E.extract(ui.game), ui.game.state.heat); break;
      case 'end': onEnd(); break;
      case 'ai-trust': case 'ai-refuse': {
        var res = E.answerAI(ui.game, act === 'ai-trust');
        ui.overlay = null;
        afterAction(res, ui.game.state.heat);
        break;
      }
      case 'abort': ui.overlay = 'abort'; render(); break;
      case 'abort-yes': E.abort(ui.game); ui.overlay = null; finishJob(); break;
      case 'help': ui.overlay = 'help'; render(); break;
      case 'log': ui.overlay = 'log'; render(); break;
      case 'clear': ui.overlay = 'clear'; render(); break;
      case 'clear-yes': store = { best: {}, runs: [], seenIntro: store.seenIntro }; save(); ui.overlay = 'log'; render(); break;
      case 'copy-log': copy(logText()); break;
      case 'csv': download('backdoor-playtest-log.csv', logCsv()); break;
      case 'close-overlay':
        if (e.target !== el && el.classList.contains('overlay')) return;
        ui.overlay = null; render(); break;
      case 'again': {
        ui.run.again = el.getAttribute('data-v') === 'yes';
        save(); render(); break;
      }
      case 'retry': startJob(ui.job); window.scrollTo(0, 0); break;
      case 'next': {
        ui.job = JOBS[jobIndex(ui.job) + 1];
        if (store.seenIntro[ui.job.id]) startJob(ui.job); else { ui.screen = 'intro'; render(); }
        window.scrollTo(0, 0); break;
      }
    }
  });

  app.addEventListener('input', function (e) {
    if (e.target.getAttribute('data-act') === 'note' && ui.run) { ui.run.note = e.target.value; save(); }
  });

  var lastW = 0;
  window.addEventListener('resize', function () {
    var w = app.clientWidth;
    if (ui.screen === 'board' && w !== lastW) { lastW = w; render(); }
  });

  // Debug hook for automated checks.
  window.__backdoor = { ui: ui, store: function () { return store; }, render: render, startJob: function (i) { startJob(JOBS[i]); } };

  render();
})();
