/*
 * Job definitions for the Backdoor hacking prototype.
 *
 * Each job is plain data so new jobs (and, later, generated endless-mode jobs)
 * can use the same shape. Grid positions are [column, row] with [0, 0] at the
 * top left; the phone board is 4 columns by 5 rows and ENTRY sits at the bottom.
 *
 * Node types: entry, node, target, firewall, lock, honeypot, ai.
 */
(function (root) {
  var JOBS = [
    {
      id: 'job01',
      number: '01',
      name: 'Corner Store POS',
      goal: 'Steal sales database',
      tagline: 'Tutorial. One Sentry, one firewall, one bad idea.',
      // Design doc says 10. Raised to 12 so the left "slip past the patrol" route
      // fits (the solver's best pure left run needs 11 turns).
      turnLimit: 12,
      programs: { sniff: 1, spoof: 2, brute: 1 },
      nodes: [
        { id: 'E', col: 0, row: 4, type: 'entry', label: 'ENTRY', icon: 'entry' },
        { id: 'A', col: 1, row: 4, type: 'node', label: 'TILL-1', icon: 'till' },
        { id: 'B', col: 2, row: 4, type: 'node', label: 'TILL-2', icon: 'till' },
        { id: 'Y', col: 3, row: 4, type: 'node', label: 'PRINTER', icon: 'printer', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-01', icon: 'camera' },
        { id: 'F', col: 2, row: 3, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'X', col: 3, row: 3, type: 'honeypot', label: 'BACKUP', icon: 'database', hidden: true },
        { id: 'D', col: 0, row: 2, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'G', col: 1, row: 2, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'H', col: 2, row: 2, type: 'node', label: 'POS-SRV', icon: 'server' },
        { id: 'V', col: 2, row: 1, type: 'target', label: 'SALES DB', icon: 'database' }
      ],
      links: [
        ['E', 'A'], ['A', 'B'], ['B', 'Y'], ['B', 'F'], ['F', 'H'], ['Y', 'X'],
        ['X', 'H'], ['E', 'C'], ['C', 'D'], ['D', 'G'], ['G', 'H'], ['H', 'V'],
        // Added to the design doc's list so the "slip past the patrol" route is possible.
        ['C', 'G']
      ],
      clues: [],
      ai: null,
      sentries: [
        { id: 'A', start: 'G', patrol: ['G', 'H', 'G', 'D'] }
      ],
      tips: [
        'You get <b>2 actions</b> a turn. An action is a move to a linked node or running a program.',
        '<span class="t-threat">Orange</span> shows what Sentries do next. An <span class="t-threat">arrow</span> means it moves there. A <span class="t-threat">ring</span> means it scans that node.',
        'Getting scanned or bumped raises <span class="t-threat">heat</span>. At 10 heat you are traced.',
        'Reach the <span class="t-gold">gold</span> node, Extract, then get back to <span class="t-you">ENTRY</span>.',
        '<b>Undo</b> is free within a turn. Try things.'
      ]
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
        { id: 'Q', col: 3, row: 4, type: 'node', label: 'BACKUP', icon: 'database', hidden: true },
        { id: 'C', col: 0, row: 3, type: 'node', label: 'CAM-03', icon: 'camera' },
        { id: 'W', col: 1, row: 3, type: 'node', label: 'WIFI', icon: 'wifi' },
        { id: 'T', col: 3, row: 3, type: 'honeypot', label: 'LEDGER', icon: 'database', hidden: true },
        { id: 'M', col: 0, row: 2, type: 'node', label: 'MAIL-02', icon: 'mail' },
        { id: 'U', col: 1, row: 2, type: 'ai', label: 'UNKNOWN', icon: 'ai' },
        { id: 'F', col: 2, row: 2, type: 'firewall', label: 'FIREWALL', icon: 'firewall' },
        { id: 'H', col: 3, row: 2, type: 'node', label: 'HR-DB', icon: 'database', hidden: true },
        { id: 'A', col: 0, row: 1, type: 'lock', label: 'AUTH-01', icon: 'lock' },
        { id: 'S', col: 2, row: 1, type: 'node', label: 'SWITCH', icon: 'switch' },
        { id: 'K', col: 1, row: 0, type: 'node', label: 'KIOSK', icon: 'kiosk' },
        { id: 'O', col: 2, row: 0, type: 'node', label: 'ADMIN-PC', icon: 'monitor' },
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
        offer: 'the ledger is bait. come through me and i’ll open the switch.',
        offerTail: 'you’ll owe me.',
        trustLink: ['U', 'S'],
        trustedLine: 'UNKNOWN has a copy of the ledger. It says thank you.',
        refusedLine: 'UNKNOWN went quiet after you refused. Then the admin got a tip.',
        ignoredLine: 'You never met UNKNOWN. It noticed you anyway.'
      },
      sentries: [
        { id: 'A', start: 'S', patrol: ['S', 'H', 'S', 'F'] },
        { id: 'B', start: 'M', patrol: ['M', 'C', 'M', 'W'] }
      ],
      tips: [
        '<b>Decoy</b> plants bait. Sentries within 3 hops go for it, and you can see them change course.',
        '<b>Worm</b> infects a node. A Sentry that steps on it is stunned for 2 turns.',
        'Locks open with <b>Brute</b>, or for free if you find the password somewhere on the network.',
        'Something <span class="t-ai">else</span> is on this network. It will talk to you if you get close.'
      ]
    }
  ];

  root.BACKDOOR_JOBS = JOBS;
  if (typeof module !== 'undefined' && module.exports) module.exports = JOBS;
})(typeof window !== 'undefined' ? window : globalThis);
