// ════════════════════════════════════════════════════════════
//  Builds mockups/all-in-one.html — every design in one
//  self-contained page, so the set can be published as a single
//  Artifact and browsed on a phone.
//
//  Carries the markup and structural CSS ONCE plus the ten design
//  CSS blocks (~80KB), rather than concatenating ten finished
//  pages (~389KB). The active design's CSS is swapped into a
//  <style> element on selection.
// ════════════════════════════════════════════════════════════

const { STRUCTURE, mockupBody, esc } = require('./shell');
const DESIGNS = [...require('./designs-a'), ...require('./designs-b')];

// ── Scope design CSS to #stage ───────────────────────────────
// The mockups render inside a div rather than an iframe (Artifacts run
// under a strict CSP and frame-src is not worth betting the page on).
// Nearly every rule is already class-based and the chrome uses sts-*
// names, so only the handful of :root / element-level rules need
// rewriting. Order matters: the dark selector must be rewritten before
// the bare :root.
function scope(css) {
  return css
    .replace(/html,body\{height:100%\}/g, '')
    // Width media queries become container queries against the stage.
    // Media queries resolve against the viewport, so on a phone the mockup
    // would collapse to its mobile layout even in Desktop mode — which is
    // precisely the layout Desktop mode exists to bypass. Preference
    // queries (colour scheme, reduced motion) stay as @media.
    .replace(/@media \((max|min)-width:/g, '@container stage ($1-width:')
    .replace(/\*,\*::before,\*::after\{/g, '#stage *,#stage *::before,#stage *::after{')
    .replace(/\bbutton,input,select\{/g, '#stage button,#stage input,#stage select{')
    .replace(/(^|\n)a\{/g, '$1#stage a{')
    .replace(/:root\[data-theme="dark"\]/g, '#stage[data-mock="dark"]')
    .replace(/:root/g, '#stage')
    // Glass paints an ambient gradient on body::before with position:fixed;
    // scoped to the stage it must be absolute or it would cover the chrome.
    .replace(/content:'';position:fixed;inset:-25%/g, "content:'';position:absolute;inset:-25%")
    .replace(/(^|\n|\})body::before/g, '$1#stage::before')
    .replace(/(^|\n|\})body\{/g, '$1#stage{');
}

// The structural CSS is identical for all ten, so it ships once as a static
// sheet between the two swapped ones — tokens must cascade before it, the
// design's component overrides after. Inlining it per design would repeat
// ~8KB ten times.
const STRUCTURE_SCOPED = scope(STRUCTURE);

const PAYLOAD = DESIGNS.map(d => ({
  id: d.file.replace(/\.html$/, ''),
  num: d.num,
  name: d.name,
  thesis: d.thesis,
  tokens: scope(d.css),
  extra: scope(d.extra || ''),
}));

// ── Chrome ───────────────────────────────────────────────────
// Deliberately monochrome. The ten designs span acid lime, phosphor
// green, vermilion and gold — any accent hue in the frame would bias
// how they read. So the frame has no colour opinion: ink on paper,
// mono numerals, hairline rules. A proof sheet, not a poster.
const CHROME = `
.sts *,.sts *::before,.sts *::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#14161A; --paper:#FFFFFF; --sunk:#F4F5F7;
  --edge:#E2E4E8; --edge2:#EDEEF1; --muted:#6B7078;
  --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
  --ui:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --ink:#EDEEF1; --paper:#0F1013; --sunk:#16181C;
    --edge:#24262B; --edge2:#1C1E22; --muted:#8B9098;
  }
}
:root[data-theme="dark"]{
  --ink:#EDEEF1; --paper:#0F1013; --sunk:#16181C;
  --edge:#24262B; --edge2:#1C1E22; --muted:#8B9098;
}
:root[data-theme="light"]{
  --ink:#14161A; --paper:#FFFFFF; --sunk:#F4F5F7;
  --edge:#E2E4E8; --edge2:#EDEEF1; --muted:#6B7078;
}
body{
  margin:0;background:var(--sunk);color:var(--ink);
  font-family:var(--ui);
  -webkit-font-smoothing:antialiased;
}
/* The page scrolls naturally with a sticky bar rather than a locked
   100vh shell with an inner scroller — the Artifact host owns the
   document wrapper, and a fixed-height layout breaks if it nests us. */
.sts{display:flex;flex-direction:column;min-height:100dvh}

/* ── Control bar ── */
.sts-bar{
  position:sticky;top:0;z-index:10;
  flex-shrink:0;background:var(--paper);
  border-bottom:1px solid var(--edge);
}
.sts-row{
  display:flex;align-items:center;gap:10px;
  padding:9px 14px 8px;
}
.sts-mark{
  font-family:var(--mono);font-size:10px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--muted);
  white-space:nowrap;
}
.sts-mark b{color:var(--ink);font-weight:600}
.sts-spacer{flex:1}
.sts-seg{
  display:flex;border:1px solid var(--edge);border-radius:7px;
  overflow:hidden;flex-shrink:0;
}
.sts-seg button{
  font-family:var(--mono);font-size:10px;font-weight:600;
  letter-spacing:.08em;text-transform:uppercase;
  background:none;border:none;color:var(--muted);
  padding:6px 10px;cursor:pointer;line-height:1;
  transition:background .15s,color .15s;
}
.sts-seg button + button{border-left:1px solid var(--edge)}
.sts-seg button:hover{color:var(--ink)}
.sts-seg button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}

/* ── Design chips: a contact sheet's frame strip ── */
.sts-strip{
  display:flex;gap:6px;overflow-x:auto;
  padding:0 14px 9px;
  scrollbar-width:none;-ms-overflow-style:none;
  scroll-snap-type:x proximity;
  overscroll-behavior-x:contain;
}
.sts-strip::-webkit-scrollbar{display:none}
.sts-chip{
  display:flex;align-items:baseline;gap:6px;flex-shrink:0;
  background:none;border:1px solid var(--edge);border-radius:7px;
  padding:6px 11px 6px 9px;cursor:pointer;
  color:var(--muted);font-family:var(--ui);
  scroll-snap-align:start;
  transition:border-color .15s,color .15s,background .15s;
}
.sts-chip:hover{border-color:var(--muted);color:var(--ink)}
.sts-chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.sts-chip[aria-pressed="true"] .sts-n{color:var(--paper);opacity:.55}
.sts-n{
  font-family:var(--mono);font-size:10px;font-weight:600;
  font-variant-numeric:tabular-nums;color:var(--muted);opacity:.8;
}
.sts-nm{font-size:12.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.sts-thesis{
  padding:0 14px 10px;font-size:11.5px;line-height:1.45;
  color:var(--muted);max-width:70ch;
}

/* ── Stage frame ── */
.sts-frame{flex:1;min-height:0;background:var(--sunk)}
/* No background here — the chrome sheet loads after the design sheets and
   would win the #stage specificity tie, painting every design white. */
#stage{
  transform-origin:top left;
  /* Makes the mockup's converted @container rules resolve against the
     stage's own width rather than the phone's. */
  container-type:inline-size;
  container-name:stage;
}
/* The preview scrolls as one document — sticky chrome inside a scaled,
   nested scroll container produces artifacts, and stickiness is not what
   is being evaluated here. */
#stage .app{min-height:0}
#stage .sidebar{position:static;height:auto}
#stage .topbar{position:static}

:where(button):focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:6px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

@media (max-width:560px){
  .sts-row{padding:8px 11px 7px;gap:7px}
  .sts-strip{padding:0 11px 8px}
  .sts-thesis{padding:0 11px 9px;font-size:11px}
  .sts-mark{font-size:9px;letter-spacing:.1em}
  .sts-seg button{padding:6px 8px;font-size:9.5px}
}
`;

const chips = PAYLOAD.map((d, i) => `        <button class="sts-chip" type="button" data-i="${i}"
          aria-pressed="${i === 0 ? 'true' : 'false'}">
          <span class="sts-n">${d.num}</span><span class="sts-nm">${esc(d.name)}</span>
        </button>`).join('\n');

const html = `<title>STS Workflow — 10 Redesigns</title>
<style id="tokenSheet"></style>
<style>${STRUCTURE_SCOPED}</style>
<style id="extraSheet"></style>
<style>${CHROME}</style>

<div class="sts">
  <div class="sts-bar">
    <div class="sts-row">
      <span class="sts-mark">Stones Throw <b>Redesigns</b></span>
      <span class="sts-spacer"></span>
      <div class="sts-seg" role="group" aria-label="Preview theme">
        <button type="button" id="mLight" aria-pressed="true">Light</button>
        <button type="button" id="mDark" aria-pressed="false">Dark</button>
      </div>
      <div class="sts-seg" role="group" aria-label="Preview width">
        <button type="button" id="wDesk" aria-pressed="true">Desktop</button>
        <button type="button" id="wPhone" aria-pressed="false">Phone</button>
      </div>
    </div>
    <div class="sts-strip" role="group" aria-label="Choose a design">
${chips}
    </div>
    <p class="sts-thesis" id="thesis"></p>
  </div>

  <div class="sts-frame" id="frame">
    <div id="stage" data-mock="light">
    ${mockupBody()}
    </div>
  </div>
</div>

<script>
(function(){
  var D = ${JSON.stringify(PAYLOAD.map(d => ({ n: d.name, t: d.thesis, k: d.tokens, x: d.extra })))};
  var K = 'sts-allinone';
  var tokenSheet = document.getElementById('tokenSheet');
  var extraSheet = document.getElementById('extraSheet');
  var stage = document.getElementById('stage');
  var frame = document.getElementById('frame');
  var thesis = document.getElementById('thesis');
  var chips = [].slice.call(document.querySelectorAll('.sts-chip'));

  // The Artifact host supplies the document head; add the viewport meta if
  // it didn't, or a phone lays the page out at a 980px default and nothing
  // responsive fires.
  if (!document.querySelector('meta[name="viewport"]')) {
    var mv = document.createElement('meta');
    mv.name = 'viewport';
    mv.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
    document.head.appendChild(mv);
  }

  var st = { i:0, mock:'light', width:'desktop' };
  try { var s = JSON.parse(localStorage.getItem(K)||'null'); if(s) st = Object.assign(st, s); } catch(e){}
  if (st.i < 0 || st.i >= D.length) st.i = 0;

  function save(){ try{ localStorage.setItem(K, JSON.stringify(st)); }catch(e){} }

  function press(el, on){ el.setAttribute('aria-pressed', on ? 'true':'false'); }

  // Desktop mode renders the stage at a true 1400px and scales it down to
  // fit, so a phone shows the layout being judged rather than the mobile
  // fallback. zoom (not transform) so the scroll box sizes itself.
  // 1520px, not a rounder 1400: the board needs 1222px of track for eight
  // columns at their 144px floor, and 1400 leaves only 1124 — the last two
  // stages would clip. Pinch-zoom stays enabled for reading detail.
  var DESK = 1520;
  // Viewport height minus the sticky bar — how much room the stage has.
  function avail(){
    var bar = document.querySelector('.sts-bar');
    return Math.max(240, (window.innerHeight || 640) - (bar ? bar.offsetHeight : 0));
  }
  function fit(){
    if (st.width === 'desktop'){
      var k = Math.min(1, (frame.clientWidth || 360) / DESK);
      stage.style.width = DESK + 'px';
      stage.style.zoom = k;
      // Undo the scale so the stage still fills the viewport; otherwise the
      // frame's own background shows as a band under short designs.
      stage.style.minHeight = (avail() / k) + 'px';
    } else {
      stage.style.width = '100%';
      stage.style.zoom = '1';
      stage.style.minHeight = avail() + 'px';
    }
  }

  function render(){
    var d = D[st.i];
    tokenSheet.textContent = d.k;
    extraSheet.textContent = d.x;
    stage.setAttribute('data-mock', st.mock);
    thesis.textContent = d.t;
    chips.forEach(function(c,i){ press(c, i === st.i); });
    press(document.getElementById('mLight'), st.mock === 'light');
    press(document.getElementById('mDark'),  st.mock === 'dark');
    press(document.getElementById('wDesk'),  st.width === 'desktop');
    press(document.getElementById('wPhone'), st.width === 'phone');
    // Keep the mockup's own theme button honest about what it will do.
    var ti = stage.querySelector('#themeIcon'), tl = stage.querySelector('#themeLabel');
    if (ti) ti.textContent = st.mock === 'dark' ? '☀' : '◐';
    if (tl) tl.textContent = st.mock === 'dark' ? 'Light' : 'Dark';
    fit();
  }

  chips.forEach(function(c){
    c.addEventListener('click', function(){
      st.i = +c.getAttribute('data-i'); save(); render();
      c.scrollIntoView({block:'nearest', inline:'nearest'});
    });
  });
  document.getElementById('mLight').onclick = function(){ st.mock='light'; save(); render(); };
  document.getElementById('mDark').onclick  = function(){ st.mock='dark';  save(); render(); };
  document.getElementById('wDesk').onclick  = function(){ st.width='desktop'; save(); render(); };
  document.getElementById('wPhone').onclick = function(){ st.width='phone';   save(); render(); };

  // Handlers the mockup markup itself calls.
  window.toggleTheme = function(){ st.mock = st.mock==='dark'?'light':'dark'; save(); render(); };
  window.showView = function(id, el){
    stage.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    stage.querySelector('#'+id).classList.add('active');
    stage.querySelectorAll('.vs-btn').forEach(function(b){ b.classList.remove('active'); });
    el.classList.add('active');
    var t = stage.querySelector('.topbar-title');
    if (t) t.textContent = id === 'view-dash' ? 'Dashboard' : 'Order Pipeline';
    frame.scrollTop = 0;
  };

  var rt;
  addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(fit, 90); });
  render();
})();
</script>
`;

module.exports = { html, scope, DESIGNS: PAYLOAD };
