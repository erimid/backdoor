/*
 * Backdoor hacking engine v2: pure game rules, no DOM.
 *
 * A "game" is { job, state, undoStack, par }. `job` is the *resolved* job (a
 * deep copy of the jobs.js entry with one seeded variant applied, see
 * resolveJob). The state is plain JSON so it can be snapshotted for Undo and
 * inspected in tests. Every player action returns { ok, reason, events }, and
 * every event is { kind, text, ...structured fields } (see "Event contract").
 *
 * v2 shape of a job: "get in, get greedy, get out".
 *   Act 1 (sneak): 2 actions a turn, +1 banked if you end a turn with actions
 *   left (overclock). Caches pay for detours. Hidden nodes are loot or traps.
 *   Act 2 (BREACH): Extract burns ENTRY, opens one of two gold exits, Sentries
 *   hunt you, the trace clock adds heat each turn, caches pay double.
 *
 * Event contract (every event also has `text`; enemy-phase events carry
 * `sentry` and phase:'enemy'; upkeep events carry phase:'upkeep'):
 *   move{from,to}                    player step
 *   program{prog,node?,lured?}       a program ran (decoy: lured = sentry id|null)
 *   sentryMove{sentry,from,to,why}   why: patrol|decoy|noise|hunt
 *   sentryWait{sentry,why}           why: rest|patrol|blocked|stunned
 *   scan{sentry,node,hit,spoofed}    hit = it landed on you (heat follows)
 *   bump{sentry,node,spoofed}
 *   miss{sentry,node}                Spoof save (kept from v1)
 *   dodge{sentry,node}               an intent aimed at you fired on an empty node
 *   stun{sentry,turns,by}            by: worm|ai
 *   sentry{sentry,wiped}             a Sentry wiped a decoy
 *   heat{amount,cause,sentry?,node?} cause: scan|bump|honeypot|brute|extract|trace
 *   reveal{node|nodes,trap,traps?}
 *   cache{node,value,hot} | cache{node,charge}
 *   noise{node,sentries}  open{node,by}  clue{node}  exitKnown{exit}
 *   extract{node}  breach{exit,burned}  traceStart{}
 *   aiOffer{offer,voice,terms}  ai{offer,trust}
 *   win{exit}  lose{reason}
 *   v4: alert{level,at,type,nodes?,sentry?}  arrive{sentry,node}
 *       flip{node,state}  file{node,value,files}  freeze{sentries}  tunnel{from,to}
 *
 * Choices where the spec was silent are marked "Choice:".
 */
(function (root) {
  var HEAT_MAX = 10;
  var ACTIONS_PER_TURN = 2;
  var ACTIONS_MAX = 3;          // overclock: bank at most 1
  // v2: the AI tip-off is gone (tip: 0) and the admin trace is the BREACH clock.
  var HEAT = { scan: 3, bump: 2, honeypot: 4, brute: 1, extract: 1, trace: 1, tip: 0 };
  var TRACE_TURNS = 0;          // v1 "last 3 turns" trace removed; kept for old imports
  var DECOY_RANGE = 3;
  var NOISE_RANGE = 3;
  var SNIFF_RANGE = 2;
  var STUN_TURNS = 2;
  var STAR_HEAT = 4;            // v1 star rule, unused in v2; kept for old imports
  var CACHE_VALUE = 100;
  var AI_CUT = 0.25;
  // PAR drops by half of UNKNOWN's cut (see parOf).
  var PAR_SHARE = 0.5;
  var PAY = { heat: 40, turn: 30 };
  // v4: a side file pays this on Extract, and adds +1 to the trace clock.
  var FILE_VALUE = 250;
  var FREEZE_RANGE = 2;
  var FREEZE_TURNS = 1;
  var TUNNEL_RANGE = 2;

  var PROGRAMS = {
    sniff: { name: 'Sniff', target: 'self', cost: 1, desc: 'Reveals hidden nodes within 2 hops, and which exit BREACH will open.' },
    spoof: { name: 'Spoof', target: 'self', cost: 1, desc: 'Scans and bumps miss you until your next turn.' },
    decoy: { name: 'Decoy', target: 'node', cost: 1, desc: 'Plants bait on a linked node. The nearest Sentry within 3 hops goes for it.' },
    worm: { name: 'Worm', target: 'node', cost: 1, desc: 'Infects a linked node. A Sentry that steps on it is stunned for 2 turns.' },
    brute: { name: 'Brute', target: 'barrier', cost: 2, desc: 'Opens a linked lock or firewall now. 2 actions, +1 heat, and loud: Sentries within 3 hops come to look.' },
    // v4 (loadout jobs)
    tunnel: { name: 'Tunnel', target: 'node', cost: 1, desc: 'Opens a permanent link to a node 2 hops away. Sentries can use it too.' },
    freeze: { name: 'Freeze', target: 'self', cost: 1, desc: 'Every Sentry and camera within 2 hops skips its next phase.' }
  };
  var PROGRAM_ORDER = ['sniff', 'spoof', 'decoy', 'worm', 'brute', 'tunnel', 'freeze'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function programCost(prog) { return PROGRAMS[prog] ? PROGRAMS[prog].cost : 1; }
  function round10(x) { return Math.round(x / 10) * 10; }

  // ---------- variants ----------

  function entryOf(job) {
    for (var i = 0; i < job.nodes.length; i++) if (job.nodes[i].type === 'entry') return job.nodes[i].id;
    return null;
  }

  function canonicalVariant(job) {
    var offsets = {};
    var co = job.canonicalOffsets || {};
    (job.sentries || []).forEach(function (s) { offsets[s.id] = co[s.id] || 0; });
    return {
      id: 'v00',
      bag: job.bag && job.bag.canonical ? clone(job.bag.canonical) : {},
      offsets: offsets,
      exit: 0
    };
  }

  // Deep-copies a jobs.js entry and applies a variant: bag contents, Sentry
  // start offsets, exit index and the AI's {trap} text.
  function resolveJob(job, variant) {
    var j = clone(job);
    var v = variant ? clone(variant) : canonicalVariant(job);
    var byId = {};
    j.nodes.forEach(function (n) { byId[n.id] = n; });
    var bag = v.bag || {};
    var trapLabel = null;
    Object.keys(bag).forEach(function (id) {
      var n = byId[id]; if (!n) return;
      n.hidden = true;
      delete n.cache;
      if (bag[id] === 'honeypot') { n.type = 'honeypot'; trapLabel = n.label; }
      else {
        n.type = 'node';
        if (bag[id] === 'cash') n.cache = { kind: 'cash' };
        else if (bag[id] === 'charge') n.cache = { kind: 'charge', prog: (j.bag && j.bag.chargeProg) || 'brute' };
      }
    });
    var caches = j.caches || {};
    Object.keys(caches).forEach(function (id) { if (byId[id]) byId[id].cache = clone(caches[id]); });
    var offsets = v.offsets || {};
    (j.sentries || []).forEach(function (s) {
      var k = offsets[s.id] || 0;
      s.loopIndex = k % s.patrol.length;
      s.start = s.patrol[s.loopIndex];
    });
    if (!j.exits || !j.exits.length) j.exits = [entryOf(j)];
    j.exitIndex = Math.min(v.exit || 0, j.exits.length - 1);
    j.variantId = v.id;
    j.variant = v;
    if (j.ai) {
      var trap = (trapLabel || 'trap').toLowerCase(); // Choice: the AI speaks in lowercase
      // Keep the untemplated text (outside j.ai, which the player sees) so
      // re-resolving an already-resolved job with another variant names the
      // right trap instead of the old one.
      if (!j.aiTpl) {
        j.aiTpl = {};
        (j.ai.offers || []).forEach(function (o) { j.aiTpl[o.id] = { voice: o.voice, terms: o.terms }; });
      }
      (j.ai.offers || []).forEach(function (o) {
        var t = j.aiTpl[o.id] || { voice: o.voice, terms: o.terms };
        if (t.voice) o.voice = t.voice.replace(/\{trap\}/g, trap);
        if (t.terms) o.terms = t.terms.replace(/\{trap\}/g, trap);
      });
      var sc = aiOfferDef(j, 'shortcut');
      if (sc) { j.ai.offer = sc.voice; if (sc.trustLink) j.ai.trustLink = sc.trustLink.slice(); }
    }
    j.resolved = true;
    return j;
  }

  function aiOfferDef(job, id) {
    if (!job.ai || !job.ai.offers) return null;
    for (var i = 0; i < job.ai.offers.length; i++) if (job.ai.offers[i].id === id) return job.ai.offers[i];
    return null;
  }

  // ---------- setup ----------

  // opts = { variant, par }. Without a variant, an already-resolved job is used
  // as-is and a raw jobs.js entry gets its canonical variant.
  function newGame(rawJob, opts) {
    opts = opts || {};
    var job = opts.variant ? resolveJob(rawJob, opts.variant)
      : (rawJob.resolved ? rawJob : resolveJob(rawJob, canonicalVariant(rawJob)));
    var nodes = {};
    job.nodes.forEach(function (n) {
      nodes[n.id] = {
        hidden: !!n.hidden,
        open: false,        // locks and firewalls start closed
        infected: false,
        decoy: false,
        bruteTimer: 0,      // v1 field, always 0 in v2 (Brute is instant)
        sprung: false,      // honeypot already entered
        clueFound: false
      };
    });
    var charges = {};
    var progs = programsFor(job, opts.loadout);
    PROGRAM_ORDER.forEach(function (p) { if (progs[p]) charges[p] = progs[p]; });
    var switches = {};
    (job.switches || []).forEach(function (w) { switches[w.at] = 'a'; });
    var entry = entryOf(job);
    var par = opts.par || (job.payout && job.payout.par) || 0;
    var state = {
      turn: 1,
      actions: ACTIONS_PER_TURN,
      banked: false,
      heat: job.startHeat || 0,
      player: entry,
      hasData: false,
      charges: charges,
      spoof: false,
      detected: false,
      nodes: nodes,
      extraLinks: [],
      sentries: job.sentries.filter(function (s) { return !s.arrives; }).map(makeSentry),
      // v4: Sentries that join later (a Tracer's arrival turn, or an alert).
      incoming: job.sentries.filter(function (s) { return s.arrives; }).map(function (s) {
        return { def: s, turn: s.arrives, why: 'arrive' };
      }),
      alerts: {},          // v4: alert levels already fired, by index
      switches: switches,  // v4: switch node -> 'a' | 'b'
      files: {},           // v4: side files extracted
      fileCash: 0,
      loadout: Object.keys(progs).filter(function (p) { return progs[p]; }),
      cash: 0,
      taken: {},
      breach: false,
      breachTurn: 0,
      exit: null,
      exitKnown: job.exits.length <= 1,
      noise: null,
      wormStuns: 0,
      traceStarted: false,
      par: par,
      variantId: job.variantId,
      ai: job.ai ? { pending: null, answers: {}, trusted: false, deals: 0, offered: false, refused: false } : null,
      status: 'playing',   // playing | won | lost
      reason: null,        // traced | dropped | aborted
      path: [entry],
      programsUsed: [],
      log: []
    };
    var game = { job: job, state: state, undoStack: [], par: opts.par || null };
    planAll(game);
    return game;
  }

  function makeSentry(s) {
    return {
      id: s.id, pos: s.start, loop: s.patrol.slice(), loopIndex: s.loopIndex || 0, camera: !!s.camera,
      stun: 0, intent: null, cooldown: false, lure: null, noisy: false,
      tracer: !!s.tracer, trail: 0
    };
  }

  // v4 loadout: a job with `loadout` lets the player pick `pick` programs
  // from its pool. `chosen` is a list of program ids (invalid or short lists
  // fall back to the job's default pick). Charges per program come from the
  // pool. Jobs without a loadout use `programs` as before.
  function programsFor(job, chosen) {
    var lo = job.loadout;
    if (!lo) return job.programs;
    var ok = chosen && chosen.length === lo.pick && chosen.every(function (p, i) {
      return lo.pool[p] && chosen.indexOf(p) === i;
    });
    var list = ok ? chosen : lo.default;
    var out = {};
    list.forEach(function (p) { out[p] = lo.pool[p]; });
    return out;
  }

  // ---------- lookups ----------

  function nodeDef(job, id) {
    for (var i = 0; i < job.nodes.length; i++) if (job.nodes[i].id === id) return job.nodes[i];
    return null;
  }

  function label(game, id) { var d = nodeDef(game.job, id); return d ? d.label : id; }

  // v4 switches: a switch node has two link sets, a and b. Only the active
  // set exists; stepping onto the switch flips it.
  function switchOff(game) {
    var sw = game.job.switches;
    if (!sw || !sw.length) return null;
    var off = {};
    sw.forEach(function (w) {
      var dead = game.state.switches[w.at] === 'b' ? w.a : w.b;
      dead.forEach(function (l) { off[l[0] + '|' + l[1]] = off[l[1] + '|' + l[0]] = true; });
    });
    return off;
  }

  function allLinks(game) {
    var off = switchOff(game);
    var base = off ? game.job.links.filter(function (l) { return !off[l[0] + '|' + l[1]]; }) : game.job.links;
    return base.concat(game.state.extraLinks);
  }

  // Links a switch turns off right now (for drawing them dimmed).
  function deadLinks(game) {
    var sw = game.job.switches; if (!sw) return [];
    var out = [];
    sw.forEach(function (w) { out = out.concat(game.state.switches[w.at] === 'b' ? w.a : w.b); });
    return out;
  }

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

  function isBurned(game, id) {
    var st = game.state;
    return st.breach && id === entryOf(game.job) && id !== st.exit;
  }

  // Can the player step onto this node right now?
  function playerCanEnter(game, id) {
    if (isClosed(game, id)) return false;
    if (sentryAt(game, id)) return false;
    if (isAI(game, id) && !(game.state.ai && game.state.ai.trusted)) return false;
    if (isBurned(game, id)) return false;
    return true;
  }

  // Sentries may pass locks and firewalls but never the AI node.
  function sentryCanEnter(game, id) { return !isAI(game, id); }

  function sentryNeighbors(game, id) {
    return neighbors(game, id).filter(function (n) { return sentryCanEnter(game, n); });
  }

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

  function hasLure(game, s) {
    if (s.lure && !game.state.nodes[s.lure].decoy) s.lure = null;
    return !!s.lure;
  }

  // Nearest non-stunned, un-lured Sentry within DECOY_RANGE of `node`. Ties go
  // to array order. Returns the sentry or null.
  function claimDecoy(game, node) {
    var best = null; var bestD = Infinity;
    game.state.sentries.forEach(function (s) {
      if (s.camera || s.stun > 0 || hasLure(game, s)) return;
      var d = sentryDistances(game, s.pos)[node];
      if (d === undefined || d > DECOY_RANGE) return;
      if (d < bestD) { best = s; bestD = d; }
    });
    if (best) best.lure = node;
    return best;
  }

  function assignDecoys(game) {
    var st = game.state;
    st.sentries.forEach(function (s) { hasLure(game, s); });
    game.job.nodes.forEach(function (n) {
      if (!st.nodes[n.id].decoy) return;
      var claimed = st.sentries.some(function (s) { return s.lure === n.id; });
      if (!claimed) claimDecoy(game, n.id);
    });
  }

  function towards(game, sentry, node, why) {
    if (sentry.pos === node) return { type: 'scan', target: node, why: why };
    var step = sentryStepToward(game, sentry.pos, node);
    return step ? { type: 'move', target: step, why: why } : null;
  }

  // Can the player still reach the active exit, if Sentries stayed where
  // they are? Closed barriers count as passable (Brute or a clue may open
  // them); burned ENTRY, a locked UNKNOWN and Sentry nodes do not.
  function routeOut(game) {
    var st = game.state;
    if (!st.exit) return true;
    var dist = bfs(game, st.player, function (n) {
      return neighbors(game, n).filter(function (m) {
        return !sentryAt(game, m) && !isBurned(game, m) && !(isAI(game, m) && !(st.ai && st.ai.trusted));
      });
    }).dist;
    return dist[st.exit] !== undefined;
  }

  // Where a resting Sentry steps so the player has a route out again: a free
  // neighbour (not the player's node, not another Sentry's) that reopens one.
  // Nodes next to the player come first, then link order. Null if none does.
  function opensRoute(game, sentry, n) {
    var home = sentry.pos;
    sentry.pos = n; var open = routeOut(game); sentry.pos = home;
    return open;
  }

  function stepAside(game, sentry) {
    var st = game.state;
    var ok = sentryNeighbors(game, sentry.pos).filter(function (n) {
      if (n === st.player || sentryAt(game, n)) return false;
      return opensRoute(game, sentry, n);
    });
    var near = ok.filter(function (n) { return neighbors(game, n).indexOf(st.player) !== -1; });
    return near[0] || ok[0] || null;
  }

  // Patrol: head for the next node on the loop.
  function patrolIntent(game, sentry) {
    var guard = 0;
    while (sentry.loop[sentry.loopIndex] === sentry.pos && guard++ < sentry.loop.length) {
      sentry.loopIndex = (sentry.loopIndex + 1) % sentry.loop.length;
    }
    var p = sentryStepToward(game, sentry.pos, sentry.loop[sentry.loopIndex]);
    if (!p || p === sentry.pos) return { type: 'wait', why: 'patrol' };
    return { type: 'move', target: p, why: 'patrol' };
  }


  // BREACH, resting next to you: back off one step to a free node that is not
  // next to you and is not the exit, the farthest from you first (then link
  // order). Null if there is none.
  function retreatStep(game, sentry) {
    var st = game.state;
    var dp = sentryDistances(game, st.player);
    var c = sentryNeighbors(game, sentry.pos).filter(function (n) {
      if (n === st.player || n === st.exit || sentryAt(game, n)) return false;
      return neighbors(game, n).indexOf(st.player) === -1;
    });
    c.sort(function (a, b) { return (dp[b] === undefined ? 99 : dp[b]) - (dp[a] === undefined ? 99 : dp[a]); });
    return c[0] || null;
  }

  // v4 Tracer: before BREACH it walks your trail, one node at a time, in the
  // order you visited them (skipping loops you closed). Off the trail (after
  // a lure) it heads back to the last trail node it reached.
  function trailIntent(game, sentry) {
    var path = game.state.path;
    var i = path.lastIndexOf(sentry.pos);
    if (i !== -1) sentry.trail = i;
    var next = i !== -1 ? path[i + 1] : path[Math.min(sentry.trail, path.length - 1)];
    if (!next || next === sentry.pos) return { type: 'wait', why: 'trail' };
    var step = sentryStepToward(game, sentry.pos, next);
    if (!step || step === sentry.pos) return { type: 'wait', why: 'trail' };
    return { type: 'move', target: step, why: 'trail' };
  }

  function planIntent(game, sentry) {
    var st = game.state;
    if (sentry.stun > 0) return { type: 'stunned' };
    // A camera never moves. It watches every node linked to it: end a turn
    // on one and it scans you in the enemy phase (then rests a phase, like a
    // Sentry that just scanned you). Decoys, noise and BREACH don't move it.
    if (sentry.camera) {
      if (sentry.cooldown) return { type: 'wait', why: 'rest' };
      return { type: 'watch', nodes: neighbors(game, sentry.pos) };
    }
    var it;
    if (hasLure(game, sentry) && (it = towards(game, sentry, sentry.lure, 'decoy'))) return it;
    if (sentry.noisy && st.noise && (it = towards(game, sentry, st.noise, 'noise'))) return it;

    // Adjacency uses every link, so a Sentry next to UNKNOWN scans a player
    // hiding there even though it can never step in (rule 4).
    var adjacent = neighbors(game, sentry.pos).indexOf(st.player) !== -1;
    // A Sentry never scans the player two enemy phases in a row (cooldown), so
    // you can't be stun-locked in a dead end.
    if (adjacent && !sentry.cooldown) return { type: 'scan', target: st.player, why: 'player' };
    // During BREACH, a player on a node Sentries can't enter (UNKNOWN) has no
    // Sentry path to it: rule 5 says patrol, and that includes a resting
    // Sentry next to it, so two Sentries can't seal the room's exits for good.
    if (st.breach && sentryCanEnter(game, st.player)) {
      if (!adjacent) {
        var step = sentryStepToward(game, sentry.pos, st.player);
        if (step && step !== sentry.pos) return { type: 'move', target: step, why: 'hunt' };
      } else {
        // Resting (cooldown): instead of standing still it backs off one step
        // (why 'retreat') to a node that is not next to you and not the exit,
        // so a Sentry can't camp an exit or a chokepoint by alternating scan
        // and rest: every scan buys you one phase to slip past. With nowhere
        // to back off to, it takes its patrol step (which may mean walking
        // into you, a telegraphed bump you can dodge). If that can't move it
        // either (stuck behind another Sentry) while the Sentries cut off
        // every route from you to the exit, it steps aside to reopen one, and
        // only rests if it can't.
        var back = retreatStep(game, sentry);
        if (back) return { type: 'move', target: back, why: 'retreat' };
        var pat = patrolIntent(game, sentry);
        var stuck = pat.type !== 'move' || (pat.target !== st.player && sentryAt(game, pat.target));
        if (!stuck || routeOut(game)) return pat;
        var off = stepAside(game, sentry);
        if (off) return { type: 'move', target: off, why: 'hunt' };
        return { type: 'wait', why: 'rest' };
      }
    }

    if (sentry.tracer) return trailIntent(game, sentry);
    return patrolIntent(game, sentry);
  }

  function planSentry(game, sentry) {
    var it = planIntent(game, sentry);
    it.atPlayer = it.target !== undefined && it.target === game.state.player;
    sentry.intent = it;
  }

  function planAll(game) {
    assignDecoys(game);
    game.state.sentries.forEach(function (s) { planSentry(game, s); });
    untangle(game);
    holdWindow(game);
    unbox(game);
  }

  // BREACH, two hunters in a one-door pocket (CAM-03 with ENTRY burned, KIOSK
  // with AUTH-01 locked): the resting Sentry on the doorway can't back off
  // because the only way out is the node the other hunter is waiting on, and
  // that one wants the doorway. The one behind yields to a free node of its
  // own (the farthest from you first) and the resting one backs into the
  // node it left, so the doorway opens for a phase. `after` makes the enemy
  // phase run the yielding Sentry first.
  function untangle(game) {
    var st = game.state;
    if (!st.breach || st.status !== 'playing') return;
    var dp = sentryDistances(game, st.player);
    st.sentries.forEach(function (x) {
      var it = x.intent;
      if (x.camera || !x.cooldown || x.stun > 0 || !it) return;
      if (neighbors(game, x.pos).indexOf(st.player) === -1) return;
      var free = it.type === 'move' && it.target !== st.player && !sentryAt(game, it.target);
      if (free) return;
      st.sentries.forEach(function (y) {
        if (y === x || x.intent.after || !y.intent || y.intent.type !== 'move' || y.intent.target !== x.pos) return;
        if (neighbors(game, x.pos).indexOf(y.pos) === -1) return;
        var taken = st.sentries.map(function (s) { return s.intent && s.intent.type === 'move' ? s.intent.target : null; });
        var c = sentryNeighbors(game, y.pos).filter(function (n) {
          return n !== x.pos && n !== st.player && n !== st.exit && !sentryAt(game, n) && taken.indexOf(n) === -1;
        });
        if (!c.length) return;
        c.sort(function (a, b) { return (dp[b] === undefined ? 99 : dp[b]) - (dp[a] === undefined ? 99 : dp[a]); });
        y.intent = { type: 'move', target: c[0], why: 'retreat', atPlayer: false };
        x.intent = { type: 'move', target: y.pos, why: 'retreat', atPlayer: false, after: y.id };
      });
    });
  }

  // Every scan buys you a phase: when a Sentry backs off a node next to you,
  // no other Sentry steps onto that node in the same enemy phase (it waits
  // instead), so the gap the back-off opens is real.
  function holdWindow(game) {
    var st = game.state;
    if (!st.breach) return;
    var left = st.sentries.filter(function (s) { return s.intent && s.intent.why === 'retreat' && s.intent.type === 'move'; })
      .map(function (s) { return s.pos; });
    if (!left.length) return;
    st.sentries.forEach(function (y) {
      var it = y.intent;
      if (!it || it.type !== 'move' || it.why === 'retreat' || it.why === 'decoy') return;
      if (left.indexOf(it.target) === -1) return;
      y.intent = { type: 'wait', why: 'blocked', atPlayer: false };
    });
  }

  // No softlock: if Sentries are the reason you can't move at all (every node
  // linked to yours is blocked, and at least one only by a Sentry), and none
  // of those Sentries is about to leave, the first resting one steps off to a
  // free node instead. A Sentry that isn't resting scans you first and rests
  // the phase after, so you are never boxed in for more than two enemy
  // phases (four if a blocker was Worm-stunned). This matters most on UNKNOWN,
  // which Sentries can't enter: two of them on its doorways would otherwise
  // seal you in. Two hunters stuck in a one-door pocket are handled by
  // untangle (above).
  function unbox(game) {
    var st = game.state;
    if (st.status !== 'playing') return;
    var adj = neighbors(game, st.player);
    if (adj.some(function (n) { return playerCanEnter(game, n); })) return;
    var blockers = st.sentries.filter(function (s) { return adj.indexOf(s.pos) !== -1; });
    if (!blockers.length) return;
    var leaving = blockers.some(function (s) {
      var it = s.intent;
      return it && it.type === 'move' && it.target !== st.player && !sentryAt(game, it.target);
    });
    if (leaving) return;
    var taken = st.sentries.map(function (s) { return s.intent && s.intent.type === 'move' ? s.intent.target : null; });
    for (var i = 0; i < blockers.length; i++) {
      var s = blockers[i];
      if (s.camera || s.stun > 0 || !s.cooldown || hasLure(game, s)) continue;
      var free = sentryNeighbors(game, s.pos).filter(function (n) {
        return n !== st.player && !sentryAt(game, n) && taken.indexOf(n) === -1;
      });
      if (!free.length) continue;
      s.intent = { type: 'move', target: free[0], why: 'retreat', atPlayer: false };
      return;
    }
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

  function lose(game, events, reason, text) {
    var st = game.state;
    if (st.status !== 'playing') return;
    st.status = 'lost';
    st.reason = reason;
    game.undoStack = []; // a lost run is final
    ev(game, events, 'lose', text, { reason: reason });
  }

  // extra: { sentry, node }
  function addHeat(game, events, amount, cause, text, extra) {
    var st = game.state;
    st.heat = Math.min(HEAT_MAX, st.heat + amount);
    var e = { amount: amount, cause: cause, total: st.heat };
    if (extra) for (var k in extra) e[k] = extra[k];
    ev(game, events, 'heat', text + ' +' + amount + ' heat.', e);
    if (st.heat >= HEAT_MAX) lose(game, events, 'traced', 'Traced. Heat hit ' + HEAT_MAX + '.');
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
    // "open node" = one you could stand on with no Sentry on it.
    return !isClosed(game, id) && !isAI(game, id) && !sentryAt(game, id) && id !== game.state.player;
  }

  function programTargets(game, prog) {
    var st = game.state;
    if (canAct(game) || !st.charges[prog]) return [];
    if (st.actions < programCost(prog)) return [];
    var adj = neighbors(game, st.player);
    if (prog === 'decoy') return adj.filter(function (n) { return isOpenNode(game, n) && !st.nodes[n].decoy; });
    if (prog === 'worm') return adj.filter(function (n) { return isOpenNode(game, n) && !st.nodes[n].infected; });
    if (prog === 'brute') return adj.filter(function (n) { return isClosed(game, n); });
    if (prog === 'tunnel') {
      var d = bfs(game, st.player, function (n) { return neighbors(game, n); }).dist;
      return game.job.nodes.map(function (n) { return n.id; }).filter(function (n) {
        return d[n] === TUNNEL_RANGE && playerCanEnter(game, n);
      });
    }
    return [];
  }

  // Sentries (and cameras) Freeze would hit: within FREEZE_RANGE hops of you
  // over any link, not already stunned.
  function freezeTargets(game) {
    var st = game.state;
    var d = bfs(game, st.player, function (n) { return neighbors(game, n); }).dist;
    return st.sentries.filter(function (s) { return s.stun <= 0 && d[s.pos] !== undefined && d[s.pos] <= FREEZE_RANGE; });
  }

  function canRun(game, prog) {
    var st = game.state;
    if (!PROGRAMS[prog] || canAct(game) || !st.charges[prog]) return false;
    if (st.actions < programCost(prog)) return false;
    var t = PROGRAMS[prog].target;
    if (t === 'self') {
      if (prog === 'spoof') return !st.spoof;
      if (prog === 'sniff') return hiddenWithin(game, SNIFF_RANGE).length > 0 || !st.exitKnown;
      if (prog === 'freeze') return freezeTargets(game).length > 0;
      return true;
    }
    return programTargets(game, prog).length > 0;
  }

  // Extract is a free action (see extract()): it uses no action, but like
  // everything else it needs your turn to still be running (1+ actions left).
  function canExtract(game) {
    var st = game.state;
    if (canAct(game)) return false;
    if (isFile(game, st.player)) return !st.files[st.player];
    return !st.hasData && nodeDef(game.job, st.player).type === 'target';
  }

  // v4 greed: a side file (node with `file: true`). Extract on it pays
  // FILE_VALUE and adds +1 to every BREACH trace tick from then on.
  function isFile(game, id) { var d = nodeDef(game.job, id); return !!(d && d.file); }
  function fileCount(game) { return Object.keys(game.state.files || {}).length; }
  function traceRate(game) { return HEAT.trace + fileCount(game); }

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
      if (s.intent && s.intent.type === 'watch' && s.intent.nodes.indexOf(st.player) !== -1) {
        out.push({ sentry: s.id, type: 'scan', heat: HEAT.scan, why: 'camera' });
        return;
      }
      if (!s.intent || s.intent.target !== st.player) return;
      if (s.intent.type === 'scan') out.push({ sentry: s.id, type: 'scan', heat: HEAT.scan, why: s.intent.why });
      if (s.intent.type === 'move') out.push({ sentry: s.id, type: 'bump', heat: HEAT.bump, why: s.intent.why });
    });
    return out;
  }

  // The BREACH trace clock is running (adds +1 heat at this turn's upkeep).
  function tracing(game) {
    var st = game.state;
    return !!(st.breach && st.turn > st.breachTurn);
  }

  function exitInfo(game) {
    var st = game.state; var job = game.job;
    var known = !!(st.exitKnown || st.breach);
    return { candidates: job.exits.slice(), exit: known ? job.exits[job.exitIndex] : null, known: known };
  }

  function bonusMet(game) {
    var st = game.state; var b = game.job.bonus;
    if (!b) return false;
    if (b.id === 'ghost') return !st.detected;
    if (b.id === 'wormStun') return st.wormStuns > 0;
    if (b.id === 'greedy') {
      return game.job.nodes.every(function (n) { return !n.cache || n.cache.kind !== 'cash' || !!st.taken[n.id]; });
    }
    if (b.id === 'quiet') return st.programsUsed.indexOf('brute') === -1;
    if (b.id === 'speed') return st.turn <= b.turn;
    if (b.id === 'cool') return st.heat <= b.heat;
    if (b.id === 'bare') return st.programsUsed.length === 0;
    return false;
  }

  function baseParOf(game) {
    return game.par || game.state.par || (game.job.payout && game.job.payout.par) || 0;
  }

  // PAR after UNKNOWN's cut: half the cut comes off the bar (rounded down to
  // $10), so a clean trusted run can still beat PAR, but a deal is a real
  // price. v2 dropped PAR by the whole cut, and trusting both deals (PAR
  // halved) became the easy road to ★2 for a typical player; with no drop at
  // all, ★2 was out of reach on almost every trusted run.
  function parOf(game) {
    var p = baseParOf(game);
    var rate = cutRate(game) * PAR_SHARE;
    return rate > 0 ? Math.floor(p * Math.max(0, 1 - rate) / 10) * 10 : p;
  }

  // UNKNOWN's cut for one offer (a fraction of the payout). Offers can set
  // their own `cut`; the default is AI_CUT.
  function offerCut(game, id) {
    var d = aiOfferDef(game.job, id);
    return d && typeof d.cut === 'number' ? d.cut : AI_CUT;
  }

  // The total cut so far: each trusted offer's own cut. Deals counted without
  // a recorded answer (hand-made states) cost AI_CUT each.
  function cutRate(game) {
    var ai = game.state.ai; if (!ai || !ai.deals) return 0;
    var r = 0; var n = 0;
    Object.keys(ai.answers || {}).forEach(function (id) {
      if (ai.answers[id] === 'trusted') { r += offerCut(game, id); n++; }
    });
    return r + AI_CUT * Math.max(0, ai.deals - n);
  }

  function pctText(x) { return Math.round(x * 100) + '%'; }

  // An offer's terms with its price filled in: "another" only once a deal
  // has already been taken.
  function offerTerms(game, id) {
    var d = aiOfferDef(game.job, id); if (!d || !d.terms) return '';
    var ai = game.state.ai;
    return d.terms.replace(/\{cut\}/g, pctText(offerCut(game, id)))
      .replace(/\{another\}/g, ai && ai.deals > 0 ? 'another ' : '');
  }

  // Payout "if you escaped now". A lost run pays 0.
  function payout(game) {
    var st = game.state; var job = game.job;
    var base = (job.payout && job.payout.base) || 0;
    var lines = [
      { id: 'base', label: 'Contract', amount: base },
      { id: 'caches', label: 'Caches', amount: st.cash },
      { id: 'speed', label: 'Turns to spare', amount: PAY.turn * (job.turnLimit - st.turn) },
      { id: 'heat', label: 'Heat', amount: st.heat ? -PAY.heat * st.heat : 0 }
    ];
    if (st.fileCash) lines.splice(2, 0, { id: 'files', label: 'Side files', amount: st.fileCash });
    var sub = lines.reduce(function (a, l) { return a + l.amount; }, 0);
    var rate = cutRate(game);
    var cut = 0;
    if (rate > 0) {
      // Choice: the cut is taken from a non-negative subtotal, so it never adds money.
      // The cut line absorbs the $10 rounding, so the lines always add up to
      // the total shown.
      cut = sub > 0 ? round10(sub * Math.max(0, 1 - rate)) - round10(sub) : 0;
      lines.push({ id: 'cut', label: 'UNKNOWN’s cut', amount: cut });
    }
    var total = Math.max(0, round10(sub) + cut);
    if (st.status === 'lost') total = 0;
    return { lines: lines, cut: cut, total: total, par: parOf(game), basePar: baseParOf(game) };
  }

  function stars(game) {
    var st = game.state;
    var escaped = st.status === 'won';
    var p = escaped && payout(game).total >= parOf(game);
    var b = escaped && bonusMet(game);
    return {
      escaped: escaped, par: p, bonus: b,
      count: escaped ? 1 + (p ? 1 : 0) + (b ? 1 : 0) : 0,
      // v1 aliases, so old callers don't crash. Prefer the fields above.
      finished: escaped, lowHeat: escaped && st.heat <= STAR_HEAT, unseen: escaped && !st.detected
    };
  }

  // ---------- player actions ----------

  function pickUpCache(game, id, events) {
    var st = game.state; var def = nodeDef(game.job, id);
    if (!def.cache || st.taken[id]) return;
    st.taken[id] = true;
    if (def.cache.kind === 'cash') {
      var value = CACHE_VALUE * (st.breach ? 2 : 1);
      st.cash += value;
      ev(game, events, 'cache', (st.breach ? 'Hot data on ' : 'Cache on ') + def.label + ': +$' + value + '.',
        { node: id, value: value, hot: st.breach });
    } else if (def.cache.kind === 'charge') {
      var prog = def.cache.prog || 'brute';
      st.charges[prog] = (st.charges[prog] || 0) + 1;
      ev(game, events, 'cache', def.label + ' had a spare ' + (PROGRAMS[prog] ? PROGRAMS[prog].name : prog) + ': +1 charge.',
        { node: id, charge: prog });
    }
  }

  function enterNode(game, id, events) {
    var st = game.state; var def = nodeDef(game.job, id); var ns = st.nodes[id];
    var from = st.player;
    st.player = id;
    st.path.push(id);
    ev(game, events, 'move', 'You moved to ' + def.label + '.', { from: from, to: id });
    var wasHidden = ns.hidden;
    if (wasHidden) {
      ns.hidden = false;
      var trap = def.type === 'honeypot';
      ev(game, events, 'reveal', trap ? def.label + ' was a honeypot.' : def.label + ' revealed: a cache.',
        { node: id, trap: trap });
    }
    if (def.type === 'honeypot' && !ns.sprung) {
      ns.sprung = true;
      addHeat(game, events, HEAT.honeypot, 'honeypot', 'Honeypot tripped.', { node: id });
    }
    // Hidden contents are final: no taking back a trap or peeking at loot.
    if (wasHidden) game.undoStack = [];
    if (st.status !== 'playing') return;
    (game.job.clues || []).forEach(function (c) {
      if (c.at === id && !st.nodes[id].clueFound) {
        st.nodes[id].clueFound = true;
        st.nodes[c.opens].open = true;
        ev(game, events, 'clue', c.text, { node: c.opens });
      }
    });
    pickUpCache(game, id, events);
    (game.job.switches || []).forEach(function (w) {
      if (w.at !== id) return;
      st.switches[id] = st.switches[id] === 'b' ? 'a' : 'b';
      ev(game, events, 'flip', def.label + ' flipped. ' + (w.text ? w.text[st.switches[id]] : 'The links changed.'), { node: id, state: st.switches[id] });
      // Intents stay as shown, except a step along a link that just went
      // dark: that Sentry re-plans (its new step shows at once).
      st.sentries.forEach(function (x) {
        var it = x.intent;
        if (it && it.type === 'move' && it.target !== x.pos && !isLinked(game, x.pos, it.target)) planSentry(game, x);
      });
    });
    if (st.hasData && id === st.exit) {
      st.status = 'won';
      game.undoStack = []; // a won run is final
      ev(game, events, 'win', 'Out through ' + def.label + ' with the data.', { exit: id });
      return;
    }
    var sc = aiOfferDef(game.job, 'shortcut');
    if (st.ai && sc && !st.ai.offered && isLinked(game, id, game.job.ai.node)) {
      st.ai.offered = true;
      st.ai.pending = 'shortcut';
      ev(game, events, 'aiOffer', 'UNKNOWN wants to talk.', { offer: 'shortcut', voice: sc.voice, terms: offerTerms(game, 'shortcut') });
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
    if (isBurned(game, id)) return 'ENTRY is burned. Run for the exit.';
    if (def.type === 'firewall') return 'Firewall. Only Brute opens it.';
    if (def.type === 'lock') return 'Locked. Brute it or find the password.';
    if (def.type === 'ai') return 'UNKNOWN won’t let you in.';
    return 'Blocked.';
  }

  function runProgram(game, prog, target) {
    var why = canAct(game); if (why) return fail(why);
    var st = game.state;
    if (!PROGRAMS[prog]) return fail('Unknown program.');
    if (!st.charges[prog]) return fail(PROGRAMS[prog].name + ' is used up.');
    if (st.actions < programCost(prog)) return fail(PROGRAMS[prog].name + ' needs ' + programCost(prog) + ' actions.');
    var events = [];
    var clearUndo = false;
    if (prog === 'sniff') {
      var found = hiddenWithin(game, SNIFF_RANGE);
      if (!found.length && st.exitKnown) return fail('Nothing hidden within 2 hops.');
      snapshot(game);
      ev(game, events, 'program', 'Sniff running.', { prog: prog });
      if (found.length) {
        found.forEach(function (id) { st.nodes[id].hidden = false; });
        var traps = found.filter(function (id) { return nodeDef(game.job, id).type === 'honeypot'; });
        var parts = found.map(function (id) {
          return label(game, id) + (traps.indexOf(id) !== -1 ? ' is a honeypot.' : ' is a cache.');
        });
        ev(game, events, 'reveal', 'Sniff: ' + parts.join(' '), { nodes: found, trap: traps.length > 0, traps: traps, by: 'sniff' });
      }
      if (!st.exitKnown) {
        st.exitKnown = true;
        var ex = game.job.exits[game.job.exitIndex];
        ev(game, events, 'exitKnown', 'Sniff traced the way out: BREACH will open ' + label(game, ex) + '.', { exit: ex });
      }
      clearUndo = true; // you can't un-learn information
    } else if (prog === 'freeze') {
      var hit = freezeTargets(game);
      if (!hit.length) return fail('No Sentry within 2 hops.');
      snapshot(game);
      hit.forEach(function (x) { x.stun = Math.max(x.stun, FREEZE_TURNS); });
      ev(game, events, 'program', 'Freeze: ' + hit.map(function (x) { return (x.camera ? 'Camera ' : 'Sentry ') + x.id; }).join(', ') + ' skip their next phase.',
        { prog: prog });
      ev(game, events, 'freeze', 'Frozen for 1 phase.', { sentries: hit.map(function (x) { return x.id; }) });
      hit.forEach(function (x) { planSentry(game, x); });
    } else if (prog === 'spoof') {
      if (st.spoof) return fail('Spoof is already running.');
      snapshot(game);
      st.spoof = true;
      ev(game, events, 'program', 'Spoof up. Scans and bumps miss you until your next turn.', { prog: prog });
    } else {
      if (programTargets(game, prog).indexOf(target) === -1) return fail('Pick a highlighted node.');
      snapshot(game);
      var lbl = label(game, target);
      if (prog === 'decoy') {
        st.nodes[target].decoy = true;
        var s = claimDecoy(game, target);
        if (s) planSentry(game, s);
        ev(game, events, 'program', 'Decoy planted on ' + lbl + '.' +
          (s ? ' Sentry ' + s.id + ' took the bait.' : ' No Sentry is close enough to notice.'),
          { prog: prog, node: target, lured: s ? s.id : null });
      } else if (prog === 'tunnel') {
        var from0 = st.player;
        st.extraLinks.push([from0, target]);
        ev(game, events, 'program', 'Tunnel dug from ' + label(game, from0) + ' to ' + lbl + '.', { prog: prog, node: target });
        ev(game, events, 'tunnel', 'New link: ' + label(game, from0) + ' ↔ ' + lbl + '. Sentries can use it too.', { from: from0, to: target });
      } else if (prog === 'worm') {
        st.nodes[target].infected = true;
        ev(game, events, 'program', 'Worm planted on ' + lbl + '.', { prog: prog, node: target });
      } else if (prog === 'brute') {
        st.nodes[target].open = true;
        ev(game, events, 'program', 'Brute smashed ' + lbl + '.', { prog: prog, node: target });
        ev(game, events, 'open', lbl + ' is open.', { node: target, by: 'brute' });
        addHeat(game, events, HEAT.brute, 'brute', 'Brute is loud.', { node: target });
        if (st.status === 'playing') {
          st.noise = target;
          var heard = [];
          st.sentries.forEach(function (x) {
            if (x.camera || x.stun > 0 || hasLure(game, x)) return;
            var d = sentryDistances(game, x.pos)[target];
            if (d !== undefined && d <= NOISE_RANGE) { x.noisy = true; heard.push(x.id); planSentry(game, x); }
          });
          ev(game, events, 'noise', heard.length ? 'Sentry ' + heard.join(' and ') + ' heard it.' : 'Nobody close enough to hear it.',
            { node: target, sentries: heard });
        }
      }
    }
    st.charges[prog] -= 1;
    st.actions -= programCost(prog);
    st.programsUsed.push(prog);
    if (clearUndo) game.undoStack = [];
    return { ok: true, events: events };
  }

  function extract(game) {
    if (!canExtract(game)) return fail(canAct(game) || 'Nothing to extract here.');
    snapshot(game);
    var st = game.state; var job = game.job; var events = [];
    if (isFile(game, st.player)) {
      st.files[st.player] = true;
      st.fileCash += FILE_VALUE;
      var nf = fileCount(game);
      ev(game, events, 'file', 'Side file from ' + label(game, st.player) + ': +$' + FILE_VALUE + '. The trace will run +' + traceRate(game) + ' a turn.',
        { node: st.player, value: FILE_VALUE, files: nf });
      return { ok: true, events: events };
    }
    st.hasData = true;
    // Extract costs no action: the download is the climax, and you keep
    // the rest of your turn to start running.
    st.breach = true;
    st.breachTurn = st.turn;
    st.exit = job.exits[job.exitIndex];
    st.exitKnown = true;
    ev(game, events, 'extract', 'Data copied.', { node: st.player });
    // A shortcut with `untilExtract` only gets you in: UNKNOWN pulls the
    // link once you hold the data.
    var scd = aiOfferDef(job, 'shortcut');
    if (st.ai && st.ai.trusted && scd && scd.untilExtract && st.extraLinks.length) {
      var tl = scd.trustLink;
      st.extraLinks = st.extraLinks.filter(function (l) { return !(l[0] === tl[0] && l[1] === tl[1]); });
      ev(game, events, 'ai', 'UNKNOWN closed the path behind you.', { offer: 'shortcut', closed: true });
    }
    addHeat(game, events, HEAT.extract, 'extract', 'Extract.', { node: st.player });
    if (st.status !== 'playing') return { ok: true, events: events };
    var entry = entryOf(job);
    var burned = st.exit !== entry ? entry : null;
    ev(game, events, 'breach', 'BREACH. ' + (burned ? 'ENTRY is burned. ' : '') + 'Run for ' + label(game, st.exit) + '.',
      { exit: st.exit, burned: burned });
    var fr = aiOfferDef(job, 'freeze');
    if (st.ai && fr && !st.ai.answers.freeze) {
      st.ai.pending = 'freeze';
      ev(game, events, 'aiOffer', 'UNKNOWN wants to talk.', { offer: 'freeze', voice: fr.voice, terms: offerTerms(game, 'freeze') });
    }
    planAll(game);
    // Choice: Extract is final (it reveals the exit, and you can't un-learn information).
    game.undoStack = [];
    return { ok: true, events: events };
  }

  function undo(game) {
    if (game.state.status !== 'playing') return fail('The job is over.');
    // The UI also blocks this, but the rule lives here: an offer you have seen
    // can't be taken back by stepping away from it.
    if (game.state.ai && game.state.ai.pending) return fail('Answer UNKNOWN first.');
    if (!game.undoStack.length) return fail('Nothing to undo this turn.');
    game.state = game.undoStack.pop();
    return { ok: true, events: [] };
  }

  // Answering commits the turn so far (Undo history clears), so an offer can't
  // be re-rolled by undoing the step that triggered it. Refusing is free.
  function answerAI(game, trust) {
    var st = game.state;
    if (!st.ai || !st.ai.pending) return fail('No offer to answer.');
    var offer = st.ai.pending;
    var events = [];
    st.ai.pending = null;
    st.ai.answers[offer] = trust ? 'trusted' : 'refused';
    var another = st.ai.deals > 0 ? 'another ' : '';
    var price = pctText(offerCut(game, offer));
    if (trust) st.ai.deals += 1;
    if (offer === 'shortcut') {
      if (trust) {
        st.ai.trusted = true;
        var def = aiOfferDef(game.job, 'shortcut');
        var link = (def && def.trustLink) || game.job.ai.trustLink;
        st.extraLinks.push(link.slice());
        ev(game, events, 'ai', 'UNKNOWN opened a path to ' + label(game, link[1]) + '. It takes ' + another + price + '.', { offer: offer, trust: true });
      } else {
        st.ai.refused = true;
        ev(game, events, 'ai', 'You refused. UNKNOWN went quiet.', { offer: offer, trust: false });
      }
    } else if (offer === 'freeze') {
      if (trust) {
        ev(game, events, 'ai', 'UNKNOWN rides your copy. The Sentries freeze. It takes ' + another + price + '.', { offer: offer, trust: true });
        st.sentries.forEach(function (s) {
          s.stun = Math.max(s.stun, 1);
          ev(game, events, 'stun', 'Sentry ' + s.id + ' froze.', { sentry: s.id, turns: s.stun, by: 'ai' });
        });
        planAll(game);
      } else {
        ev(game, events, 'ai', 'You refused. You’re on your own.', { offer: offer, trust: false });
      }
    } else {
      ev(game, events, 'ai', trust ? 'You trusted UNKNOWN.' : 'You refused UNKNOWN.', { offer: offer, trust: !!trust });
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

  function wipeDecoy(game, s, node, events, verb) {
    var st = game.state;
    if (!st.nodes[node].decoy) return;
    st.nodes[node].decoy = false;
    st.sentries.forEach(function (x) { if (x.lure === node) x.lure = null; });
    ev(game, events, 'sentry', 'Sentry ' + s.id + ' ' + verb + ' the decoy and wiped it.', { sentry: s.id, wiped: node });
  }

  function runSentry(game, s, events) {
    var st = game.state; var it = s.intent || { type: 'wait' };
    if (it.type !== 'scan') s.cooldown = false;
    if (it.type === 'watch') {
      if (it.nodes.indexOf(st.player) === -1) return;
      s.cooldown = true;
      ev(game, events, 'scan', 'Camera ' + s.id + ' scanned ' + label(game, st.player) + '.',
        { sentry: s.id, node: st.player, hit: !st.spoof, spoofed: st.spoof, why: 'camera' });
      if (st.spoof) ev(game, events, 'miss', 'Camera ' + s.id + ' saw you. Spoof held.', { sentry: s.id, node: st.player });
      else {
        st.detected = true;
        addHeat(game, events, HEAT.scan, 'scan', 'Camera ' + s.id + ' scanned you.', { sentry: s.id, node: st.player });
      }
      return;
    }
    if (it.type === 'stunned') {
      s.stun = Math.max(0, s.stun - 1);
      ev(game, events, 'sentryWait', 'Sentry ' + s.id + ' is stunned.', { sentry: s.id, why: 'stunned' });
      return;
    }
    // An intent aimed at your node fires on an empty node: you dodged it. The
    // dodge event follows the scan/sentryMove event it belongs to.
    var dodged = it.atPlayer && it.target !== st.player && (it.type === 'scan' || it.type === 'move');
    function dodge() { if (dodged) ev(game, events, 'dodge', 'You dodged Sentry ' + s.id + '.', { sentry: s.id, node: it.target }); }
    if (it.type === 'scan') {
      s.cooldown = it.why === 'player';
      var onYou = it.target === st.player;
      ev(game, events, 'scan', 'Sentry ' + s.id + ' scanned ' + label(game, it.target) + '.',
        { sentry: s.id, node: it.target, hit: onYou && !st.spoof, spoofed: onYou && st.spoof, why: it.why });
      dodge();
      wipeDecoy(game, s, it.target, events, 'scanned');
      if (onYou) {
        if (st.spoof) ev(game, events, 'miss', 'Sentry ' + s.id + ' scanned you. Spoof held.', { sentry: s.id, node: it.target });
        else {
          st.detected = true;
          addHeat(game, events, HEAT.scan, 'scan', 'Sentry ' + s.id + ' scanned you.', { sentry: s.id, node: it.target });
        }
      }
      return;
    }
    if (it.type === 'move') {
      if (it.target === st.player) {
        ev(game, events, 'bump', 'Sentry ' + s.id + ' walked into you.', { sentry: s.id, node: it.target, spoofed: st.spoof, why: it.why });
        if (st.spoof) ev(game, events, 'miss', 'Sentry ' + s.id + ' walked into you. Spoof held.', { sentry: s.id, node: it.target });
        else {
          st.detected = true;
          addHeat(game, events, HEAT.bump, 'bump', 'Sentry ' + s.id + ' bumped into you.', { sentry: s.id, node: it.target });
        }
        // Walking into you on a decoy counts as reaching it: the decoy is
        // wiped, so a lured Sentry can't keep bumping you there forever.
        if (st.status === 'playing') wipeDecoy(game, s, it.target, events, 'reached');
        return; // the Sentry stays put either way
      }
      if (sentryAt(game, it.target)) { // blocked by another Sentry
        ev(game, events, 'sentryWait', 'Sentry ' + s.id + ' is blocked.', { sentry: s.id, why: 'blocked' });
        dodge();
        return;
      }
      var from = s.pos;
      s.pos = it.target;
      ev(game, events, 'sentryMove', 'Sentry ' + s.id + ' → ' + label(game, it.target) + '.',
        { sentry: s.id, from: from, to: it.target, why: it.why });
      dodge();
      var ns = st.nodes[it.target];
      wipeDecoy(game, s, it.target, events, 'reached');
      if (ns.infected) {
        ns.infected = false;
        s.stun = STUN_TURNS;
        st.wormStuns += 1;
        ev(game, events, 'stun', 'Sentry ' + s.id + ' hit the worm. Stunned for ' + STUN_TURNS + ' turns.',
          { sentry: s.id, turns: STUN_TURNS, by: 'worm', node: it.target });
      }
      if (s.loop[s.loopIndex] === s.pos) s.loopIndex = (s.loopIndex + 1) % s.loop.length;
      return;
    }
    ev(game, events, 'sentryWait', 'Sentry ' + s.id + (it.why === 'rest' ? ' catches its breath.' : ' waits.'),
      { sentry: s.id, why: it.why || 'patrol' });
  }

  // v4 alert levels: when heat reaches an alert's `at`, the admin acts at
  // the end of that turn. The levels and what they do are listed on the HUD
  // from the start, so nothing comes as a surprise.
  //   spawn:    a new Sentry (alert.sentry: { id, patrol }) joins at patrol[0]
  //   lockdown: barriers in alert.nodes close again (Brute or a clue reopens)
  function fireAlerts(game, events) {
    var st = game.state;
    (game.job.alerts || []).forEach(function (a, i) {
      if (st.alerts[i] || st.heat < a.at) return;
      st.alerts[i] = true;
      var text = 'ALERT ' + (i + 1) + ': ' + (a.text || 'the admin reacts.');
      if (a.kind === 'spawn') {
        st.incoming.push({ def: a.sentry, turn: st.turn, why: 'alert' });
        ev(game, events, 'alert', text, { level: i + 1, at: a.at, type: a.kind, sentry: a.sentry.id });
      } else if (a.kind === 'lockdown') {
        a.nodes.forEach(function (n) { st.nodes[n].open = false; });
        ev(game, events, 'alert', text, { level: i + 1, at: a.at, type: a.kind, nodes: a.nodes.slice() });
      }
    });
  }

  // Sentries that are due join the board at the first free node of their
  // patrol, or a free neighbour of it. Never on you or next to you; if
  // there's no room, they try again next turn.
  function arrivals(game, events) {
    var st = game.state;
    st.incoming = st.incoming.filter(function (x) {
      if (x.turn > st.turn) return true;
      var home = x.def.patrol[0];
      var cands = [home].concat(sentryNeighbors(game, home));
      var adj = neighbors(game, st.player);
      var at = cands.filter(function (n) {
        return n !== st.player && !sentryAt(game, n) && adj.indexOf(n) === -1 && !isAI(game, n);
      })[0];
      if (!at) return true;
      var s = makeSentry({ id: x.def.id, start: at, patrol: x.def.patrol, tracer: x.def.tracer });
      if (s.tracer) s.trail = 0;
      st.sentries.push(s);
      ev(game, events, 'arrive', (s.tracer ? 'A Tracer' : 'Sentry ' + s.id) + ' joined at ' + label(game, at) + '.', { sentry: s.id, node: at, why: x.why });
      return false;
    });
  }

  // Extra state for search de-duplication (tools/beam.js, tools/bot.js):
  // the v4 fields, and for a Tracer the trail ahead of it.
  function searchKey(st) {
    var k = [st.switches, st.files, st.alerts, st.incoming.length, st.extraLinks];
    if (st.sentries.some(function (s) { return s.tracer; }) || st.incoming.some(function (x) { return x.def.tracer; })) k.push(st.path.slice(-8));
    return k;
  }

  function tag(events, from, fields) {
    for (var i = from; i < events.length; i++) for (var k in fields) events[i][k] = fields[k];
  }

  function endTurn(game) {
    var st = game.state;
    if (st.status !== 'playing') return fail('The job is over.');
    if (st.ai && st.ai.pending) return fail('Answer UNKNOWN first.');
    var events = [];

    // 3. Enemy phase: Sentries carry out the intents that were shown, in order.
    // A Sentry backing into a node another one is leaving (untangle) runs
    // after it; everyone else runs in order.
    var ran = {};
    var runOne = function (s) {
      if (ran[s.id] || st.status !== 'playing') return;
      ran[s.id] = true;
      var after = s.intent && s.intent.after;
      if (after) st.sentries.forEach(function (y) { if (y.id === after) runOne(y); });
      runSentry(game, s, events);
    };
    for (var i = 0; i < st.sentries.length && st.status === 'playing'; i++) runOne(st.sentries[i]);
    tag(events, 0, { phase: 'enemy' });
    // Noise lasts for one enemy phase only.
    st.noise = null;
    st.sentries.forEach(function (s) { s.noisy = false; });
    if (st.status !== 'playing') { game.undoStack = []; return { ok: true, events: events }; }

    // 4. Upkeep: BREACH trace clock (from the upkeep after the Extract turn's).
    var mark = events.length;
    if (tracing(game)) {
      if (!st.traceStarted) {
        st.traceStarted = true;
        ev(game, events, 'traceStart', 'The admin is tracing you. +' + traceRate(game) + ' heat every turn now.');
      }
      addHeat(game, events, traceRate(game), 'trace', 'Admin trace.');
    }
    if (st.status === 'playing') {
      st.turn += 1;
      if (st.turn > game.job.turnLimit) {
        st.turn = game.job.turnLimit;
        lose(game, events, 'dropped', 'Connection dropped. Out of turns.');
      }
    }
    if (st.status === 'playing') { fireAlerts(game, events); arrivals(game, events); }
    tag(events, mark, { phase: 'upkeep' });
    // Overclock: ending a turn with actions left banks one extra (max 3).
    st.actions = ACTIONS_PER_TURN + (st.actions > 0 ? 1 : 0);
    st.banked = st.actions === ACTIONS_MAX;
    st.spoof = false;
    game.undoStack = [];

    // 5. New intents.
    if (st.status === 'playing') planAll(game);
    return { ok: true, events: events };
  }

  var Engine = {
    HEAT_MAX: HEAT_MAX, ACTIONS_PER_TURN: ACTIONS_PER_TURN, ACTIONS_MAX: ACTIONS_MAX, HEAT: HEAT, PROGRAMS: PROGRAMS,
    PROGRAM_ORDER: PROGRAM_ORDER, STAR_HEAT: STAR_HEAT, TRACE_TURNS: TRACE_TURNS, CACHE_VALUE: CACHE_VALUE,
    DECOY_RANGE: DECOY_RANGE, NOISE_RANGE: NOISE_RANGE, SNIFF_RANGE: SNIFF_RANGE, STUN_TURNS: STUN_TURNS, AI_CUT: AI_CUT, offerTerms: offerTerms, offerCut: offerCut,
    newGame: newGame, nodeDef: nodeDef, neighbors: neighbors, allLinks: allLinks, sentryAt: sentryAt,
    isClosed: isClosed, isBarrier: isBarrier, isBurned: isBurned, legalMoves: legalMoves, programTargets: programTargets,
    canRun: canRun, canExtract: canExtract, threats: threats, tracing: tracing, stars: stars,
    payout: payout, bonusMet: bonusMet, LOSSY_BONUS: ['ghost', 'quiet', 'speed', 'cool', 'bare'], exitInfo: exitInfo, resolveJob: resolveJob, canonicalVariant: canonicalVariant,
    programCost: programCost, programsFor: programsFor, deadLinks: deadLinks, isFile: isFile, fileCount: fileCount,
    traceRate: traceRate, freezeTargets: freezeTargets, searchKey: searchKey, FILE_VALUE: FILE_VALUE,
    move: move, runProgram: runProgram, extract: extract, undo: undo, answerAI: answerAI,
    abort: abort, endTurn: endTurn, replan: planAll, blockedReason: blockedReason, canAct: canAct, clone: clone
  };

  root.BackdoorEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
