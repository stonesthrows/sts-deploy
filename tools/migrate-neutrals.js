#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
//  Second migration pass: the long tail.
//
//  After the explicit intent map (migrate-colors.js) the
//  remainder is hundreds of near-duplicate one-offs — the same
//  intent written slightly differently over years. Mapping those
//  by hand would be guesswork; mapping them by measured colour
//  is not.
//
//  Rules, deliberately conservative:
//    * near-neutral  -> nearest neutral token by lightness
//    * pale + saturated (a tinted panel) -> that hue's *-bg token
//    * dark + saturated on a text/border property -> that hue's
//      base token
//  Anything that doesn't fit is REPORTED, never guessed at.
//
//  Usage:  node tools/migrate-neutrals.js [--apply]
// ════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..');
const FILES = [
  'css/app.css', 'css/inventory.css', 'css/perm-jewelry.css',
  'css/prod-report.css', 'css/restock-queue.css', 'css/triplog.css',
];

const hsl = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255,
        g = parseInt(hex.slice(3, 5), 16) / 255,
        b = parseInt(hex.slice(5, 7), 16) / 255;
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

// Neutral ramp, lightest to darkest. A colour lands on whichever stop is
// nearest in lightness.
const NEUTRALS = [
  [100, 'var(--card-bg)'], [98.5, 'var(--bg)'], [97, 'var(--surface)'],
  [96, 'var(--surface2)'], [94, 'var(--surface3)'], [93.5, 'var(--bdr-light)'],
  [90, 'var(--bdr)'], [65, 'var(--text-dim)'], [56, 'var(--text3)'],
  [40, 'var(--text2)'], [10, 'var(--text)'],
];

const family = (h) =>
  (h >= 345 || h < 18) ? 'danger' :
  (h < 45)  ? 'warn'   :          // orange reads as warning here
  (h < 70)  ? 'warn'   :
  (h < 165) ? 'ok'     :
  (h < 200) ? 'info'   :
  (h < 255) ? 'info'   :
  'accent';                       // violet/indigo -> accent family

const PROP = /(^|[;{]\s*)((?:-[a-z]+-)?(?:border(?:-(?:top|right|bottom|left))?(?:-color)?|border|background(?:-color)?|color|fill|stroke|outline-color|caret-color|text-decoration-color))(\s*:\s*)([^;{}]*)/gi;

const decided = {}, skipped = {};
let total = 0;

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  let css = fs.readFileSync(p, 'utf8');

  css = css.replace(PROP, (full, lead, prop, sep, value) => {
    if (/gradient|shadow|url\(/i.test(value)) return full;
    const isText = /^color$|fill|stroke/i.test(prop);
    const isBorder = /border/i.test(prop);

    const next = value.replace(/#[0-9A-Fa-f]{6}\b/g, (hex) => {
      const H = hsl(hex);
      let tok = null;

      if (H.s < 15) {
        // Near-neutral: the chrome that actually breaks dark mode.
        let best = NEUTRALS[0], bd = 1e9;
        for (const [l, t] of NEUTRALS) {
          const d = Math.abs(l - H.l);
          if (d < bd) { bd = d; best = [l, t]; }
        }
        tok = best[1];
      } else if (H.l > 88) {
        tok = `var(--${family(H.h)}-bg)`;
      } else if (H.l < 34 && (isText || isBorder)) {
        tok = `var(--${family(H.h)}-fg)`;
      } else if (isText || isBorder) {
        tok = `var(--${family(H.h)})`;
      }

      if (!tok) {
        skipped[hex.toUpperCase()] = (skipped[hex.toUpperCase()] || 0) + 1;
        return hex;
      }
      const k = hex.toUpperCase() + ' -> ' + tok;
      decided[k] = (decided[k] || 0) + 1;
      total++;
      return tok;
    });
    return lead + prop + sep + next;
  });

  if (APPLY) fs.writeFileSync(p, css);
}

console.log(APPLY ? '── APPLIED ──' : '── DRY RUN ──');
console.log('substitutions: ' + total + '  (' + Object.keys(decided).length + ' distinct mappings)');
const sk = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
console.log('left alone (saturated mid-tone fills — reported, not guessed): ' +
            sk.reduce((s, r) => s + r[1], 0) + ' in ' + sk.length + ' distinct');
for (const [h, n] of sk.slice(0, 20)) console.log('   ' + String(n).padStart(3) + '  ' + h);
