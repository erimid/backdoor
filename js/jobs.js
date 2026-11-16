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
    'Reach the <span class="t-gold">gold</span> target and Extract. That starts the <b>BREACH</b>: ENTRY burns, one of the dashed exits opens, Sentries hunt you, and the trace adds +1 heat every turn.',
    '<b>Brute</b> takes 2 actions and opens a lock or firewall at once. It is loud: Sentries within 3 hops come to look.',
    'Payout: contract + caches + $30 per spare turn − $40 per heat. Stars: get out, beat PAR, and the bonus.',
    '<b>Undo</b> is free within a turn, until you learn something new.'
  ];

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
        { id: 'A', col: 1, row: 4, type: 'node', label: 'TILL-1', icon: 'till' },
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
      caches: { G: { kind: 'cash' } },
      bag: { nodes: ['Y', 'X'], contents: ['cash', 'honeypot'], canonical: { Y: 'cash', X: 'honeypot' } },
      payout: { base: 400, par: 450 },
      bonus: { id: 'ghost', short: 'Ghost', text: 'Ghost: never get scanned or bumped' },
      tips: [
        { when: 'start', html: 'Tap a glowing node to move. <b>2 actions</b> a turn.' },
        { when: 'threatNear', html: '<span class="t-threat">Orange</span> is what they do next. <span class="t-threat">Arrow</span>: it moves there. <span class="t-threat">Ring</span>: it scans there. Don’t end your turn in it.' },
        { when: 'adjBarrier', html: '<b>Brute</b> takes 2 actions and opens it now. It’s loud: Sentries within 3 hops come to look.' },
        { when: 'hiddenNear', html: '<b>?</b> nodes are loot or a trap. <b>Sniff</b> tells you which, and which exit you’ll get.' },
        { when: 'banked', html: 'Banked: <b>3 actions</b> this turn. End a turn with an action left to bank it again.' },
        { when: 'onTarget', html: '<b>EXTRACT</b>. Then it gets loud.' },
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
        ['O', 'V'], ['R', 'W'], ['W', 'F'], ['F', 'S'], ['W', 'U'], ['M', 'W']
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
            terms: 'Trust: path to SWITCH opens. UNKNOWN takes {another}{cut} of the payout.',
            cut: 0.15,
            trustLink: ['U', 'S']
          },
          {
            id: 'freeze', trigger: 'extract',
            voice: 'they’re coming for you. let me ride your copy and i’ll freeze them.',
            terms: 'Trust: every Sentry stalls for 1 phase. UNKNOWN takes {another}{cut}.',
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
        'Something <span class="t-ai">else</span> is on this network. It makes offers. Refusing is free; trusting costs a cut.'
      ])
    }
  ];

  root.BACKDOOR_JOBS = JOBS;
  if (typeof module !== 'undefined' && module.exports) module.exports = JOBS;
})(typeof window !== 'undefined' ? window : globalThis);
