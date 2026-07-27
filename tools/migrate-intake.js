#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
//  Brings intake.html onto the shared design tokens.
//
//  It has its own <style> block and never linked the app's CSS,
//  so the main-app retheme left it wearing the old warm/cream
//  palette. Same two-stage approach as the stylesheet migration:
//  an explicit intent map first, then a measured pass over the
//  long tail, with anything ambiguous reported rather than
//  guessed at.
//
//  Usage:  node tools/migrate-intake.js [--apply]
// ════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FILE = path.join(__dirname, '..', 'intake.html');

const MAP = {
  // warm neutrals
  '#D8D0C8': 'var(--bdr)',      '#E4D8C4': 'var(--surface3)', '#EFEAE2': 'var(--bdr-light)',
  '#FAFAF8': 'var(--input-bg)', '#FBFAF7': 'var(--card-bg)',  '#F8F3EC': 'var(--surface)',
  '#7A7268': 'var(--text2)',    '#E8EEF2': 'var(--surface2)',
  // gold accent -> indigo
  '#C9983A': 'var(--accent)',   '#A07428': 'var(--accent)',   '#E0CDA4': 'var(--accent-border)',
  '#FBF3E2': 'var(--accent-bg)','#8A6A20': 'var(--accent-fg)','#6B5520': 'var(--accent-fg)',
  '#5A4A28': 'var(--accent-fg)','#B87878': 'var(--danger)',
  // semantic
  '#DC2626': 'var(--danger)',   '#B03030': 'var(--danger)',
  '#1A1A1A': 'var(--text)',
  // desaturated blues used as muted chrome
  '#9FB4C4': 'var(--text3)',    '#7E93A4': 'var(--text2)',    '#8FA5B5': 'var(--text3)',
  '#35576D': 'var(--text)',
};

const hsl = (hex) => {
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let s = 0, h = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
};
const NEUTRALS = [
  [100, 'var(--card-bg)'], [98.5, 'var(--bg)'], [97, 'var(--surface)'], [96, 'var(--surface2)'],
  [94, 'var(--surface3)'], [93.5, 'var(--bdr-light)'], [90, 'var(--bdr)'],
  [65, 'var(--text-dim)'], [56, 'var(--text3)'], [40, 'var(--text2)'], [10, 'var(--text)'],
];
const family = (h) => (h >= 345 || h < 18) ? 'danger' : (h < 70) ? 'warn'
  : (h < 165) ? 'ok' : (h < 255) ? 'info' : 'accent';

const PROP = /(^|[;{]\s*)((?:-[a-z]+-)?(?:border(?:-(?:top|right|bottom|left))?(?:-color)?|border|background(?:-color)?|color|fill|stroke|outline-color|caret-color))(\s*:\s*)([^;{}]*)/gi;

let hits = 0; const skipped = {};

function convert(css) {
  return css.replace(PROP, (full, lead, prop, sep, value) => {
    if (/gradient|shadow|url\(/i.test(value)) return full;
    const isText = /^color$|fill|stroke/i.test(prop), isBorder = /border/i.test(prop);
    const next = value.replace(/#[0-9A-Fa-f]{3,6}\b/g, (hex) => {
      const key = '#' + hex.slice(1).toUpperCase();
      if (key === '#FFF' || key === '#FFFFFF') { hits++; return /background/i.test(prop) ? 'var(--card-bg)' : 'var(--accent-ink)'; }
      if (MAP[key]) { hits++; return MAP[key]; }
      const H = hsl(hex);
      let tok = null;
      if (H.s < 15) {
        let best = NEUTRALS[0], bd = 1e9;
        for (const [l, t] of NEUTRALS) { const d = Math.abs(l - H.l); if (d < bd) { bd = d; best = [l, t]; } }
        tok = best[1];
      } else if (H.l > 88) tok = `var(--${family(H.h)}-bg)`;
      else if (H.l < 34 && (isText || isBorder)) tok = `var(--${family(H.h)}-fg)`;
      else if (isText || isBorder) tok = `var(--${family(H.h)})`;
      if (!tok) { skipped[key] = (skipped[key] || 0) + 1; return hex; }
      hits++; return tok;
    });
    return lead + prop + sep + next;
  });
}

let html = fs.readFileSync(FILE, 'utf8');

// 1. the <style> block
html = html.replace(/<style>[\s\S]*?<\/style>/, (block) => convert(block));
// 2. inline style attributes
html = html.replace(/style="[^"]*"/g, (attr) => convert(attr));

// 3. link the shared tokens + resolve the theme before first paint
if (!/css\/tokens\.css/.test(html)) {
  html = html.replace(/(<\/title>)/, `$1
  <link rel="stylesheet" href="css/tokens.css?v=20260726e">
  <!-- Theme resolved before first paint, sharing the main app's preference
       so opening New Order doesn't flash the other theme. -->
  <script>
    (function () {
      var t;
      try { t = localStorage.getItem('sts-theme'); } catch (e) {}
      if (t !== 'dark' && t !== 'light') {
        t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', t);
    })();
  </script>`);
}

if (APPLY) fs.writeFileSync(FILE, html);

console.log(APPLY ? '── APPLIED ──' : '── DRY RUN ──');
console.log('substitutions:', hits);
const sk = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
console.log('left alone (saturated mid-tone fills):', sk.reduce((s, r) => s + r[1], 0), 'in', sk.length, 'distinct');
sk.slice(0, 12).forEach(([h, n]) => console.log('   ' + String(n).padStart(3) + '  ' + h));
