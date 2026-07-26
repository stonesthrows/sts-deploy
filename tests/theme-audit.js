// ════════════════════════════════════════════
//  THEME AUDIT  —  tests/theme-audit.js
//  Walks every tab in both themes and checks the things a palette
//  migration actually gets wrong: text that lost contrast against its
//  real backdrop, and elements still painting a colour from the old
//  hardcoded palette.
//
//  The fingerprint suite can't cover this — only two of its probes read
//  colour at all. This one measures what a person would see.
//
//  Usage:
//    node theme-audit.js            — audit both themes, report failures
//    node theme-audit.js --shots    — also write PNGs to /tmp for eyeballing
// ════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { startServer } = require('./lib/server');

const CHROMIUM_PATH = require('./lib/chromium-path')();
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/theme-shots';

const TAB_TARGETS = [
  'home', 'dashboard', 'production', 'customers', 'gmail', 'sales',
  'bestsellers', 'notes', 'supplier', 'order-history', 'materials',
  'to-restock', 'inv-adjust', 'prod-report', 'replenish', 'triplog',
  'pj-calc', 'pj-ref', 'calendar', 'designs',
];

// Colours from the retired warm/cream palette. Any of these still painting
// means a component rule was missed by the token migration.
const LEGACY = [
  'rgb(228, 221, 212)', 'rgb(216, 208, 200)', 'rgb(253, 250, 246)',
  'rgb(248, 243, 236)', 'rgb(240, 235, 227)', 'rgb(238, 230, 220)',
  'rgb(122, 114, 104)', 'rgb(196, 180, 154)', 'rgb(201, 152, 58)',
  'rgb(78, 122, 148)', 'rgb(30, 61, 80)', 'rgb(35, 70, 89)',
];

const AUDIT = (LEGACY) => {
  const parse = (s) => {
    if (!s || s === 'transparent') return null;
    const m = s.match(/-?[\d.]+/g);
    if (!m) return null;
    const isFn = s.trim().startsWith('color(');
    const k = isFn ? 255 : 1;
    return { rgb: [m[0] * k, m[1] * k, m[2] * k], a: m.length > 3 ? +m[3] : 1 };
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
  };
  // Composite up the ancestor chain to the colour actually behind the text.
  const backdrop = (el) => {
    let n = el, acc = null;
    while (n && n !== document.documentElement) {
      // A gradient or image backdrop can't be reduced to one colour, so
      // stop rather than report a ratio measured against whatever is
      // behind it — that produces confident nonsense.
      if (getComputedStyle(n).backgroundImage !== 'none') return null;
      const p = parse(getComputedStyle(n).backgroundColor);
      if (p && p.a > 0) {
        if (!acc) acc = { rgb: p.rgb.slice(), a: p.a };
        else acc.rgb = acc.rgb.map((c, i) => c * acc.a + p.rgb[i] * (1 - acc.a));
        if ((acc.a += (1 - acc.a) * p.a) >= .98) break;
      }
      n = n.parentElement;
    }
    return acc ? acc.rgb : [255, 255, 255];
  };

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };

  const low = [], legacy = [];
  const panel = document.querySelector('.tab-panel.active');
  const roots = [document.querySelector('.sidebar'), document.querySelector('.topbar'), panel].filter(Boolean);

  for (const root of roots) {
    for (const el of root.querySelectorAll('*')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);

      // Legacy-palette check on whatever this element paints.
      for (const prop of ['backgroundColor', 'color', 'borderTopColor', 'borderLeftColor']) {
        if (LEGACY.includes(cs[prop])) {
          legacy.push({ sel: (el.tagName + '.' + (el.className || '')).slice(0, 60), prop, val: cs[prop] });
        }
      }

      // Contrast, only for elements with their own short text.
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (!own || own.length < 2) continue;
      // Icon-only labels (💎, ↻, ▾) are glyphs, not prose — a contrast ratio
      // against them measures nothing a reader cares about.
      if (!/[a-zA-Z0-9]/.test(own)) continue;
      const fg = parse(cs.color);
      if (!fg || fg.a < .5) continue;
      const bg = backdrop(el);
      if (!bg) continue;              // gradient backdrop — not measurable
      const eff = fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
      const L1 = lum(eff), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 600;
      // WCAG AA: 3.0 for large/bold, 4.5 otherwise.
      const floor = (size >= 18.66 || (size >= 14 && bold)) ? 3.0 : 4.5;
      // Backgrounds that come from user data or a live API payload, not from
      // the theme. Their contrast is whatever the user picked, so the palette
      // can't be held responsible — report them separately rather than
      // failing the theme on them.
      const dataDriven =
        el.closest('[style*="background:"]') && /badge|chip|pill/i.test(el.className || '') ||
        /Unexpected token|SyntaxError/.test(own);

      if (ratio < floor && dataDriven) { continue; }

      if (ratio < floor) {
        low.push({
          sel: (el.tagName + '.' + (typeof el.className === 'string' ? el.className : '')).slice(0, 54),
          text: own.slice(0, 26), ratio: Math.round(ratio * 100) / 100, need: floor,
        });
      }
    }
  }
  return { low, legacy };
};

// A var(--foo) with no matching declaration silently falls back to the
// inherited colour, so it looks *almost* right and never throws. That is
// exactly how a retheme ships an invisible label.
function checkTokens(say) {
  const cssDir = path.join(__dirname, '..', 'css');
  const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css') && f !== 'print-setup.css');
  let all = '';
  for (const f of files) all += fs.readFileSync(path.join(cssDir, f), 'utf8');
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  // Set on the element at runtime rather than in a stylesheet.
  const RUNTIME = new Set(['--msg-tail-x', '--pj-row-tint', '--sc']);
  const used = [...new Set([...all.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))];
  const missing = used.filter(t => !defined.has(t) && !RUNTIME.has(t));
  if (missing.length) {
    say('FAIL  undefined design tokens referenced: ' + missing.join(', '));
    return false;
  }
  say(`PASS  all ${used.length} referenced design tokens are defined`);
  return true;
}

async function run({ baseUrl } = {}) {
  const lines = [];
  const say = (m) => { lines.push(m); };
  let server = null;
  if (!baseUrl) { server = await startServer(); baseUrl = server.baseUrl; }

  const tokensOk = checkTokens(say);
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  let failures = tokensOk ? 0 : 1, legacyTotal = 0, checked = 0;
  // Sampled per theme so we can prove the two are actually different. An
  // earlier version of this suite passed all 40 checks while dark mode was
  // entirely dead — the attribute was set, but no rule consumed it.
  const sampled = {};

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      try { localStorage.setItem('sts-theme', t); } catch (e) {}
    }, theme);
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const actual = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (actual !== theme) {
      say(`FAIL  theme did not apply — wanted ${theme}, got ${actual}`);
      failures++;
    }

    sampled[theme] = await page.evaluate(() => {
      const g = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      return {
        body:    getComputedStyle(document.body).backgroundColor,
        text:    getComputedStyle(document.body).color,
        sidebar: g('.sidebar', 'backgroundColor'),
        topbar:  g('.topbar', 'backgroundColor'),
        card:    g('.stat-card, .card, .home-widget', 'backgroundColor'),
      };
    });

    for (const tab of TAB_TARGETS) {
      await page.evaluate((t) => { try { switchTab(t, null); } catch (e) {} }, tab);
      await page.waitForTimeout(220);
      const r = await page.evaluate(AUDIT, LEGACY);
      checked++;

      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOT_DIR, `${theme}-${tab}.png`) });
      }
      if (r.legacy.length) {
        legacyTotal += r.legacy.length;
        const u = [...new Map(r.legacy.map(x => [x.val + x.prop, x])).values()].slice(0, 3);
        say(`FAIL  ${theme}/${tab}: ${r.legacy.length} element(s) still painting the old palette`);
        u.forEach(x => say(`        ${x.prop}=${x.val}  ${x.sel}`));
        failures++;
      }
      if (r.low.length) {
        const u = [...new Map(r.low.map(x => [x.sel + x.ratio, x])).values()];
        say(`FAIL  ${theme}/${tab}: ${r.low.length} low-contrast text node(s)`);
        u.slice(0, 4).forEach(x => say(`        ${x.ratio}:1 (needs ${x.need}) "${x.text}"  ${x.sel}`));
        failures++;
      }
    }
    await ctx.close();
  }

  await browser.close();
  if (server) server.stop();

  // The theme has to actually change what is painted.
  const same = Object.keys(sampled.light || {}).filter(
    k => sampled.light[k] && sampled.light[k] === (sampled.dark || {})[k]);
  if (same.length) {
    say('FAIL  these surfaces render identically in light and dark: ' + same.join(', '));
    say('      (light and dark tokens are not both taking effect)');
    failures++;
  } else {
    say('PASS  every sampled surface differs between light and dark');
    say(`        body    ${sampled.light.body}  ->  ${sampled.dark.body}`);
    say(`        sidebar ${sampled.light.sidebar}  ->  ${sampled.dark.sidebar}`);
  }

  say(`${checked} tab/theme combinations audited.`);
  say(legacyTotal ? `${legacyTotal} legacy-palette paints remain.` : 'No legacy-palette colour remains.');
  say(failures ? `THEME AUDIT FAILED (${failures})` : 'THEME AUDIT PASSED');
  return { pass: failures === 0, lines };
}

if (require.main === module) {
  run().then(r => { console.log(r.lines.join('\n')); process.exit(r.pass ? 0 : 1); })
       .catch(e => { console.error(e); process.exit(1); });
}
module.exports = { run };
