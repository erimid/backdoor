/*
 * Backdoor hacking engine: pure game rules, no DOM.
 *
 * A "game" is { job, state, undoStack }. The state is plain JSON so it can be
 * snapshotted for Undo and inspected in tests. Every player action returns a
 * list of events ({ kind, text, ... }) that the UI turns into feedback.
 *
 * Rules follow the "Hacking rules" section of the game design document.
 * Where the doc is silent, the simplest readable option was chosen; those
 * choices are marked "Choice:" below and listed in the README.
 */
(function (root) {
  var HEAT_MAX = 10;
  var ACTIONS_PER_TURN = 2;
  var HEAT = { scan: 3, bump: 2, honeypot: 4, brute: 1, extract: 1, trace: 1, tip: 2 };
  var TRACE_TURNS = 3; // admin traces on the job's last 3 turns
  var DECOY_RANGE = 3;
  var SNIFF_RANGE = 2;
  var STUN_TURNS = 2;
  var BRUTE_PHASES = 2;
  var STAR_HEAT = 4;

  var PROGRAMS = {
    sniff: { name: 'Sniff', target: 'self', desc: 'Reveals every hidden node within 2 hops, traps included.' },
    spoof: { name: 'Spoof', target: 'self', desc: 'Scans and bumps miss you until your next turn.' },
    decoy: { name: 'Decoy', target: 'node', desc: 'Plants bait on a linked node. Sentries within 3 hops go for it.' },
    worm: { name: 'Worm', target: 'node', desc: 'Infects a linked node. A Sentry that steps on it is stunned for 2 turns.' },
    brute: { name: 'Brute', target: 'barrier', desc: 'Forces a linked lock or firewall open after 2 enemy phases. +1 heat.' }
  };
  var PROGRAM_ORDER = ['sniff', 'spoof', 'decoy', 'worm', 'brute'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ---------- setup ----------

  function newGame(job) {
    var nodes = {};
    job.nodes.forEach(function (n) {
      nodes[n.id] = {
        hidden: !!n.hidden,
        open: false,        // locks and firewalls start closed
        infected: false,
        decoy: false,
        bruteTimer: 0,
        sprung: false,      // honeypot already entered
        clueFound: false
      };
    });
    var charges = {};
    PROGRAM_ORDER.forEach(function (p) { if (job.programs[p]) charges[p] = job.programs[p]; });
    var entry = job.nodes.filter(function (n) { return n.type === 'entry'; })[0];
    var state = {
      turn: 1,
      actions: ACTIONS_PER_TURN,
      heat: 0,
      player: entry.id,
      hasData: false,
      charges: charges,
      spoof: false,
      detected: false,
      nodes: nodes,
      extraLinks: [],
      sentries: job.sentries.map(function (s) {
        return { id: s.id, pos: s.start, loop: s.patrol.slice(), loopIndex: 0, stun: 0, intent: null, cooldown: false };
      }),
      ai: job.ai ? { offered: false, pending: false, trusted: false, refused: false, tipped: false } : null,
      status: 'playing',   // playing | won | lost
      reason: null,        // traced | dropped | aborted
      path: [entry.id],
      programsUsed: [],
      log: []
    };
    var game = { job: job, state: state, undoStack: [] };
    planAll(game);
    return game;
  }

  // ---------- lookups ----------

  function nodeDef(job, id) {
    for (var i = 0; i < job.nodes.length; i++) if (job.nodes[i].id === id) return job.nodes[i];
    return null;
  }

  function allLinks(game) { return game.job.links.concat(game.state.extraLinks); }

  function neighbors(game, id) {
    var out = [];
    allLinks(game).forEach(function (l) {
      if (l[0] === id) out.push(l[1]);
      else if (l[1] === id) out.push(l[0]);
    });
    return out;
  }

  function isLinked(game, a, b) { return neighbors(game, a).indexOf(b) !== -1; }

  function sentryAt(game, id) {
    var s = game.state.sentries;
    for (var i = 0; i < s.length; i++) if (s[i].pos === id) return s[i];
    return null;
  }

  function isBarrier(game, id) {
    var t = nodeDef(game.job, id).type;
    return t === 'lock' || t === 'firewall';
  }

  function isClosed(game, id) { return isBarrier(game, id) && !game.state.nodes[id].open; }

  function isAI(game, id) { return nodeDef(game.job, id).type === 'ai'; }

  // Can the player step onto this node right now?
  function playerCanEnter(game, id) {
    if (isClosed(game, id)) return false;
    if (sentryAt(game, id)) return false;
    if (isAI(game, id) && !(game.state.ai && game.state.ai.trusted)) return false;
    return true;
  }

  // Sentries may pass locks and firewalls but never the AI node.
  function sentryCanEnter(game, id) { return !isAI(game, id); }

  function sentryNeighbors(game, id) {
    return neighbors(game, id).filter(function (n) { return sentryCanEnter(game, n); });
  }

  // Breadth-first distances from `from` over nodes allowed by `canEnter`.
  function bfs(game, from, nextFn) {
    var dist = {}; var prev = {};
    dist[from] = 0;
    var queue = [from];
    while (queue.length) {
      var cur = queue.shift();
      nextFn(cur).forEach(function (n) {
        if (dist[n] === undefined) { dist[n] = dist[cur] + 1; prev[n] = cur; queue.push(n); }
      });
    }
    return { dist: dist, prev: prev };
  }

  function sentryStepToward(game, from, to) {
    if (from === to) return from;
    var r = bfs(game, from, function (n) { return sentryNeighbors(game, n); });
    if (r.dist[to] === undefined) return null;
    var cur = to;
    while (r.prev[cur] !== from) cur = r.prev[cur];
    return cur;
  }

  function sentryDistances(game, from) {
    return bfs(game, from, function (n) { return sentryNeighbors(game, n); }).dist;
  }

  // ---------- Sentry planning ----------

  function nearestDecoy(game, sentry) {
    var d = sentryDistances(game, sentry.pos);
    var best = null;
    game.job.nodes.forEach(function (n) {
      if (!game.state.nodes[n.id].decoy) return;
      var k = d[n.id];
      if (k === undefined || k > DECOY_RANGE) return;
      if (!best || k < best.dist) best = { id: n.id, dist: k };
    });
    return best;
  }

  function planSentry(game, sentry) {
    var st = game.state;
    if (sentry.stun > 0) { sentry.intent = { type: 'stunned' }; return; }

    var decoy = nearestDecoy(game, sentry);
    if (decoy) {
      if (decoy.dist === 0) sentry.intent = { type: 'scan', target: decoy.id, why: 'decoy' };
      else sentry.intent = { type: 'move', target: sentryStepToward(game, sentry.pos, decoy.id), why: 'decoy' };
      return;
    }

    // Choice: a Sentry never scans the player two enemy phases in a row. After a
    // scan it goes back to its patrol, so it can't pin you in a dead end forever.
    var rested = sentry.cooldown;
    if (!rested && sentryNeighbors(game, sentry.pos).indexOf(st.player) !== -1) {
      sentry.intent = { type: 'scan', target: st.player, why: 'player' };
      return;
    }

    // Patrol: head for the next node on the loop.
    var guard = 0;
    while (sentry.loop[sentry.loopIndex] === sentry.pos && guard++ < sentry.loop.length) {
      sentry.loopIndex = (sentry.loopIndex + 1) % sentry.loop.length;
    }
    var step = sentryStepToward(game, sentry.pos, sentry.loop[sentry.loopIndex]);
    if (!step || step === sentry.pos) sentry.intent = { type: 'wait' };
    else sentry.intent = { type: 'move', target: step, why: 'patrol' };
  }

  function planAll(game) {
    game.state.sentries.forEach(function (s) { planSentry(game, s); });
  }

  // ---------- helpers for actions ----------

  function ev(game, events, kind, text, extra) {
    var e = { kind: kind, text: text };
    if (extra) for (var k in extra) e[k] = extra[k];
    events.push(e);
    game.state.log.push(e);
    if (game.state.log.length > 40) game.state.log.shift();
    return e;
  }

  function addHeat(game, events, amount, why) {
    var st = game.state;
    st.heat = Math.min(HEAT_MAX, st.heat + amount);
    ev(game, events, 'heat', why + ' +' + amount + ' heat.', { amount: amount });
    if (st.heat >= HEAT_MAX && st.status === 'playing') {
      st.status = 'lost';
      st.reason = 'traced';
      ev(game, events, 'lose', 'Traced. Heat hit ' + HEAT_MAX + '.');
    }
  }

  function snapshot(game) { game.undoStack.push(clone(game.state)); }

  function fail(reason) { return { ok: false, reason: reason, events: [] }; }

  function canAct(game) {
    var st = game.state;
    if (st.status !== 'playing') return 'The job is over.';
    if (st.ai && st.ai.pending) return 'Answer UNKNOWN first.';
    if (st.actions <= 0) return 'No actions left. End your turn.';
    return null;
  }

  // ---------- queries for the UI ----------

  function legalMoves(game) {
    if (canAct(game)) return [];
    return neighbors(game, game.state.player).filter(function (n) { return playerCanEnter(game, n); });
  }

  function isOpenNode(game, id) {
    // Choice: "open node" = one you could stand on with no Sentry on it.
    return !isClosed(game, id) && !isAI(game, id) && !sentryAt(game, id) && id !== game.state.player;
  }

  function programTargets(game, prog) {
    var st = game.state;
    if (canAct(game) || !st.charges[prog]) return [];
    var adj = neighbors(game, st.player);
    if (prog === 'decoy') return adj.filter(function (n) { return isOpenNode(game, n) && !st.nodes[n].decoy; });
    if (prog === 'worm') return adj.filter(function (n) { return isOpenNode(game, n) && !st.nodes[n].infected; });
    if (prog === 'brute') return adj.filter(function (n) { return isClosed(game, n) && st.nodes[n].bruteTimer === 0; });
    return [];
  }

  function canRun(game, prog) {
    var st = game.state;
    if (canAct(game) || !st.charges[prog]) return false;
    var t = PROGRAMS[prog].target;
    if (t === 'self') {
      if (prog === 'spoof') return !st.spoof;
      if (prog === 'sniff') return hiddenWithin(game, SNIFF_RANGE).length > 0;
      return true;
    }
    return programTargets(game, prog).length > 0;
  }

  function canExtract(game) {
    var st = game.state;
    return !canAct(game) && !st.hasData && nodeDef(game.job, st.player).type === 'target';
  }

  function hiddenWithin(game, range) {
    var d = bfs(game, game.state.player, function (n) { return neighbors(game, n); }).dist;
    return game.job.nodes.filter(function (n) {
      return game.state.nodes[n.id].hidden && d[n.id] !== undefined && d[n.id] <= range;
    }).map(function (n) { return n.id; });
  }

  // Threats aimed at the player's current node in the coming enemy phase.
  function threats(game) {
    var st = game.state; var out = [];
    st.sentries.forEach(function (s) {
      if (!s.intent || s.intent.target !== st.player) return;
      if (s.intent.type === 'scan') out.push({ sentry: s.id, type: 'scan', heat: HEAT.scan });
      if (s.intent.type === 'move') out.push({ sentry: s.id, type: 'bump', heat: HEAT.bump });
    });
    return out;
  }

  function tracing(game) {
    return game.state.turn > game.job.turnLimit - TRACE_TURNS;
  }

  function stars(game) {
    var st = game.state;
    var won = st.status === 'won';
    return {
      finished: won,
      lowHeat: won && st.heat <= STAR_HEAT,
      unseen: won && !st.detected,
      count: won ? 1 + (st.heat <= STAR_HEAT ? 1 : 0) + (!st.detected ? 1 : 0) : 0
    };
  }

  // ---------- player actions ----------

  function enterNode(game, id, events) {
    var st = game.state; var def = nodeDef(game.job, id); var ns = st.nodes[id];
    st.player = id;
    st.path.push(id);
    if (ns.hidden) {
      ns.hidden = false;
      if (def.type === 'honeypot') ev(game, events, 'reveal', def.label + ' was a honeypot.', { node: id });
      else ev(game, events, 'reveal', def.label + ' revealed. Nothing nasty.', { node: id });
    }
    if (def.type === 'honeypot' && !ns.sprung) {
      ns.sprung = true;
      addHeat(game, events, HEAT.honeypot, 'Honeypot tripped.');
    }
    (game.job.clues || []).forEach(function (c) {
      if (c.at === id && !st.nodes[id].clueFound) {
        st.nodes[id].clueFound = true;
        st.nodes[c.opens].open = true;
        st.nodes[c.opens].bruteTimer = 0;
        ev(game, events, 'clue', c.text, { node: c.opens });
      }
    });
    if (def.type === 'entry' && st.hasData && st.status === 'playing') {
      st.status = 'won';
      ev(game, events, 'win', 'Out clean with the data.');
      return;
    }
    if (st.ai && !st.ai.offered && st.status === 'playing' && isLinked(game, id, game.job.ai.node)) {
      st.ai.offered = true;
      st.ai.pending = true;
      ev(game, events, 'ai', 'UNKNOWN wants to talk.');
    }
  }

  function move(game, to) {
    var why = canAct(game); if (why) return fail(why);
    if (!isLinked(game, game.state.player, to)) return fail('Not linked to your node.');
    if (!playerCanEnter(game, to)) return fail(blockedReason(game, to));
    snapshot(game);
    var events = [];
    game.state.actions -= 1;
    enterNode(game, to, events);
    return { ok: true, events: events };
  }

  function blockedReason(game, id) {
    var def = nodeDef(game.job, id);
    if (sentryAt(game, id)) return 'A Sentry is on ' + def.label + '.';
    if (def.type === 'firewall') return 'Firewall. Only Brute opens it.';
    if (def.type === 'lock') return 'Locked. Brute it or find the password.';
    if (def.type === 'ai') return 'UNKNOWN won’t let you in.';
    return 'Blocked.';
  }

  function runProgram(game, prog, target) {
    var why = canAct(game); if (why) return fail(why);
    var st = game.state;
    if (!st.charges[prog]) return fail(PROGRAMS[prog] ? PROGRAMS[prog].name + ' is used up.' : 'Unknown program.');
    var events = [];
    if (prog === 'sniff') {
      var found = hiddenWithin(game, SNIFF_RANGE);
      if (!found.length) return fail('Nothing hidden within 2 hops.');
      snapshot(game);
      found.forEach(function (id) { st.nodes[id].hidden = false; });
      var traps = found.filter(function (id) { return nodeDef(game.job, id).type === 'honeypot'; });
      ev(game, events, 'reveal', 'Sniff revealed ' + found.length + ' node' + (found.length > 1 ? 's' : '') +
        (traps.length ? '. ' + traps.map(function (id) { return nodeDef(game.job, id).label; }).join(', ') + ' is a trap.' : '. No traps.'),
        { nodes: found });
    } else if (prog === 'spoof') {
      if (st.spoof) return fail('Spoof is already running.');
      snapshot(game);
      st.spoof = true;
      ev(game, events, 'program', 'Spoof up. Scans and bumps miss you until your next turn.');
    } else if (prog === 'decoy' || prog === 'worm' || prog === 'brute') {
      if (programTargets(game, prog).indexOf(target) === -1) return fail('Pick a highlighted node.');
      snapshot(game);
      var label = nodeDef(game.job, target).label;
      if (prog === 'decoy') {
        st.nodes[target].decoy = true;
        var lured = [];
        st.sentries.forEach(function (s) {
          if (s.stun > 0) return;
          var d = sentryDistances(game, s.pos)[target];
          if (d !== undefined && d <= DECOY_RANGE) { planSentry(game, s); lured.push(s.id); }
        });
        ev(game, events, 'program', 'Decoy planted on ' + label + '.' +
          (lured.length ? ' Sentry ' + lured.join(' and ') + ' took the bait.' : ' No Sentry is close enough to notice.'),
          { node: target });
      } else if (prog === 'worm') {
        st.nodes[target].infected = true;
        ev(game, events, 'program', 'Worm planted on ' + label + '.', { node: target });
      } else {
        st.nodes[target].bruteTimer = BRUTE_PHASES;
        ev(game, events, 'program', 'Brute is forcing ' + label + '. Open in ' + BRUTE_PHASES + ' turns.', { node: target });
        addHeat(game, events, HEAT.brute, 'Brute is loud.');
      }
    } else {
      return fail('Unknown program.');
    }
    st.charges[prog] -= 1;
    st.actions -= 1;
    st.programsUsed.push(prog);
    return { ok: true, events: events };
  }

  function extract(game) {
    if (!canExtract(game)) return fail(canAct(game) || 'Nothing to extract here.');
    snapshot(game);
    var st = game.state; var events = [];
    st.hasData = true;
    st.actions -= 1;
    ev(game, events, 'extract', 'Data copied. Get back to ENTRY.');
    addHeat(game, events, HEAT.extract, 'Extract.');
    return { ok: true, events: events };
  }

  function undo(game) {
    if (!game.undoStack.length) return fail('Nothing to undo this turn.');
    game.state = game.undoStack.pop();
    return { ok: true, events: [] };
  }

  // Choice: answering the AI commits the turn so far (Undo history clears),
  // so the offer can't be re-rolled by undoing the step that triggered it.
  function answerAI(game, trust) {
    var st = game.state;
    if (!st.ai || !st.ai.pending) return fail('No offer to answer.');
    var events = [];
    st.ai.pending = false;
    if (trust) {
      st.ai.trusted = true;
      st.extraLinks.push(game.job.ai.trustLink.slice());
      ev(game, events, 'ai', 'UNKNOWN opened a path to ' + nodeDef(game.job, game.job.ai.trustLink[1]).label + '.');
    } else {
      st.ai.refused = true;
      ev(game, events, 'ai', 'You refused. UNKNOWN went quiet.');
    }
    game.undoStack = [];
    return { ok: true, events: events };
  }

  function abort(game) {
    var st = game.state;
    if (st.status !== 'playing') return fail('The job is over.');
    st.status = 'lost';
    st.reason = 'aborted';
    return { ok: true, events: [] };
  }

  // ---------- enemy phase and upkeep ----------

  function runSentry(game, s, events) {
    var st = game.state; var it = s.intent || { type: 'wait' };
    if (it.type !== 'scan') s.cooldown = false;
    if (it.type === 'stunned') {
      s.stun = Math.max(0, s.stun - 1);
      return;
    }
    if (it.type === 'scan') {
      s.cooldown = it.why === 'player';
      if (st.nodes[it.target].decoy) {
        st.nodes[it.target].decoy = false;
        ev(game, events, 'sentry', 'Sentry ' + s.id + ' scanned the decoy and wiped it.', { sentry: s.id });
      }
      if (it.target === st.player) {
        if (st.spoof) ev(game, events, 'miss', 'Sentry ' + s.id + ' scanned you. Spoof held.', { sentry: s.id });
        else { st.detected = true; addHeat(game, events, HEAT.scan, 'Sentry ' + s.id + ' scanned you.'); }
      }
      return;
    }
    if (it.type === 'move') {
      if (it.target === st.player) {
        if (st.spoof) ev(game, events, 'miss', 'Sentry ' + s.id + ' walked into you. Spoof held.', { sentry: s.id });
        else { st.detected = true; addHeat(game, events, HEAT.bump, 'Sentry ' + s.id + ' bumped into you.'); }
        return; // the Sentry stays put either way
      }
      if (sentryAt(game, it.target)) return; // blocked by another Sentry
      s.pos = it.target;
      var ns = st.nodes[it.target];
      if (ns.decoy) {
        ns.decoy = false;
        ev(game, events, 'sentry', 'Sentry ' + s.id + ' reached the decoy and wiped it.', { sentry: s.id });
      }
      if (ns.infected) {
        ns.infected = false;
        s.stun = STUN_TURNS;
        ev(game, events, 'stun', 'Sentry ' + s.id + ' hit the worm. Stunned for ' + STUN_TURNS + ' turns.', { sentry: s.id });
      }
      if (s.loop[s.loopIndex] === s.pos) s.loopIndex = (s.loopIndex + 1) % s.loop.length;
    }
  }

  function endTurn(game) {
    var st = game.state;
    if (st.status !== 'playing') return fail('The job is over.');
    if (st.ai && st.ai.pending) return fail('Answer UNKNOWN first.');
    var events = [];

    // 3. Enemy phase: Sentries carry out the intents that were shown, in order.
    for (var i = 0; i < st.sentries.length && st.status === 'playing'; i++) runSentry(game, st.sentries[i], events);
    if (st.status === 'playing' && st.ai && st.ai.refused && !st.ai.tipped) {
      st.ai.tipped = true;
      addHeat(game, events, HEAT.tip, 'Someone tipped off the admin.');
    }
    if (st.status !== 'playing') { game.undoStack = []; return { ok: true, events: events }; }

    // 4. Upkeep.
    game.job.nodes.forEach(function (n) {
      var ns = st.nodes[n.id];
      if (ns.bruteTimer > 0) {
        ns.bruteTimer -= 1;
        if (ns.bruteTimer === 0) { ns.open = true; ev(game, events, 'open', n.label + ' is open.', { node: n.id }); }
      }
    });
    if (tracing(game)) addHeat(game, events, HEAT.trace, 'Admin is tracing.');
    if (st.status === 'playing') {
      st.turn += 1;
      if (st.turn > game.job.turnLimit) {
        st.turn = game.job.turnLimit;
        st.status = 'lost';
        st.reason = 'dropped';
        ev(game, events, 'lose', 'Connection dropped. Out of turns.');
      }
    }
    st.actions = ACTIONS_PER_TURN;
    st.spoof = false;
    game.undoStack = [];

    // 5. New intents.
    if (st.status === 'playing') {
      planAll(game);
      if (tracing(game) && st.turn === game.job.turnLimit - TRACE_TURNS + 1) {
        ev(game, events, 'trace', 'The admin noticed. +1 heat every turn from now on.');
      }
    }
    return { ok: true, events: events };
  }

  var Engine = {
    HEAT_MAX: HEAT_MAX, ACTIONS_PER_TURN: ACTIONS_PER_TURN, HEAT: HEAT, PROGRAMS: PROGRAMS,
    PROGRAM_ORDER: PROGRAM_ORDER, STAR_HEAT: STAR_HEAT, TRACE_TURNS: TRACE_TURNS,
    newGame: newGame, nodeDef: nodeDef, neighbors: neighbors, allLinks: allLinks, sentryAt: sentryAt,
    isClosed: isClosed, isBarrier: isBarrier, legalMoves: legalMoves, programTargets: programTargets,
    canRun: canRun, canExtract: canExtract, threats: threats, tracing: tracing, stars: stars,
    move: move, runProgram: runProgram, extract: extract, undo: undo, answerAI: answerAI,
    abort: abort, endTurn: endTurn, replan: planAll, blockedReason: blockedReason, canAct: canAct, clone: clone
  };

  root.BackdoorEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
