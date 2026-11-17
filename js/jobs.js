/*
 * Job definitions for the Backdoor hacking prototype (v2).
 *
 * Each job is plain data. The engine resolves it with one seeded variant
 * (E.resolveJob): the bag decides what each hidden node holds, offsets pick
 * each Sentry's starting point on its loop, and exit picks which of `exits`
 * BREACH opens. The node data below is already the canonical layout, so code
 * that reads a raw job still sees a sensible board.
 *
 * Grid positions are [column, row] with [0, 0] at the top left; the phone
 * board is 4 columns by 5 rows and ENTRY sits at the bottom.
 *
 * Node types: entry, node, target, firewall, lock, honeypot, ai.
 * caches: { nodeId: { kind: 'cash' } } are visible loot, picked up by entering.
 * tips: one-time coaching bubbles; `when` is evaluated by the UI.
 * rules: the full rules for the (?) help sheet.
 */
(function (root) {
  var RULES = [
    'You get <b>2 actions</b> a turn: move to a linked node, or run a program. End a turn with actions left and you get <b>3</b> next turn.',
    '<span class="t-threat">Orange</span> shows what Sentries do next. An <span class="t-threat">arrow</span> means it moves there. A <span class="t-threat">ring</span> means it scans that node. They target nodes, so you can always step out of the way.',
    'Getting scanned (+3) or bumped (+2) raises <span class="t-threat">heat</span>. At 10 heat you are traced.',
    'Hidden <b>?</b> nodes hold loot or a trap. Walking in is final: no Undo.',
    '<span class="t-gold">$</span> caches pay out just for stepping on them. After Extract they pay double.',
    'Reach the <span class="t-gold">gold</span> target and Extract (it uses no action, so you can still run that turn). That starts the <b>BREACH</b>: ENTRY burns, one of the dashed exits opens, Sentries hunt you, and the trace adds +1 heat every turn. A Sentry that just scanned you backs off a step.',
    '<b>Brute</b> takes 2 actions and opens a lock or firewall at once. It is loud: Sentries within 3 hops come to look.',
    'Payout: contract + caches + $30 per spare turn − $40 per heat. Stars: get out, beat PAR, and the bonus.',
    '<b>Undo</b> is free within a turn, until you learn something new.'
  ];

  var CAMERA_RULE = '<b>Cameras</b> (square tokens) never move and can’t be lured or stunned by a Worm. End a turn next to one and it scans you.';


  // ---------- hex boards (Jobs 11+) ----------
  //
  // A hex job draws its board as a map: one string per row, one token per
  // cell ('.' is empty). Rows are pointy-top hexes, odd rows shifted half a
  // cell right, so a cell touches up to six others:
  //   even row r: (c±1, r), (c-1, r±1), (c, r±1)
  //   odd row r:  (c±1, r), (c, r±1), (c+1, r±1)
  // Every pair of touching nodes is linked, except the pairs in `cuts`
  // (walls). `defs` gives each id its type, label and icon.
  function hexNeighbors(col, row) {
    var d = row % 2
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    return d.map(function (o) { return [col + o[0], row + o[1]]; });
  }
  function hexJob(job) {
    var at = {}, nodes = [];
    job.map.forEach(function (line, row) {
      line.trim().split(/\s+/).forEach(function (id, col) {
        if (id === '.') return;
        var d = job.defs[id];
        if (!d) throw new Error(job.id + ': no def for ' + id);
        var n = { id: id, col: col, row: row, type: d[0], label: d[1], icon: d[2] };
        if (d[3]) Object.keys(d[3]).forEach(function (k) { n[k] = d[3][k]; });
        nodes.push(n);
        at[col + ',' + row] = id;
      });
    });
    var cut = {};
    (job.cuts || []).forEach(function (c) { cut[c[0] + '|' + c[1]] = cut[c[1] + '|' + c[0]] = true; });
    var links = [];
    nodes.forEach(function (n) {
      hexNeighbors(n.col, n.row).forEach(function (q) {
        var m = at[q[0] + ',' + q[1]];
        if (m && n.id < m && !cut[n.id + '|' + m]) links.push([n.id, m]);
      });
    });
    var out = {};
    Object.keys(job).forEach(function (k) { if (k !== 'map' && k !== 'defs' && k !== 'cuts') out[k] = job[k]; });
    out.layout = 'hex';
    out.nodes = nodes;
    out.links = links;
    return out;
  }

  var JOBS = [
    {
      id: 'job01',
      number: '01',
      name: 'Corner Store POS',
      goal: 'Steal sales database',
      tagline: 'Tutorial. One Sentry, one firewall, one bad idea.',
      turnLimit: 10,
      programs: { sniff: 1, spoof: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'A', col: 1, row: 4, type: 'node', label: 'TILL-1', icon: 'till', cache: { kind: 'cash' } },
        { id: 'B', col: 2, row: 4, type: 'node', label: 'TILL-2', icon: 'till' },
        { id: 'Y', col: 3, row: 4, type: 'node', label: 'PRINTER', icon: 'printer', hidden: true, cache: { kind: 'cash' } },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-01', icon: 'camera' },
        { id: 'F', col: 2, row: 3, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'X', col: 3, row: 3, type: 'honeypot', label: 'BACKUP', icon: 'database', hidden: true },
        { id: 'D', col: 0, row: 2, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'G', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch', cache: { kind: 'cash' } },
        { id: 'H', col: 2, row: 2, type: 'node', label: 'POS-SRV', icon: 'server' },
        { id: 'V', col: 2, row: 1, type: 'target', label: 'SALES DB', icon: 'database' }
      ],
      links: [
        ['E', 'A'], ['A', 'B'], ['B', 'Y'], ['B', 'F'], ['F', 'H'], ['Y', 'X'],
        ['X', 'H'], ['E', 'C'], ['C', 'D'], ['D', 'G'], ['G', 'H'], ['H', 'V'],
        // Not in the design doc: C–G lets you slip past the patrol, and V–G
        // (v2) keeps SALES DB from being a dead end once the Sentry hunts.
        ['C', 'G'], ['V', 'G']
      ],
      clues: [],
      ai: null,
      // v2 patrol sweeps the left corridor and the target: G→D→G→H→V→H.
      sentries: [
        { id: 'A', start: 'G', patrol: ['G', 'D', 'G', 'H', 'V', 'H'] }
      ],
      exits: ['D', 'B'],
      caches: { G: { kind: 'cash' }, A: { kind: 'cash' } },
      bag: { nodes: ['Y', 'X'], contents: ['cash', 'honeypot'], canonical: { Y: 'cash', X: 'honeypot' } },
      payout: { base: 400, par: 450 },
      bonus: { id: 'ghost', short: 'Ghost', text: 'Ghost: never get scanned or bumped' },
      tips: [
        { when: 'start', html: 'Tap a glowing node to move. <b>2 actions</b> a turn.' },
        { when: 'threatNear', html: '<span class="t-threat">Orange</span> is what they do next. <span class="t-threat">Arrow</span>: it moves there. <span class="t-threat">Ring</span>: it scans there. Don’t end your turn in it.' },
        { when: 'adjBarrier', html: '<b>Brute</b> takes 2 actions and opens it now. It’s loud: Sentries within 3 hops come to look.' },
        { when: 'hiddenNear', html: '<b>?</b> nodes are loot or a trap. <b>Sniff</b> tells you which, and which exit you’ll get.' },
        { when: 'banked', html: 'Banked: <b>3 actions</b> this turn. End a turn with an action left to bank it again.' },
        { when: 'onTarget', html: '<b>EXTRACT</b> uses no action: grab it and keep moving. Then it gets loud.' },
        { when: 'breach', html: '<b>BREACH</b>. ENTRY is burned. Run for the <span class="t-gold">gold EXIT</span>. Sentries hunt you now. Their arrows show where.' }
      ],
      rules: RULES
    },
    {
      id: 'job02',
      number: '02',
      name: 'City Bank · Branch 7',
      goal: 'Steal vault ledger',
      tagline: 'Two Sentries, a locked door, and something that wants to help.',
      turnLimit: 12,
      programs: { sniff: 2, spoof: 1, decoy: 1, worm: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'R', col: 1, row: 4, type: 'node', label: 'ROUTER', icon: 'router' },
        { id: 'P', col: 2, row: 4, type: 'node', label: 'PRINT-04', icon: 'printer' },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'BACKUP', icon: 'database', hidden: true, cache: { kind: 'cash' } },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-03', icon: 'camera', cache: { kind: 'cash' } },
        { id: 'W', col: 1, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'T', col: 3, row: 3, type: 'honeypot', label: 'LEDGER', icon: 'database', hidden: true },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'MAIL-02', icon: 'mail' },
        { id: 'U', col: 1, row: 2, type: 'ai', label: 'UNKNOWN', icon: 'ai' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'HR-DB', icon: 'database', hidden: true, cache: { kind: 'charge', prog: 'brute' } },
        { id: 'A', col: 0, row: 1, type: 'lock', label: 'AUTH-01', icon: 'lock' },
        { id: 'S', col: 2, row: 1, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'K', col: 1, row: 0, type: 'node', label: 'KIOSK', icon: 'kiosk' },
        { id: 'O', col: 2, row: 0, type: 'node', label: 'ADMIN-PC', icon: 'monitor', cache: { kind: 'cash' } },
        { id: 'V', col: 3, row: 0, type: 'target', label: 'VAULT', icon: 'vault' }
      ],
      links: [
        ['E', 'R'], ['R', 'P'], ['P', 'Q'], ['Q', 'T'], ['T', 'H'], ['H', 'S'],
        ['S', 'V'], ['E', 'C'], ['C', 'M'], ['M', 'A'], ['A', 'K'], ['K', 'O'],
        ['O', 'V'], ['R', 'W'], ['W', 'F'], ['F', 'S'], ['W', 'U'], ['M', 'W'],
        // v3: CAM-03–WIFI and ADMIN-PC–SWITCH give the refused routes a second
        // way round each Sentry, so refusing UNKNOWN isn't the slow road.
        ['C', 'W'], ['O', 'S']
      ],
      clues: [
        { at: 'M', opens: 'A', text: 'MAIL-02 had the AUTH-01 password in a sent email. AUTH-01 is open.' }
      ],
      ai: {
        node: 'U',
        offers: [
          {
            id: 'shortcut', trigger: 'adjacent',
            voice: 'the {trap} is bait. come through me and i’ll open the switch.',
            // {cut} and {another} are filled in by the engine (E.offerTerms).
            terms: 'Trust: a path to SWITCH opens until you Extract. UNKNOWN takes {another}{cut} of the payout, and PAR drops by half that.',
            cut: 0.25,
            trustLink: ['U', 'S'],
            // The path only gets you in: UNKNOWN pulls it once you have the data.
            untilExtract: true
          },
          {
            id: 'freeze', trigger: 'extract',
            voice: 'they’re coming for you. let me ride your copy and i’ll freeze them.',
            terms: 'Trust: every Sentry stalls for 1 phase. UNKNOWN takes {another}{cut}, and PAR drops by half that.',
            cut: 0.25
          }
        ],
        // v1 fields kept for old readers; resolveJob fills `offer` with the shortcut voice.
        offer: 'the ledger is bait. come through me and i’ll open the switch.',
        offerTail: 'you’ll owe me.',
        trustLink: ['U', 'S'],
        trustedLine: 'UNKNOWN has a copy of the ledger. It says thank you.',
        refusedLine: 'UNKNOWN went quiet after you refused. It will remember.',
        ignoredLine: 'You never met UNKNOWN. It noticed you anyway.'
      },
      sentries: [
        { id: 'A', start: 'S', patrol: ['S', 'H', 'S', 'F'] },
        { id: 'B', start: 'M', patrol: ['M', 'C', 'M', 'W'] }
      ],
      // Canonical (first-run) loop phase: A starts on SWITCH as before but
      // heads for FIREWALL first. Tuning lever 4: with offset 0 the bot won
      // 97% trusting UNKNOWN's shortcut vs 64.5% refusing it (gap > 25);
      // with A at offset 2 it is 88.5% vs 74% (tools/bot.js job02).
      canonicalOffsets: { A: 2, B: 0 },
      exits: ['P', 'M'],
      caches: { O: { kind: 'cash' }, C: { kind: 'cash' } },
      bag: {
        nodes: ['Q', 'T', 'H'], contents: ['cash', 'honeypot', 'charge'], chargeProg: 'brute',
        canonical: { Q: 'cash', T: 'honeypot', H: 'charge' }
      },
      payout: { base: 700, par: 800 },
      bonus: { id: 'wormStun', short: 'Worm', text: 'Stun a Sentry with a Worm' },
      tips: [
        { when: 'start', html: '<b>Decoy</b> pulls the nearest Sentry to it. <b>Worm</b> stuns the Sentry that steps on it. Together they make a trap.' },
        { when: 'breach', html: '<b>BREACH</b>. ENTRY is burned. Both Sentries hunt you. Caches pay double now, if you dare.' }
      ],
      rules: RULES.concat([
        '<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.',
        'Locks open with <b>Brute</b>, or for free if you find the password somewhere on the network.',
        'Something <span class="t-ai">else</span> is on this network. It makes offers. Refusing is free; trusting costs a cut of the payout (PAR drops by half as much).'
      ])
    }
    ,
    {
      id: 'job03',
      number: '03',
      name: 'Suds & Spin Laundromat',
      goal: 'Skim the card reader log',
      tagline: 'A camera that never blinks. Just don’t stop next to it.',
      turnLimit: 10,
      programs: { sniff: 1, spoof: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'A', col: 1, row: 4, type: 'node', label: 'WASHER-1', icon: 'server' },
        { id: 'B', col: 2, row: 4, type: 'node', label: 'WASHER-2', icon: 'server' },
        { id: 'P', col: 3, row: 4, type: 'node', label: 'CHANGER', icon: 'till', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'ROUTER', icon: 'router' },
        { id: 'K', col: 1, row: 3, type: 'node', label: 'CAM-02', icon: 'camera' },
        { id: 'W', col: 2, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'H', col: 3, row: 3, type: 'node', label: 'HOTSPOT', icon: 'wifi', hidden: true },
        { id: 'D', col: 0, row: 2, type: 'node', label: 'DRYER-PC', icon: 'monitor' },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'O', col: 2, row: 2, type: 'node', label: 'OFFICE', icon: 'monitor' },
        { id: 'R', col: 3, row: 2, type: 'node', label: 'RECEIPTS', icon: 'printer' },
        { id: 'V', col: 2, row: 1, type: 'target', label: 'CARD LOG', icon: 'database' }
      ],
      links: [
        ['E', 'A'], ['A', 'B'], ['B', 'P'], ['P', 'H'], ['H', 'R'], ['R', 'V'],
        ['E', 'C'], ['C', 'D'], ['D', 'S'], ['S', 'O'], ['O', 'V'], ['S', 'V'],
        ['B', 'W'], ['W', 'O'], ['W', 'H'],
        ['A', 'K'], ['C', 'K'], ['K', 'S'], ['K', 'W']
      ],
      clues: [],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'K', patrol: ['K'] },
        { id: 'A', start: 'O', patrol: ['O', 'V', 'R', 'H', 'R', 'V'] }
      ],
      exits: ['A', 'R'],
      caches: { D: { kind: 'cash' } },
      bag: { nodes: ['P', 'H'], contents: ['cash', 'honeypot'], canonical: { P: 'cash', H: 'honeypot' } },
      payout: { base: 500, par: 500 },
      bonus: { id: 'greedy', short: 'Greedy', text: 'Greedy: take every $ cache' },
      tips: [
        { when: 'start', html: '<b>Cameras</b> (square tokens) never move. End a turn next to one and it scans you. Passing by is fine.' },
        { when: 'breach', html: '<b>BREACH</b>. The camera stays put. The patrol hunts you.' }
      ],
      rules: RULES.concat([CAMERA_RULE])
    },
    {
      id: 'job04',
      number: '04',
      name: 'Level 3 Parking Garage',
      goal: 'Pull the plate-reader archive',
      tagline: 'Two Sentries circle the ring in opposite directions. Time it.',
      turnLimit: 10,
      programs: { sniff: 1, spoof: 1, worm: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'B1', col: 1, row: 4, type: 'node', label: 'GATE-IN', icon: 'kiosk' },
        { id: 'B2', col: 2, row: 4, type: 'node', label: 'PAY-1', icon: 'till' },
        { id: 'R3', col: 3, row: 3, type: 'node', label: 'CAM-SE', icon: 'camera' },
        { id: 'R2', col: 3, row: 2, type: 'node', label: 'EV-CHARGER', icon: 'server', hidden: true },
        { id: 'R1', col: 3, row: 1, type: 'node', label: 'CAM-NE', icon: 'camera' },
        { id: 'T2', col: 2, row: 0, type: 'node', label: 'GATE-OUT', icon: 'kiosk' },
        { id: 'T1', col: 1, row: 0, type: 'node', label: 'PAY-2', icon: 'till' },
        { id: 'L3', col: 0, row: 1, type: 'node', label: 'CAM-NW', icon: 'camera' },
        { id: 'L2', col: 0, row: 2, type: 'node', label: 'VALET', icon: 'monitor', hidden: true },
        { id: 'L1', col: 0, row: 3, type: 'node', label: 'CAM-SW', icon: 'camera' },
        { id: 'N1', col: 1, row: 2, type: 'node', label: 'LIFT', icon: 'switch' },
        { id: 'N3', col: 2, row: 1, type: 'node', label: 'OFFICE', icon: 'monitor', cache: { kind: 'cash' } },
        { id: 'V', col: 2, row: 2, type: 'target', label: 'PLATE DB', icon: 'database' }
      ],
      links: [
        ['E', 'B1'], ['E', 'L1'], ['L1', 'B1'],
        ['B1', 'B2'], ['B2', 'R3'], ['R3', 'R2'], ['R2', 'R1'], ['R1', 'T2'], ['T2', 'T1'], ['T1', 'L3'], ['L3', 'L2'], ['L2', 'L1'],
        ['L2', 'N1'], ['N1', 'V'], ['T2', 'N3'], ['N3', 'V'], ['R2', 'V']
      ],
      clues: [],
      ai: null,
      // Ring patrols, one each way. Only some starting points are dealt
      // (offsets), so the variant count stays small.
      sentries: [
        { id: 'A', start: 'R2', patrol: ['L1', 'L2', 'L3', 'T1', 'T2', 'R1', 'R2', 'R3', 'B2', 'B1'], offsets: [6, 4, 5, 7] },
        { id: 'B', start: 'L3', patrol: ['R2', 'R1', 'T2', 'T1', 'L3', 'L2', 'L1', 'B1', 'B2', 'R3'], offsets: [4, 2, 3, 5] }
      ],
      canonicalOffsets: { A: 6, B: 4 },
      exits: ['T1', 'R3'],
      caches: { N3: { kind: 'cash' } },
      bag: { nodes: ['R2', 'L2'], contents: ['cash', 'honeypot'], canonical: { R2: 'honeypot', L2: 'cash' } },
      payout: { base: 700, par: 700 },
      bonus: { id: 'ghost', short: 'Ghost', text: 'Ghost: never get scanned or bumped' },
      tips: [
        { when: 'start', html: 'The ring is patrolled both ways. Watch the arrows and cut through the middle when there’s a gap. <b>Worm</b> a ring node to stop one cold.' },
        { when: 'breach', html: '<b>BREACH</b>. They leave the ring and hunt you.' }
      ],
      rules: RULES.concat(['<b>Worm</b> stuns a Sentry that steps on it for 2 turns.'])
    },
    {
      id: 'job05',
      number: '05',
      name: 'Channel 9 Newsroom',
      goal: 'Leak the unaired footage',
      tagline: 'A locked control room, two traps, and nobody can see you.',
      turnLimit: 12,
      programs: { sniff: 2, spoof: 1, decoy: 1, worm: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'R', col: 1, row: 4, type: 'node', label: 'LOBBY-PC', icon: 'monitor' },
        { id: 'P', col: 2, row: 4, type: 'node', label: 'PRINTER', icon: 'printer' },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'ARCHIVE', icon: 'database', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-PC', icon: 'camera' },
        { id: 'W', col: 1, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'N', col: 2, row: 3, type: 'node', label: 'NEWSDESK', icon: 'server', hidden: true },
        { id: 'G', col: 3, row: 3, type: 'node', label: 'GREENROOM', icon: 'mail' },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'MAIL', icon: 'mail', cache: { kind: 'cash' } },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'PROMPTER', icon: 'monitor', hidden: true },
        { id: 'A', col: 0, row: 1, type: 'lock', label: 'CONTROL', icon: 'lock' },
        { id: 'K', col: 1, row: 1, type: 'node', label: 'MIXER', icon: 'kiosk' },
        { id: 'O', col: 2, row: 1, type: 'node', label: 'EDIT-BAY', icon: 'monitor' },
        { id: 'T', col: 3, row: 1, type: 'node', label: 'UPLINK', icon: 'wifi' },
        { id: 'V', col: 2, row: 0, type: 'target', label: 'FOOTAGE', icon: 'vault' }
      ],
      links: [
        ['E', 'R'], ['R', 'P'], ['P', 'Q'], ['Q', 'G'], ['G', 'H'], ['H', 'T'], ['T', 'V'],
        ['E', 'C'], ['C', 'M'], ['M', 'A'], ['A', 'K'], ['K', 'V'],
        ['R', 'W'], ['W', 'S'], ['S', 'F'], ['F', 'O'], ['O', 'V'], ['W', 'N'], ['N', 'P'], ['N', 'G'],
        ['M', 'W'], ['S', 'K'], ['H', 'F'], ['O', 'T']
      ],
      clues: [
        { at: 'G', opens: 'A', text: 'The greenroom whiteboard had the CONTROL door code. CONTROL is open.' }
      ],
      ai: null,
      sentries: [
        { id: 'A', start: 'S', patrol: ['S', 'K', 'S', 'W'] },
        { id: 'B', start: 'O', patrol: ['O', 'T', 'H', 'T'] }
      ],
      exits: ['C', 'G'],
      caches: { M: { kind: 'cash' } },
      bag: { nodes: ['Q', 'N', 'H'], contents: ['cash', 'honeypot', 'honeypot'], canonical: { Q: 'honeypot', N: 'cash', H: 'honeypot' } },
      payout: { base: 900, par: 900 },
      bonus: { id: 'speed', short: 'Fast', text: 'Fast: get out by turn 9', turn: 9 },
      tips: [
        { when: 'start', html: 'Two of the three <b>?</b> nodes are traps. The CONTROL door code is somewhere on this network.' },
        { when: 'breach', html: '<b>BREACH</b>. Both Sentries hunt you.' }
      ],
      rules: RULES.concat([
        '<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.',
        'Locks open with <b>Brute</b>, or for free if you find the code somewhere on the network.'
      ])
    },
    {
      id: 'job06',
      number: '06',
      name: 'Greenleaf Pharmacy',
      goal: 'Copy the prescription database',
      tagline: 'Two patrols, one firewall. Bait one away, or get loud.',
      turnLimit: 11,
      programs: { sniff: 1, spoof: 1, decoy: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'R', col: 1, row: 4, type: 'node', label: 'ROUTER', icon: 'router' },
        { id: 'Q', col: 2, row: 4, type: 'node', label: 'PRINTER', icon: 'printer' },
        { id: 'Z', col: 3, row: 4, type: 'node', label: 'FAX', icon: 'printer', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-PC', icon: 'camera' },
        { id: 'F', col: 1, row: 3, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'W', col: 2, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'Y', col: 3, row: 3, type: 'node', label: 'LABELS', icon: 'printer' },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'POS', icon: 'till', cache: { kind: 'cash' } },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'H', col: 2, row: 2, type: 'node', label: 'HR-PC', icon: 'monitor' },
        { id: 'L', col: 3, row: 2, type: 'node', label: 'INSURANCE', icon: 'server', hidden: true },
        { id: 'K', col: 1, row: 1, type: 'node', label: 'KIOSK', icon: 'kiosk' },
        { id: 'O', col: 2, row: 1, type: 'node', label: 'OFFICE', icon: 'monitor' },
        { id: 'V', col: 2, row: 0, type: 'target', label: 'RX-DB', icon: 'database' }
      ],
      links: [
        ['E', 'R'], ['R', 'Q'], ['Q', 'Z'], ['Z', 'Y'], ['Y', 'L'], ['L', 'O'],
        ['E', 'C'], ['C', 'M'], ['M', 'S'], ['R', 'F'], ['F', 'S'],
        ['Q', 'W'], ['W', 'H'], ['H', 'S'], ['H', 'O'], ['W', 'Y'],
        ['S', 'K'], ['K', 'O'], ['O', 'V'], ['K', 'V']
      ],
      clues: [],
      ai: null,
      sentries: [
        { id: 'A', start: 'S', patrol: ['S', 'K', 'S', 'M'] },
        { id: 'B', start: 'H', patrol: ['H', 'O', 'L', 'O'] }
      ],
      exits: ['M', 'Q'],
      caches: { M: { kind: 'cash' } },
      bag: { nodes: ['Z', 'L'], contents: ['cash', 'honeypot'], canonical: { Z: 'cash', L: 'honeypot' } },
      payout: { base: 600, par: 600 },
      bonus: { id: 'quiet', short: 'Quiet', text: 'Quiet: never use Brute' },
      tips: [
        { when: 'start', html: '<b>Decoy</b> pulls the nearest Sentry to a node next to you. Use it to clear a path without Brute.' },
        { when: 'breach', html: '<b>BREACH</b>. Both Sentries hunt you now.' }
      ],
      rules: RULES.concat(['<b>Decoy</b> lures the single nearest Sentry within 3 hops.'])
    },
    {
      id: 'job07',
      number: '07',
      name: 'Golden Ace Casino',
      goal: 'Empty the cage ledger',
      tagline: 'UNKNOWN is back, and the house always watches.',
      turnLimit: 12,
      programs: { sniff: 1, spoof: 1, decoy: 1, worm: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'R', col: 1, row: 4, type: 'node', label: 'SLOTS', icon: 'till' },
        { id: 'P', col: 2, row: 4, type: 'node', label: 'CASHIER', icon: 'till', cache: { kind: 'cash' } },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'VIP-BAR', icon: 'monitor', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'SECURITY', icon: 'camera' },
        { id: 'W', col: 1, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'X1', col: 2, row: 3, type: 'node', label: 'EYE-1', icon: 'camera' },
        { id: 'T', col: 3, row: 3, type: 'node', label: 'POKER', icon: 'server' },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'MAIL', icon: 'mail' },
        { id: 'U', col: 1, row: 2, type: 'ai', label: 'UNKNOWN', icon: 'ai' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'HOTEL-DB', icon: 'database', hidden: true },
        { id: 'A', col: 0, row: 1, type: 'lock', label: 'PIT-BOSS', icon: 'lock' },
        { id: 'S', col: 1, row: 1, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'K', col: 2, row: 1, type: 'node', label: 'KENO', icon: 'kiosk' },
        { id: 'O', col: 3, row: 1, type: 'node', label: 'COUNT-ROOM', icon: 'database', cache: { kind: 'cash' } },
        { id: 'L', col: 1, row: 0, type: 'node', label: 'LOUNGE', icon: 'monitor' },
        { id: 'V', col: 3, row: 0, type: 'target', label: 'CAGE', icon: 'vault' }
      ],
      links: [
        ['E', 'R'], ['R', 'P'], ['P', 'Q'], ['Q', 'T'], ['T', 'H'], ['H', 'O'], ['O', 'V'],
        ['E', 'C'], ['C', 'M'], ['M', 'A'], ['A', 'L'], ['L', 'S'], ['S', 'K'], ['K', 'O'], ['K', 'V'],
        ['R', 'W'], ['W', 'U'], ['M', 'W'], ['C', 'W'],
        ['P', 'X1'], ['W', 'X1'], ['T', 'X1'], ['X1', 'F'], ['F', 'K'], ['F', 'H'], ['A', 'S']
      ],
      clues: [
        { at: 'M', opens: 'A', text: 'MAIL had the PIT-BOSS password in a reset email. PIT-BOSS is open.' }
      ],
      ai: {
        node: 'U',
        offers: [
          {
            id: 'shortcut', trigger: 'adjacent',
            voice: 'the {trap} is a setup. come through me and i’ll open the switch.',
            terms: 'Trust: a path to SWITCH opens. UNKNOWN takes {another}{cut} of the payout, and PAR drops by half that.',
            cut: 0.25,
            trustLink: ['U', 'S']
          },
          {
            id: 'freeze', trigger: 'extract',
            voice: 'the floor is waking up. give me a copy and i’ll freeze them.',
            terms: 'Trust: every Sentry stalls for 1 phase. UNKNOWN takes {another}{cut}, and PAR drops by half that.',
            cut: 0.25
          }
        ],
        offer: 'the trap is a setup. come through me and i’ll open the switch.',
        offerTail: 'you’ll owe me.',
        trustLink: ['U', 'S'],
        trustedLine: 'UNKNOWN has a copy of the ledger. It says the house thanks you.',
        refusedLine: 'UNKNOWN went quiet after you refused. It always does.',
        ignoredLine: 'You never met UNKNOWN. It watched you anyway.'
      },
      sentries: [
        { id: 'X', camera: true, start: 'X1', patrol: ['X1'] },
        { id: 'A', start: 'K', patrol: ['K', 'S', 'K', 'O'] },
        { id: 'B', start: 'T', patrol: ['T', 'H', 'T', 'Q'] }
      ],
      exits: ['C', 'R'],
      caches: { P: { kind: 'cash' }, O: { kind: 'cash' } },
      bag: { nodes: ['Q', 'H'], contents: ['cash', 'honeypot'], canonical: { Q: 'cash', H: 'honeypot' } },
      payout: { base: 1000, par: 1000 },
      bonus: { id: 'cool', short: 'Cool', text: 'Cool: get out with heat 5 or less', heat: 5 },
      tips: [
        { when: 'start', html: 'UNKNOWN is on this network too. The camera on EYE-1 never moves, and it watches every node linked to it.' },
        { when: 'breach', html: '<b>BREACH</b>. Caches pay double now, but every scan costs you the Cool star.' }
      ],
      rules: RULES.concat([
        CAMERA_RULE,
        '<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.',
        'Locks open with <b>Brute</b>, or for free if you find the password somewhere on the network.',
        'Something <span class="t-ai">else</span> is on this network. It makes offers. Refusing is free; trusting costs a cut of the payout (PAR drops by half as much).'
      ])
    },
    {
      id: 'job08',
      number: '08',
      name: 'Port of Harlow',
      goal: 'Rewrite the cargo manifest',
      tagline: 'Three patrols, two firewalls, a long way home.',
      turnLimit: 13,
      programs: { sniff: 1, spoof: 2, decoy: 2, worm: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'G', col: 1, row: 4, type: 'node', label: 'GATE', icon: 'kiosk' },
        { id: 'Y1', col: 2, row: 4, type: 'node', label: 'YARD-1', icon: 'router' },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'REEFER', icon: 'server', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CRANE-1', icon: 'switch' },
        { id: 'F1', col: 1, row: 3, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'W', col: 2, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'Y2', col: 3, row: 3, type: 'node', label: 'YARD-2', icon: 'router', hidden: true },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'WEIGH-IN', icon: 'till', cache: { kind: 'cash' } },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'H', col: 2, row: 2, type: 'node', label: 'HARBOR-PC', icon: 'monitor' },
        { id: 'D', col: 3, row: 2, type: 'node', label: 'DOCK-3', icon: 'server' },
        { id: 'K', col: 0, row: 1, type: 'node', label: 'CRANE-2', icon: 'switch' },
        { id: 'F2', col: 1, row: 1, type: 'firewall', label: 'FIREWALL-2', icon: 'firewall' },
        { id: 'O', col: 2, row: 1, type: 'node', label: 'CUSTOMS', icon: 'monitor' },
        { id: 'Z', col: 3, row: 1, type: 'node', label: 'BONDED', icon: 'database', cache: { kind: 'cash' } },
        { id: 'L', col: 0, row: 0, type: 'node', label: 'TOWER', icon: 'wifi' },
        { id: 'N', col: 1, row: 0, type: 'node', label: 'NAV', icon: 'router' },
        { id: 'R', col: 2, row: 0, type: 'node', label: 'RADIO', icon: 'wifi' },
        { id: 'V', col: 3, row: 0, type: 'target', label: 'MANIFEST', icon: 'vault' }
      ],
      links: [
        ['E', 'G'], ['G', 'Y1'], ['Y1', 'Q'], ['Q', 'Y2'], ['Y2', 'D'], ['D', 'Z'], ['Z', 'V'],
        ['E', 'C'], ['C', 'M'], ['M', 'K'], ['K', 'L'], ['L', 'N'], ['N', 'R'], ['R', 'V'],
        ['G', 'F1'], ['F1', 'S'], ['Y1', 'W'], ['W', 'H'], ['W', 'Y2'], ['S', 'H'], ['H', 'D'],
        ['S', 'F2'], ['F2', 'O'], ['O', 'H'], ['O', 'R'], ['O', 'Z'], ['K', 'F2'], ['F2', 'N']
      ],
      clues: [],
      ai: null,
      sentries: [
        { id: 'A', start: 'K', patrol: ['K', 'L', 'K', 'M'], offsets: [0, 2] },
        { id: 'B', start: 'O', patrol: ['O', 'R', 'O', 'Z'] },
        { id: 'C', start: 'D', patrol: ['D', 'Y2', 'Q', 'Y2'], offsets: [0, 2] }
      ],
      exits: ['C', 'Q'],
      caches: { M: { kind: 'cash' }, Z: { kind: 'cash' } },
      bag: { nodes: ['Q', 'Y2'], contents: ['cash', 'honeypot'], canonical: { Q: 'cash', Y2: 'honeypot' } },
      payout: { base: 1200, par: 1200 },
      bonus: { id: 'wormStun', short: 'Worm', text: 'Stun a Sentry with a Worm' },
      tips: [
        { when: 'start', html: 'Three Sentries and two firewalls. You have <b>2 Decoys</b>: pull them apart.' },
        { when: 'breach', html: '<b>BREACH</b>. All three hunt you. It’s a long way back.' }
      ],
      rules: RULES.concat(['<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.'])
    },
    {
      id: 'job09',
      number: '09',
      name: 'Federal Reserve, Vault 4',
      goal: 'Walk out with the reserve keys',
      tagline: 'You start hot, the door is locked, and they’re waiting.',
      turnLimit: 13,
      startHeat: 2,
      programs: { sniff: 2, spoof: 2, decoy: 1, worm: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'R', col: 1, row: 4, type: 'node', label: 'ROUTER', icon: 'router' },
        { id: 'B', col: 2, row: 4, type: 'node', label: 'BADGE-RDR', icon: 'kiosk' },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'COURIER', icon: 'mail', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'GUARD-PC', icon: 'monitor' },
        { id: 'X1', col: 1, row: 3, type: 'node', label: 'LOBBY-PC', icon: 'monitor' },
        { id: 'W', col: 2, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'T', col: 3, row: 3, type: 'node', label: 'TELLER', icon: 'till', hidden: true },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'MAIL', icon: 'mail' },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'HR-DB', icon: 'database', cache: { kind: 'cash' } },
        { id: 'A', col: 0, row: 1, type: 'lock', label: 'VAULT-LOCK', icon: 'lock' },
        { id: 'K', col: 1, row: 1, type: 'node', label: 'KEYPAD', icon: 'kiosk' },
        { id: 'X2', col: 2, row: 1, type: 'node', label: 'EYE-2', icon: 'camera' },
        { id: 'O', col: 3, row: 1, type: 'node', label: 'OPS', icon: 'monitor' },
        { id: 'L', col: 0, row: 0, type: 'node', label: 'LEDGER', icon: 'database', cache: { kind: 'cash' } },
        { id: 'N', col: 1, row: 0, type: 'node', label: 'NOC', icon: 'server' },
        { id: 'G', col: 2, row: 0, type: 'node', label: 'GOLD-DB', icon: 'database' },
        { id: 'V', col: 3, row: 0, type: 'target', label: 'RESERVE', icon: 'vault' }
      ],
      links: [
        ['E', 'R'], ['R', 'B'], ['B', 'Q'], ['Q', 'T'], ['T', 'H'], ['H', 'O'], ['O', 'V'],
        ['E', 'C'], ['C', 'M'], ['M', 'A'], ['A', 'L'], ['L', 'N'], ['N', 'G'], ['G', 'V'],
        ['R', 'X1'], ['C', 'X1'], ['X1', 'S'], ['X1', 'W'], ['B', 'W'], ['W', 'F'], ['W', 'T'],
        ['S', 'F'], ['S', 'M'], ['S', 'K'], ['K', 'A'], ['K', 'N'], ['K', 'X2'], ['F', 'X2'], ['X2', 'G'], ['X2', 'O'], ['F', 'H']
      ],
      clues: [
        { at: 'T', opens: 'A', text: 'The teller terminal had the VAULT-LOCK override. VAULT-LOCK is open.' }
      ],
      ai: null,
      sentries: [
        { id: 'Y', camera: true, start: 'X2', patrol: ['X2'] },
        { id: 'A', start: 'K', patrol: ['K', 'N', 'G', 'N'] },
        { id: 'B', start: 'O', patrol: ['O', 'H', 'T', 'H'], offsets: [0, 2] }
      ],
      exits: ['C', 'B', 'L'],
      caches: { H: { kind: 'cash' }, L: { kind: 'cash' } },
      bag: { nodes: ['Q', 'T'], contents: ['cash', 'honeypot'], canonical: { Q: 'cash', T: 'honeypot' } },
      payout: { base: 1500, par: 1500 },
      bonus: { id: 'speed', short: 'Fast', text: 'Fast: get out by turn 11', turn: 11 },
      tips: [
        { when: 'start', html: 'You start with <b>2 heat</b>. A camera, two Sentries, a locked vault door and three possible exits. Plan the way out before you go in.' },
        { when: 'breach', html: '<b>BREACH</b>. Everything hunts you now.' }
      ],
      rules: RULES.concat([
        CAMERA_RULE,
        '<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.',
        'Locks open with <b>Brute</b>, or for free if you find the override somewhere on the network.'
      ])
    },
    {
      id: 'job10',
      number: '10',
      name: 'Nimbus Data Center',
      goal: 'Image the mainframe',
      tagline: 'Three cameras, one guard, three ways out. Stay cool.',
      turnLimit: 11,
      programs: { sniff: 1, spoof: 2, decoy: 1, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'A', col: 1, row: 4, type: 'node', label: 'RACK-01', icon: 'server' },
        { id: 'B', col: 2, row: 4, type: 'node', label: 'RACK-02', icon: 'server' },
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'COLD-STORE', icon: 'database', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'COOLING', icon: 'router' },
        { id: 'X1', col: 1, row: 3, type: 'node', label: 'CAM-A', icon: 'camera' },
        { id: 'W', col: 2, row: 3, type: 'node', label: 'PDU', icon: 'switch' },
        { id: 'Y', col: 3, row: 3, type: 'node', label: 'UPS', icon: 'server', hidden: true },
        { id: 'D', col: 0, row: 2, type: 'node', label: 'NOC-PC', icon: 'monitor', cache: { kind: 'cash' } },
        { id: 'S', col: 1, row: 2, type: 'node', label: 'CORE-SW', icon: 'switch' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'HYPERVISOR', icon: 'server' },
        { id: 'L', col: 0, row: 1, type: 'node', label: 'BACKUP', icon: 'database' },
        { id: 'X2', col: 1, row: 1, type: 'node', label: 'CAM-B', icon: 'camera' },
        { id: 'O', col: 2, row: 1, type: 'node', label: 'ADMIN', icon: 'monitor' },
        { id: 'X3', col: 3, row: 1, type: 'node', label: 'CAM-C', icon: 'camera' },
        { id: 'K', col: 0, row: 0, type: 'node', label: 'KVM', icon: 'kiosk' },
        { id: 'V', col: 2, row: 0, type: 'target', label: 'MAINFRAME', icon: 'vault' },
        { id: 'Z', col: 3, row: 0, type: 'node', label: 'SAT-LINK', icon: 'wifi' }
      ],
      links: [
        ['E', 'A'], ['A', 'B'], ['B', 'Q'], ['Q', 'Y'], ['Y', 'H'],
        ['E', 'C'], ['C', 'D'], ['D', 'L'], ['L', 'K'], ['K', 'V'],
        ['A', 'X1'], ['C', 'X1'], ['X1', 'W'], ['X1', 'S'], ['B', 'W'], ['W', 'F'], ['W', 'Y'],
        ['D', 'S'], ['S', 'F'], ['F', 'O'], ['F', 'H'], ['S', 'X2'], ['L', 'X2'], ['X2', 'O'], ['X2', 'K'],
        ['O', 'V'], ['H', 'X3'], ['X3', 'Z'], ['X3', 'O'], ['Z', 'V'], ['H', 'O']
      ],
      clues: [],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'X1', patrol: ['X1'] },
        { id: 'Y', camera: true, start: 'X2', patrol: ['X2'] },
        { id: 'Z', camera: true, start: 'X3', patrol: ['X3'] },
        { id: 'A', start: 'L', patrol: ['L', 'K', 'L', 'D'] }
      ],
      exits: ['C', 'Q', 'Z'],
      caches: { D: { kind: 'cash' } },
      bag: { nodes: ['Q', 'Y'], contents: ['cash', 'honeypot'], canonical: { Q: 'cash', Y: 'honeypot' } },
      payout: { base: 800, par: 800 },
      bonus: { id: 'cool', short: 'Cool', text: 'Cool: get out with heat 4 or less', heat: 4 },
      tips: [
        { when: 'start', html: 'Three cameras cover the floor. <b>Spoof</b> lets you end a turn beside one. The exit could be any of three.' },
        { when: 'breach', html: '<b>BREACH</b>. The guard hunts. The cameras keep watching.' }
      ],
      rules: RULES.concat([CAMERA_RULE, '<b>Decoy</b> lures the single nearest Sentry within 3 hops. Cameras ignore it.'])
    }
  ];

  var HEX_RULE = 'This board is <b>hexagons</b>: a node can link to up to <b>six</b> others, so there is almost always another way round.';
  var DECOY_WORM_RULE = '<b>Decoy</b> lures the single nearest Sentry within 3 hops. <b>Worm</b> stuns a Sentry that steps on it for 2 turns.';

  var HEX_JOBS = [
    {
      id: 'job11',
      number: '11',
      name: 'Halcyon Hotel',
      goal: 'Copy the guest ledger',
      tagline: 'New ground: six ways out of every room. One camera, two night porters.',
      turnLimit: 12,
      programs: { sniff: 1, spoof: 1, decoy: 1, brute: 1 },
      map: [
        '.  K  V  Z  .',
        'O  S  X  H  .',
        'M  W  .  F  Q',
        'D  R  P  Y  .',
        'C  T  G  B  U',
        'L  A  N  .  .',
        '.  .  E  .  .'
      ],
      defs: {
        E: ['entry', 'ENTRY', 'entry'],
        A: ['node', 'ATRIUM', 'router'], N: ['node', 'SPA', 'wifi'], L: ['node', 'LUGGAGE', 'database'],
        C: ['node', 'LOBBY', 'kiosk'], T: ['node', 'TV-HUB', 'server'], G: ['node', 'GYM-PC', 'monitor'],
        B: ['node', 'BAR', 'till'], U: ['node', 'VALET', 'kiosk'],
        D: ['node', 'DESK', 'till'], R: ['node', 'ROUTER', 'router'], P: ['node', 'POS', 'till'],
        Y: ['node', 'MINIBAR', 'till', { hidden: true }],
        M: ['node', 'MAIL', 'mail'], W: ['node', 'WIFI', 'wifi'], F: ['firewall', 'FIREWALL', 'firewall'],
        Q: ['node', 'SAFE', 'database', { hidden: true }],
        O: ['node', 'OFFICE', 'monitor'], S: ['node', 'SWITCH', 'switch'], X: ['node', 'CAM-1', 'camera'],
        H: ['node', 'HVAC', 'router'],
        K: ['node', 'KEYCARD', 'kiosk'], V: ['target', 'LEDGER', 'vault'], Z: ['node', 'ROOF-AP', 'wifi']
      },
      clues: [],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'X', patrol: ['X'] },
        { id: 'A', start: 'M', patrol: ['M', 'O', 'M', 'D'] },
        { id: 'B', start: 'Y', patrol: ['Y', 'Q', 'Y', 'B', 'U', 'B'], offsets: [0, 3] }
      ],
      exits: ['L', 'U'],
      caches: { D: { kind: 'cash' }, H: { kind: 'cash' } },
      bag: { nodes: ['Y', 'Q'], contents: ['cash', 'honeypot'], canonical: { Y: 'cash', Q: 'honeypot' } },
      payout: { base: 900, par: 900 },
      bonus: { id: 'ghost', short: 'Ghost', text: 'Ghost: never get scanned or bumped' },
      tips: [
        { when: 'start', html: 'Hexagons: every node can link to <b>six</b> others. More ways in, more ways round a Sentry. Pick your line.' },
        { when: 'breach', html: '<b>BREACH</b>. Two porters hunt you, and they have more ways to reach you too.' }
      ],
      rules: RULES.concat([HEX_RULE, CAMERA_RULE, '<b>Decoy</b> lures the single nearest Sentry within 3 hops. Cameras ignore it.'])
    },
    {
      id: 'job12',
      number: '12',
      name: 'Metro Transit Control',
      goal: 'Reroute the night trains',
      tagline: 'A guard circles the roundabout. Every platform pays, if you can reach it.',
      turnLimit: 14,
      programs: { sniff: 1, spoof: 1, decoy: 1, worm: 1, brute: 1 },
      map: [
        'N  K  V  Z  .',
        'L  A  X  O  .',
        'M  S  R2 R3 D',
        'I  R1 .  R4 G',
        'P  R  R6 R5 Q',
        '.  J  U  Y  .',
        '.  .  E  .  .'
      ],
      defs: {
        E: ['entry', 'ENTRY', 'entry'],
        J: ['node', 'TURNSTL', 'kiosk'], U: ['node', 'TICKETS', 'till'], Y: ['node', 'LOCKERS', 'database'],
        P: ['node', 'PARCELS', 'mail'], R: ['node', 'ROUTER', 'router'],
        R1: ['node', 'PLAT-1', 'switch'], R2: ['node', 'PLAT-2', 'switch'], R3: ['node', 'PLAT-3', 'switch'],
        R4: ['node', 'PLAT-4', 'switch'], R5: ['node', 'PLAT-5', 'switch'], R6: ['node', 'PLAT-6', 'switch'],
        Q: ['node', 'DEPOT', 'server'],
        I: ['node', 'INFO', 'kiosk'], G: ['node', 'SIGNALS', 'router'],
        M: ['node', 'MAINT', 'monitor', { hidden: true }], S: ['node', 'SWITCH', 'switch'], D: ['node', 'DISPATCH', 'monitor'],
        L: ['node', 'LOGS', 'database'], A: ['lock', 'AUTH', 'lock'], X: ['node', 'CAM-1', 'camera'],
        O: ['firewall', 'FIREWALL', 'firewall'],
        N: ['node', 'NAV', 'wifi'], K: ['node', 'KIOSK', 'kiosk'], V: ['target', 'CONTROL', 'vault'], Z: ['node', 'RADIO', 'wifi']
      },
      clues: [
        { at: 'I', opens: 'A', text: 'INFO had the AUTH password on a maintenance notice. AUTH is open.' }
      ],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'X', patrol: ['X'] },
        { id: 'A', start: 'R1', patrol: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], offsets: [0, 2, 4] },
        { id: 'B', start: 'L', patrol: ['L', 'K', 'L', 'M'], offsets: [0, 2] }
      ],
      exits: ['P', 'G'],
      caches: { I: { kind: 'cash' }, L: { kind: 'cash' } },
      bag: { nodes: ['M', 'Y'], contents: ['cash', 'honeypot'], canonical: { M: 'cash', Y: 'honeypot' } },
      payout: { base: 1000, par: 1000 },
      bonus: { id: 'greedy', short: 'Greedy', text: 'Greedy: take every $ cache' },
      tips: [
        { when: 'start', html: 'Sentry A circles the six platforms. The camera watches the top. <b>INFO</b> may know the AUTH password.' },
        { when: 'breach', html: '<b>BREACH</b>. The guard leaves the roundabout to hunt you.' }
      ],
      rules: RULES.concat([HEX_RULE, CAMERA_RULE, DECOY_WORM_RULE,
        'Locks open with <b>Brute</b>, or for free if you find the password somewhere on the network.'])
    },
    {
      id: 'job13',
      number: '13',
      name: 'Orbis Genomics',
      goal: 'Steal the genome archive',
      tagline: 'UNKNOWN is back. The lock’s code is filed somewhere downstairs. Leave Brute in the bag.',
      turnLimit: 13,
      programs: { sniff: 1, spoof: 1, decoy: 1, worm: 1, brute: 1 },
      map: [
        '.  L  V  K  .',
        'CL S  A  O  .',
        'M  W  .  H  Z',
        'D  U  T  F  .',
        'P  R  .  G  Q',
        'I  B  N  Y  X',
        '.  J  C  LD .',
        '.  .  E  .  .'
      ],
      cuts: [['S', 'V']],
      defs: {
        E: ['entry', 'ENTRY', 'entry'],
        J: ['node', 'GATE', 'kiosk'], C: ['node', 'LOBBY', 'kiosk'], LD: ['node', 'DOCK', 'router'],
        I: ['node', 'INTAKE', 'kiosk'], B: ['node', 'BADGES', 'kiosk'], N: ['node', 'SECURITY', 'monitor'],
        Y: ['node', 'LOCKERS', 'database'], X: ['node', 'ARCHIVE', 'database'],
        P: ['node', 'PRINTER', 'printer'], R: ['node', 'ROUTER', 'router'], G: ['node', 'SEQUENCER', 'server'],
        Q: ['node', 'COLD-RM', 'database', { hidden: true }],
        D: ['node', 'DESK', 'till', { hidden: true }], U: ['ai', 'UNKNOWN', 'ai'], T: ['node', 'CAM-1', 'camera'],
        F: ['firewall', 'FIREWALL', 'firewall'],
        M: ['node', 'MAIL', 'mail'], W: ['node', 'WIFI', 'wifi'], H: ['node', 'HVAC', 'router'], Z: ['node', 'FREEZER', 'server'],
        CL: ['node', 'CLEANRM', 'monitor'], S: ['node', 'SWITCH', 'switch'], A: ['lock', 'BIOLOCK', 'lock'], O: ['node', 'OFFICE', 'monitor'],
        L: ['node', 'LAB-1', 'monitor'], V: ['target', 'GENOME', 'vault'], K: ['node', 'KEYPAD', 'kiosk']
      },
      clues: [
        { at: 'X', opens: 'A', text: 'ARCHIVE had the BIOLOCK code in an old audit. BIOLOCK is open.' }
      ],
      ai: {
        node: 'U',
        offers: [
          {
            id: 'shortcut', trigger: 'adjacent',
            voice: 'the {trap} is rigged. come through me and i’ll put you in the vents.',
            terms: 'Trust: a path to HVAC opens until you Extract. UNKNOWN takes {another}{cut} of the payout, and PAR drops by half that.',
            cut: 0.25,
            trustLink: ['U', 'H'],
            // Like Job 02's: it only gets you in. UNKNOWN pulls it at Extract.
            untilExtract: true
          },
          {
            id: 'freeze', trigger: 'extract',
            voice: 'they smell you now. share the archive and i’ll freeze them.',
            terms: 'Trust: every Sentry stalls for 1 phase. UNKNOWN takes {another}{cut}, and PAR drops by half that.',
            cut: 0.25
          }
        ],
        offer: 'the trap is rigged. come through me and i’ll put you in the vents.',
        offerTail: 'you’ll owe me.',
        trustLink: ['U', 'H'],
        trustedLine: 'UNKNOWN kept a copy of the genome. It didn’t say what for.',
        refusedLine: 'UNKNOWN went quiet after you refused. It always does.',
        ignoredLine: 'You never met UNKNOWN. It watched you anyway.'
      },
      sentries: [
        { id: 'X', camera: true, start: 'T', patrol: ['T'] },
        { id: 'A', start: 'M', patrol: ['M', 'CL', 'S', 'W'], offsets: [0, 2] },
        { id: 'B', start: 'H', patrol: ['H', 'O', 'H', 'Z'], offsets: [0, 2] }
      ],
      exits: ['P', 'X'],
      caches: { Z: { kind: 'cash' }, Y: { kind: 'cash' } },
      bag: { nodes: ['D', 'Q'], contents: ['cash', 'honeypot'], canonical: { D: 'cash', Q: 'honeypot' } },
      payout: { base: 1100, par: 1100 },
      bonus: { id: 'quiet', short: 'Quiet', text: 'Quiet: never use Brute' },
      tips: [
        { when: 'start', html: 'UNKNOWN sits in the middle. BIOLOCK’s code is in <b>ARCHIVE</b>, far from the target. Quiet means no Brute.' },
        { when: 'breach', html: '<b>BREACH</b>. Two Sentries hunt you. The camera keeps watching.' }
      ],
      rules: RULES.concat([HEX_RULE, CAMERA_RULE, DECOY_WORM_RULE,
        'Locks open with <b>Brute</b>, or for free if you find the code somewhere on the network.',
        'Something <span class="t-ai">else</span> is on this network. It makes offers. Refusing is free; trusting costs a cut of the payout (PAR drops by half as much).'])
    },
    {
      id: 'job14',
      number: '14',
      name: 'Aurora Exchange',
      goal: 'Front-run the opening bell',
      tagline: 'Three cameras ring the matching engine. You start warm, and the clock is the bonus.',
      turnLimit: 13,
      startHeat: 1,
      programs: { sniff: 1, spoof: 2, decoy: 1, worm: 1, brute: 1 },
      map: [
        'Z  K  V  L  N',
        'H  X1 O  X3 .',
        'M  W  F  T  D',
        'C  R  X2 B  I',
        'P  G  U  Q  .',
        'J  A  LB Y  .',
        '.  .  E  .  .'
      ],
      defs: {
        E: ['entry', 'ENTRY', 'entry'],
        J: ['node', 'JANITOR', 'kiosk'], A: ['node', 'ATRIUM', 'router'], LB: ['node', 'LOBBY', 'kiosk'],
        Y: ['node', 'LOCKERS', 'database', { hidden: true }],
        P: ['node', 'PRINTER', 'printer'], G: ['node', 'GATEWAY', 'router'], U: ['node', 'UPLINK', 'wifi'],
        Q: ['node', 'QUOTES', 'server', { hidden: true }],
        C: ['node', 'CLEARING', 'database'], R: ['node', 'ROUTER', 'router'], X2: ['node', 'CAM-2', 'camera'],
        B: ['node', 'BROKER', 'monitor'], I: ['node', 'INSIDER', 'mail'],
        M: ['node', 'MAIL', 'mail'], W: ['node', 'WIFI', 'wifi'], F: ['firewall', 'FIREWALL', 'firewall'],
        T: ['node', 'TRADER', 'monitor'], D: ['node', 'DESK', 'till'],
        H: ['node', 'HFT-1', 'server'], X1: ['node', 'CAM-1', 'camera'], O: ['node', 'OPS', 'monitor'], X3: ['node', 'CAM-3', 'camera'],
        Z: ['node', 'TICKER', 'till'], K: ['node', 'KIOSK', 'kiosk'], V: ['target', 'MATCHER', 'vault'],
        L: ['node', 'LOGS', 'database'], N: ['node', 'NEWSWIRE', 'wifi']
      },
      clues: [],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'X1', patrol: ['X1'] },
        { id: 'Y', camera: true, start: 'X2', patrol: ['X2'] },
        { id: 'Z', camera: true, start: 'X3', patrol: ['X3'] },
        { id: 'A', start: 'P', patrol: ['P', 'G', 'R', 'G'], offsets: [0, 2] },
        { id: 'B', start: 'T', patrol: ['T', 'B', 'Q', 'B'], offsets: [0, 2] }
      ],
      exits: ['J', 'I', 'N'],
      caches: { D: { kind: 'cash' }, Z: { kind: 'cash' } },
      bag: { nodes: ['Q', 'Y'], contents: ['cash', 'honeypot'], canonical: { Q: 'cash', Y: 'honeypot' } },
      payout: { base: 1300, par: 1300 },
      bonus: { id: 'speed', short: 'Fast', text: 'Fast: get out by turn 10', turn: 10 },
      tips: [
        { when: 'start', html: 'You start with <b>1 heat</b>. Every way into MATCHER is on camera: bank an action or <b>Spoof</b> to get in and out clean.' },
        { when: 'breach', html: '<b>BREACH</b>. The exit could be any of three. Run.' }
      ],
      rules: RULES.concat([HEX_RULE, CAMERA_RULE, DECOY_WORM_RULE])
    },
    {
      id: 'job15',
      number: '15',
      name: 'Helix Biobank',
      goal: 'Walk out with the seed vault',
      tagline: 'The finale. Three guards, two cameras, two firewalls, a lock, and three ways out.',
      turnLimit: 15,
      programs: { sniff: 2, spoof: 2, decoy: 2, worm: 1, brute: 1 },
      map: [
        'NA KP V  LG .',
        'ZR LK C1 OP SW',
        'ML WF F1 HV DS',
        'CL RT .  TR GN',
        'PR C2 BR F2 QH',
        'IN UP .  YH JT',
        'KT TK LB DK .',
        '.  .  EN .  .'
      ],
      defs: {
        EN: ['entry', 'ENTRY', 'entry'],
        KT: ['node', 'KITCHEN', 'till'], TK: ['node', 'TANKS', 'database'], LB: ['node', 'LOBBY', 'kiosk'], DK: ['node', 'GUARD', 'monitor'],
        IN: ['node', 'INTAKE', 'kiosk'], UP: ['node', 'UPS', 'server'], YH: ['node', 'SAMPLES', 'database', { hidden: true }], JT: ['node', 'DOCK', 'router'],
        PR: ['node', 'PRINTER', 'printer'], C2: ['node', 'CAM-2', 'camera'], BR: ['node', 'REACTOR', 'server'],
        F2: ['firewall', 'FIREWALL', 'firewall'], QH: ['node', 'ISOLATE', 'database', { hidden: true }],
        CL: ['node', 'CLINIC', 'monitor'], RT: ['node', 'ROUTER', 'router'], TR: ['node', 'TRIAGE', 'monitor'], GN: ['node', 'GENSEQ', 'server'],
        ML: ['node', 'MAIL', 'mail'], WF: ['node', 'WIFI', 'wifi'], F1: ['firewall', 'FIREWALL', 'firewall'],
        HV: ['node', 'HVAC', 'router'], DS: ['node', 'DESK', 'till'],
        ZR: ['node', 'CRYO', 'server'], LK: ['lock', 'BIOLOCK', 'lock'], C1: ['node', 'CAM-1', 'camera'],
        OP: ['node', 'OPS', 'monitor'], SW: ['node', 'SAT-UP', 'wifi'],
        NA: ['node', 'NAS', 'database'], KP: ['node', 'KEYPAD', 'kiosk'], V: ['target', 'SEEDS', 'vault'], LG: ['node', 'LOGS', 'database']
      },
      clues: [
        { at: 'TK', opens: 'LK', text: 'TANKS had the BIOLOCK code taped to a valve log. BIOLOCK is open.' }
      ],
      ai: null,
      sentries: [
        { id: 'X', camera: true, start: 'C1', patrol: ['C1'] },
        { id: 'Y', camera: true, start: 'C2', patrol: ['C2'] },
        { id: 'A', start: 'ML', patrol: ['ML', 'ZR', 'NA', 'ZR'], offsets: [0] },
        { id: 'B', start: 'HV', patrol: ['HV', 'DS', 'GN', 'TR'], offsets: [0, 2] },
        { id: 'C', start: 'IN', patrol: ['IN', 'UP', 'BR', 'UP'], offsets: [0, 2] }
      ],
      exits: ['KT', 'JT', 'SW'],
      caches: { NA: { kind: 'cash' }, CL: { kind: 'cash' } },
      bag: { nodes: ['YH', 'QH'], contents: ['cash', 'honeypot'], canonical: { YH: 'cash', QH: 'honeypot' } },
      payout: { base: 1600, par: 1600 },
      bonus: { id: 'wormStun', short: 'Worm', text: 'Stun a Sentry with a Worm' },
      tips: [
        { when: 'start', html: 'The biggest board yet. Three guards, two cameras, two firewalls, and BIOLOCK’s code is in <b>TANKS</b>. Plan the way out first.' },
        { when: 'breach', html: '<b>BREACH</b>. Three guards hunt you. A Worm in their path buys time.' }
      ],
      rules: RULES.concat([HEX_RULE, CAMERA_RULE, DECOY_WORM_RULE,
        'Locks open with <b>Brute</b>, or for free if you find the code somewhere on the network.'])
    }
  ];

  JOBS.push.apply(JOBS, HEX_JOBS.map(hexJob));
  Object.defineProperty(JOBS, 'hexNeighbors', { value: hexNeighbors });

  root.BACKDOOR_JOBS = JOBS;
  if (typeof module !== 'undefined' && module.exports) module.exports = JOBS;
})(typeof window !== 'undefined' ? window : globalThis);
