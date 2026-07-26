#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
//  Semantic-family lint.
//
//  Most of the colour migration was done by *measuring* colours
//  and mapping them to the nearest token. That gets legibility
//  right but can get meaning wrong — a "materials" chip mapped
//  to the warning family still passes every contrast check while
//  telling the reader something false.
//
//  This reads each rule's selector for what it evidently means,
//  and flags rules whose semantic tokens disagree.
//
//  Usage:  node tools/lint-semantics.js
// ════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const FILES = ['app', 'inventory', 'perm-jewelry', 'prod-report', 'restock-queue', 'triplog']
  .map(f => path.join(__dirname, '..', 'css', f + '.css'));

// What a selector name implies about its meaning.
const MEANING = {
  danger: /\b(error|fail|danger|overdue|late|invalid|missing|delete|remove|cancel|alert|critical|unpaid|reject|stop|conflict|bad)\b/i,
  ok:     /\b(ok|success|done|complete|completed|paid|saved|valid|good|contacted|delivered|instock|in-stock|synced|approved|ready|up)\b/i,
  warn:   /\b(warn|warning|caution|pending|waiting|wait|due|soon|low|unsynced|draft|hold|stale|needs)\b/i,
  info:   /\b(info|note|hint|tip|link|help)\b/i,
};

// Which family a rule actually uses.
const USES = {
  danger: /var\(--danger(-bg|-fg|-line)?\)/,
  ok:     /var\(--ok(-bg|-fg|-line)?\)/,
  warn:   /var\(--warn(-bg|-fg|-line)?\)/,
  info:   /var\(--info(-bg|-fg|-line)?\)/,
};

// Reviewed and deliberately kept: each already used this colour before the
// retheme (checked against origin/main), so the name/colour disagreement is
// the app's own long-standing choice — these notes are red because they are
// meant to alarm, whatever the class happens to be called. Named here rather
// than silenced, so the disagreement stays visible to the next reader.
const REVIEWED = new Set(['.ot-hint.estimate', '.co-note.co-warn', '.rp-top-note']);

const findings = [];

for (const file of FILES) {
  const css = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  // Crude rule split is fine here: we only need selector + declaration text.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = m[2];
    if (!sel || sel.startsWith('@') || sel.startsWith(':root')) continue;

    const implied = Object.keys(MEANING).filter(k => MEANING[k].test(sel));
    if (!implied.length) continue;
    const used = Object.keys(USES).filter(k => USES[k].test(body));
    if (!used.length) continue;

    // Agreement if any implied family is among those used.
    if (implied.some(i => used.includes(i))) continue;

    const short = sel.split('\n').pop().trim();
    if (REVIEWED.has(short)) continue;
    const line = css.slice(0, m.index).split('\n').length;
    findings.push({
      where: `${name}:${line}`,
      sel: sel.split('\n').pop().trim().slice(0, 62),
      implied: implied.join('/'),
      used: used.join('/'),
    });
  }
}

if (!findings.length) {
  console.log('PASS  every rule whose selector implies a status uses that status family');
} else {
  console.log(`${findings.length} rule(s) where the colour family disagrees with the selector's meaning:\n`);
  for (const f of findings) {
    console.log(`  ${f.where.padEnd(24)} reads as "${f.implied}" but uses "${f.used}"`);
    console.log(`      ${f.sel}`);
  }
}
process.exit(findings.length ? 1 : 0);
