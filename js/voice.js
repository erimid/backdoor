/*
 * UNKNOWN's voice: short lowercase barks shown in the whisper strip.
 * Sets window.BackdoorVoice. No DOM. ui.js decides when to speak (at most
 * one bark per turn); pickBark maps a batch of engine events to one line.
 */
(function (root) {
  var barks = {
    scanned: ['sloppy.', 'they see you.'],
    bumped: ['ouch.'],
    dodge: ['nice.', 'close.'],
    honeypot: ['told you it was bait.'],
    cache: ['greedy. i like it.'],
    brute: ['loud.'],
    breach: ['run.'],
    traceStart: ['tick tock.'],
    bandUp: ['you’re loud.'],
    refuse: ['fine. your funeral.'],
    trust: ['good. don’t make me regret it.'],
    job01Start: ['watching.'],
    job01Win: ['not bad. see you soon.']
  };

  // Lines are dealt from a shuffled deck per key, so nothing repeats until
  // the list is exhausted.
  var decks = {};
  function line(key) {
    var list = barks[key];
    if (!list || !list.length) return null;
    if (!decks[key] || !decks[key].length) {
      decks[key] = list.slice();
      for (var i = decks[key].length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)); var t = decks[key][i]; decks[key][i] = decks[key][j]; decks[key][j] = t;
      }
    }
    return decks[key].shift();
  }

  // Most dramatic first.
  var PRIORITY = ['breach', 'honeypot', 'scanned', 'bumped', 'traceStart', 'refuse', 'trust', 'bandUp', 'dodge', 'brute', 'cache'];

  function keyOf(e) {
    switch (e.kind) {
      case 'scan': return e.hit ? 'scanned' : null;
      case 'bump': return e.spoofed ? null : 'bumped';
      case 'dodge': case 'miss': return 'dodge';
      case 'reveal': return e.trap ? 'honeypot' : null;
      case 'cache': return 'cache';
      case 'open': return e.by === 'brute' ? 'brute' : null;
      case 'breach': return 'breach';
      case 'traceStart': return 'traceStart';
      case 'bandUp': return 'bandUp';
      case 'ai': return e.trust ? 'trust' : 'refuse';
    }
    return null;
  }

  // events: engine events (plus synthetic {kind:'bandUp'}). Returns a line or null.
  function pickBark(events) {
    var keys = {};
    (events || []).forEach(function (e) { var k = keyOf(e); if (k) keys[k] = true; });
    for (var i = 0; i < PRIORITY.length; i++) if (keys[PRIORITY[i]]) return line(PRIORITY[i]);
    return null;
  }

  root.BackdoorVoice = { barks: barks, line: line, pickBark: pickBark, keyOf: keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BackdoorVoice;
})(typeof window !== 'undefined' ? window : globalThis);
