#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
//  One-shot colour migration: legacy hex -> design tokens.
//
//  The app carried an older warm/cream design hardcoded into
//  component rules, layered under the newer token palette. That
//  is why dark mode needed 122 hand-written patch rules — a
//  component painting #E4DDD4 can't follow a theme.
//
//  Mapping is by *intent*, derived from clustering every
//  border/background/color/fill/stroke use. Run once, then keep
//  the CLAUDE.md rule: no raw hex in a component rule.
//
//  Usage:  node tools/migrate-colors.js [--dry]
// ════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..');

// print-setup.css is deliberately excluded: print output is ink on paper
// and must not follow the screen theme.
const FILES = [
  'css/app.css', 'css/inventory.css', 'css/perm-jewelry.css',
  'css/prod-report.css', 'css/restock-queue.css', 'css/triplog.css',
];

// ── Mapping ──────────────────────────────────────────────────
// Keys are uppercase 6-digit hex. Order within a group is
// irrelevant; every occurrence of the key becomes the token.
const MAP = {
  // ── Legacy warm neutrals: borders ──
  '#E4DDD4': 'var(--bdr)',       '#D8D0C8': 'var(--bdr)',
  '#DDD5CC': 'var(--bdr)',       '#E8E0D4': 'var(--bdr)',
  '#D6CCBE': 'var(--bdr)',       '#DCD4C8': 'var(--bdr)',
  '#E0D8CC': 'var(--bdr)',       '#D4C8B8': 'var(--bdr)',
  '#EDE8E2': 'var(--bdr-light)', '#EEE6DC': 'var(--bdr-light)',
  '#F0EBE3': 'var(--bdr-light)', '#EAE4DC': 'var(--bdr-light)',
  '#E8E4DE': 'var(--bdr-light)', '#F1EBE0': 'var(--bdr-light)',

  // ── Legacy warm neutrals: surfaces ──
  '#FDFAF6': 'var(--card-bg)',   '#FDFCFA': 'var(--card-bg)',
  '#FAFAF8': 'var(--input-bg)',  '#FAF8F5': 'var(--input-bg)',
  '#F8F3EC': 'var(--surface)',   '#FAF7F2': 'var(--surface)',
  '#F5F0E8': 'var(--surface)',   '#F7F4EF': 'var(--surface)',
  '#ECE7DF': 'var(--surface3)',  '#EFEAE2': 'var(--surface3)',
  '#F4EFE7': 'var(--surface2)',  '#F2EDE5': 'var(--surface2)',

  // ── Legacy warm neutrals: text ──
  '#7A7268': 'var(--text2)',     '#6A6460': 'var(--text2)',
  '#5A5450': 'var(--text2)',     '#8A8278': 'var(--text3)',
  '#B8B0A6': 'var(--text3)',     '#A79E8F': 'var(--text3)',
  '#9A8860': 'var(--text3)',     '#9A9288': 'var(--text3)',
  '#C4B49A': 'var(--text-dim)',  '#B0A896': 'var(--text-dim)',

  // ── Gold accent -> indigo accent ──
  '#C9983A': 'var(--accent)',      '#A07428': 'var(--accent)',
  '#B07818': 'var(--accent)',      '#8C6520': 'var(--accent)',
  '#D4AA56': 'var(--accent-mid)',  '#E8C878': 'var(--accent-light)',
  '#F0D498': 'var(--accent-light)','#E8D0A0': 'var(--accent-border)',
  '#FDF6E8': 'var(--accent-bg)',   '#FDF5E6': 'var(--accent-bg)',
  '#FBF3E2': 'var(--accent-bg)',   '#F5E9D2': 'var(--accent-bg)',

  // ── Semantic: danger / overdue ──
  '#C43030': 'var(--danger)',    '#C0392B': 'var(--danger)',
  '#A0402A': 'var(--danger)',    '#B3392C': 'var(--danger)',
  '#8B2020': 'var(--danger-fg)', '#A63A22': 'var(--danger)',
  '#C84020': 'var(--danger)',    '#B04018': 'var(--danger)',
  '#FF9090': 'var(--danger-fg)', '#E08070': 'var(--danger-fg)',
  '#FEF0EF': 'var(--danger-bg)', '#FEE8E0': 'var(--danger-bg)',
  '#FBE3DD': 'var(--danger-bg)', '#FDE4D4': 'var(--danger-bg)',
  '#F8D8D0': 'var(--danger-bg)', '#FBE0DA': 'var(--danger-bg)',

  // ── Semantic: ok / complete ──
  '#3A7A4A': 'var(--ok)',        '#2A7A48': 'var(--ok)',
  '#059669': 'var(--ok)',        '#2A8C50': 'var(--ok)',
  '#1E6840': 'var(--ok-fg)',     '#2C6B48': 'var(--ok-fg)',
  '#6AB87A': 'var(--ok)',        '#7FC79A': 'var(--ok-fg)',
  '#EAF6EE': 'var(--ok-bg)',     '#E6F5EC': 'var(--ok-bg)',
  '#EFF9F3': 'var(--ok-bg)',     '#E2F2E8': 'var(--ok-bg)',
  '#DFF0E8': 'var(--ok-bg)',     '#E4F3EA': 'var(--ok-bg)',

  // ── Semantic: warning ──
  '#E8943A': 'var(--warn)',      '#C0980C': 'var(--warn)',
  '#9A6F0A': 'var(--warn-fg)',   '#8A5B12': 'var(--warn-fg)',
  '#7A5A00': 'var(--warn-fg)',   '#E8C468': 'var(--warn)',
  '#FEF3C7': 'var(--warn-bg)',   '#FFF3CD': 'var(--warn-bg)',
  '#FDF0DC': 'var(--warn-bg)',   '#FEF7E6': 'var(--warn-bg)',
  '#FDF9EF': 'var(--warn-bg)',   '#FEF2CC': 'var(--warn-bg)',

  // ── Semantic: info ──
  '#2563EB': 'var(--info)',      '#2563eb': 'var(--info)',
  '#3A5FCC': 'var(--info-fg)',   '#234E8C': 'var(--info-fg)',
  '#E8EFFE': 'var(--info-bg)',   '#EFF3FD': 'var(--info-bg)',
  '#E6EEF8': 'var(--info-bg)',   '#EEF4FC': 'var(--info-bg)',

  // ── Kanban stage hues ──
  // Distinct per stage on purpose: which column an order sits in is
  // information, so these stay tellable apart rather than collapsing
  // into the accent.
  '#4A72E8': 'var(--s-intake)',   '#D4A020': 'var(--s-sketch)',
  '#DC6B28': 'var(--s-estimate)', '#E05828': 'var(--s-estimate)',
  '#9050CC': 'var(--s-material)', '#2A68B8': 'var(--s-bench)',
  '#2A9A62': 'var(--s-deposit)',  '#1A7A48': 'var(--s-deposit)',
  '#1E84A8': 'var(--s-ready)',    '#2A9898': 'var(--s-ready)',
  '#D47030': 'var(--s-repair)',   '#50901E': 'var(--s-deposit)',
  '#A86028': 'var(--s-estimate)', '#9C27B0': 'var(--s-material)',
  '#7B1FA2': 'var(--s-material)', '#6830A8': 'var(--s-material)',
};

// Only rewrite hex that sits on a colour-bearing property. A hex inside a
// gradient, shadow or filter is left alone — those are handled by the
// token values themselves, and blind substitution there breaks syntax.
const PROP = /(^|[;{]\s*)((?:-[a-z]+-)?(?:border(?:-(?:top|right|bottom|left))?(?:-color)?|border|background(?:-color)?|color|fill|stroke|outline-color|caret-color|text-decoration-color))(\s*:\s*)([^;{}]*)/gi;

let totalHits = 0, perFile = [];
const unmapped = {};

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  let css = fs.readFileSync(p, 'utf8');
  let hits = 0;

  css = css.replace(PROP, (full, lead, prop, sep, value) => {
    // Leave gradients/shadows alone.
    if (/gradient|shadow|url\(/i.test(value)) return full;
    const next = value.replace(/#[0-9A-Fa-f]{6}\b/g, (hex) => {
      const key = '#' + hex.slice(1).toUpperCase();
      const tok = MAP[key] || MAP[hex];
      if (tok) { hits++; return tok; }
      unmapped[key] = (unmapped[key] || 0) + 1;
      return hex;
    });
    return lead + prop + sep + next;
  });

  if (!DRY) fs.writeFileSync(p, css);
  totalHits += hits;
  perFile.push([rel, hits]);
}

console.log(DRY ? '── DRY RUN ──' : '── APPLIED ──');
for (const [f, n] of perFile) console.log('  ' + String(n).padStart(4) + '  ' + f);
console.log('  ' + String(totalHits).padStart(4) + '  total substitutions');

const rest = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
const restTotal = rest.reduce((s, r) => s + r[1], 0);
console.log('\nunmapped chrome hex remaining: ' + restTotal + ' (' + rest.length + ' distinct)');
for (const [h, n] of rest.slice(0, 30)) console.log('  ' + String(n).padStart(3) + '  ' + h);
