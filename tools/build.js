#!/usr/bin/env node
// Inlines the CSS and scripts into one self-contained HTML file:
// dist/backdoor.html. Handy for sending the prototype to a phone.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script') + '</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/backdoor.html'), html);
console.log('wrote dist/backdoor.html (' + Math.round(html.length / 1024) + ' KB)');
