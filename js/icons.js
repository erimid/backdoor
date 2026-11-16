/* Inline SVG icons (24x24 stroke icons, matching the mockups). */
(function (root) {
  var P = {
    entry: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>',
    router: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 13V8M17 13V8"/>',
    till: '<rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V5h10v5M7 15h4"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 17v4h10v-4"/>',
    camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    firewall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 15h18M9 4v5M15 9v6M9 15v5"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    switch: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h4"/>',
    server: '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01"/>',
    kiosk: '<rect x="6" y="2" width="12" height="16" rx="2"/><path d="M10 22h4M12 18v4"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M15.5 12H17"/>',
    trap: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 8v5M12 16h.01"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01"/>',
    sniff: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    spoof: '<path d="M4 10c0-4 3.6-7 8-7s8 3 8 7v9l-3-2-2.5 2L12 17l-2.5 2L7 17l-3 2z"/>',
    decoy: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    worm: '<path d="M3 14c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
    brute: '<path d="M14 4l6 6-3 3-6-6zM11 7l-8 8 6 6 8-8"/>',
    extract: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
  };
  function icon(name, size, extra) {
    size = size || 18;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + (P[name] || '') + '</svg>';
  }
  root.BackdoorIcons = { icon: icon, paths: P };
})(typeof window !== 'undefined' ? window : globalThis);
