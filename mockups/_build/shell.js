// ════════════════════════════════════════════════════════════
//  Markup + structural CSS shared by every mockup.
//
//  Deliberately minimal: it establishes the layout skeleton and
//  the token *contract* (--bg, --card, --text, --accent, --s1…--s8,
//  …) that each design fills in. All colour lives in the design
//  files — nothing here hardcodes a hex, so a design can repaint
//  the whole app by redefining tokens, exactly the way
//  body.theme-midnight does in the real css/app.css.
// ════════════════════════════════════════════════════════════

const { KPIS, COLUMNS, NAV, SALES, TRIP, CALENDAR, PACKAGES, STUDIO } = require('./data');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Structural CSS (layout only — colour comes from the design) ──
const STRUCTURE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:var(--font);font-size:var(--fs,14px);
  background:var(--bg);color:var(--text);
  -webkit-font-smoothing:antialiased;
  transition:background .3s ease,color .3s ease;
}
button,input,select{font:inherit;color:inherit}
a{color:inherit;text-decoration:none}

.app{display:grid;grid-template-columns:var(--sidebar-w,232px) 1fr;min-height:100vh}

/* ── Sidebar ── */
.sidebar{
  background:var(--sidebar-bg);color:var(--sidebar-fg);
  border-right:var(--sidebar-border,1px solid var(--border));
  display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto;
}
.brand{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;flex-shrink:0}
.brand-mark{
  width:32px;height:32px;border-radius:var(--radius-sm);
  background:var(--brand-mark-bg);
  display:grid;place-items:center;font-size:16px;flex-shrink:0;
}
.brand-name{font-family:var(--font-head);font-weight:var(--brand-weight,700);font-size:14px;color:var(--brand-fg);line-height:1.2;display:block}
.brand-sub{font-size:10.5px;color:var(--sidebar-dim);letter-spacing:.04em;display:block;margin-top:1px}
.sb-nav{flex:1;padding:0 8px 12px}
.sb-section{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
  color:var(--sidebar-dim);padding:14px 8px 5px;
}
.sb-item{
  display:flex;align-items:center;gap:9px;
  padding:7px 9px;border-radius:var(--radius-sm);
  font-size:13px;color:var(--sidebar-fg);cursor:pointer;
  transition:background .14s,color .14s;
  margin-bottom:1px;
}
.sb-item:hover{background:var(--sidebar-hover)}
.sb-item.active{background:var(--sidebar-active-bg);color:var(--sidebar-active-fg);font-weight:600}
.sb-ico{width:17px;text-align:center;flex-shrink:0;font-size:13px}
.sb-badge{
  margin-left:auto;background:var(--accent);color:var(--accent-ink);
  font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;
}
.sb-foot{padding:10px;border-top:1px solid var(--border);flex-shrink:0}
.sb-foot button{
  width:100%;text-align:left;background:none;cursor:pointer;
  border:1px solid var(--border);border-radius:var(--radius-sm);
  color:var(--sidebar-dim);font-size:12px;font-weight:600;padding:7px 10px;
}

/* ── Topbar ── */
.main{display:flex;flex-direction:column;min-width:0}
.topbar{
  display:flex;align-items:center;gap:10px;
  padding:0 var(--pad,22px);height:var(--topbar-h,54px);flex-shrink:0;
  background:var(--topbar-bg);border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:20;
}
.topbar-title{font-family:var(--font-head);font-size:var(--title-size,15px);font-weight:var(--title-weight,700);letter-spacing:var(--title-track,-.01em)}
.spacer{flex:1}
.pill{
  display:inline-flex;align-items:center;gap:6px;
  background:var(--pill-bg);border:1px solid var(--pill-border);
  border-radius:var(--pill-radius,20px);padding:4px 11px;
  font-size:11.5px;color:var(--text2);
}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);flex-shrink:0}
.icon-btn{
  background:none;border:1px solid transparent;border-radius:var(--radius-sm);
  padding:5px 8px;font-size:14px;cursor:pointer;line-height:1;
  transition:background .14s;
}
.icon-btn:hover{background:var(--hover)}
.theme-toggle{
  display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  background:var(--pill-bg);border:1px solid var(--pill-border);
  border-radius:var(--pill-radius,20px);padding:4px 11px;
  font-size:11.5px;font-weight:600;color:var(--text2);
}
.theme-toggle:hover{background:var(--hover)}

/* ── View switch ── */
.vs{
  display:flex;gap:var(--vs-gap,2px);padding:var(--vs-pad,10px 22px 0);
  background:var(--subnav-bg);border-bottom:1px solid var(--border);
}
.vs-btn{
  background:none;border:none;cursor:pointer;
  padding:8px 14px;font-size:12.5px;font-weight:600;
  color:var(--text3);border-radius:var(--radius-sm) var(--radius-sm) 0 0;
  border-bottom:2px solid transparent;margin-bottom:-1px;
  transition:color .14s,border-color .14s,background .14s;
}
.vs-btn:hover{color:var(--text)}
.vs-btn.active{color:var(--accent-text);border-bottom-color:var(--accent);background:var(--vs-active-bg,transparent)}

.view{display:none;padding:var(--view-pad,20px 22px 36px)}
.view.active{display:block}

/* ── Dashboard ── */
.dash-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.greeting{font-family:var(--font-head);font-size:var(--greet-size,22px);font-weight:var(--greet-weight,700);letter-spacing:var(--greet-track,-.02em);line-height:1.1}
.dash-date{font-size:12.5px;color:var(--text3);margin-top:3px}
.btn{
  background:var(--accent);color:var(--accent-ink);cursor:pointer;
  border:var(--btn-border,none);border-radius:var(--radius-sm);
  padding:7px 15px;font-size:12.5px;font-weight:600;
  box-shadow:var(--btn-shadow,none);transition:filter .14s,transform .14s;
}
.btn:hover{filter:brightness(1.08)}
.btn:active{transform:translateY(1px)}

.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--gap,12px);margin-bottom:var(--gap,12px)}
.kpi{
  display:flex;align-items:center;gap:12px;
  background:var(--card);border:var(--card-border,1px solid var(--border));
  border-radius:var(--radius);padding:14px 16px;
  box-shadow:var(--shadow);cursor:pointer;
  transition:transform .16s var(--ease),box-shadow .16s var(--ease),border-color .16s;
}
.kpi:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg)}
.kpi-ico{
  width:38px;height:38px;border-radius:var(--radius-sm);
  display:grid;place-items:center;font-size:17px;flex-shrink:0;
}
.t-gold{background:var(--tone-gold)}
.t-purple{background:var(--tone-purple)}
.t-red{background:var(--tone-red)}
.t-green{background:var(--tone-green)}
.kpi-num{font-family:var(--font-num,var(--font-head));font-size:var(--kpi-size,25px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.kpi-lbl{font-size:10.5px;color:var(--text2);margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}

.dash-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:var(--gap,12px);align-items:start}
.dash-col{display:flex;flex-direction:column;gap:var(--gap,12px);min-width:0}
.dash-split{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap,12px)}

.card{
  background:var(--card);border:var(--card-border,1px solid var(--border));
  border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;
  transition:box-shadow .16s var(--ease);
}
.card:hover{box-shadow:var(--shadow-lg)}
.card-head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:10px 14px;background:var(--card-head-bg);
  border-bottom:1px solid var(--border-soft);
  font-size:12.5px;font-weight:700;color:var(--card-head-fg);
  letter-spacing:var(--head-track,0);text-transform:var(--head-case,none);
}
.card-link{font-size:11.5px;font-weight:600;color:var(--accent-text);cursor:pointer;background:none;border:none;padding:2px 6px;border-radius:5px}
.card-link:hover{background:var(--accent-soft)}
.card-body{padding:12px 14px}

/* Sales */
.sales-total{display:flex;align-items:baseline;gap:9px;margin-bottom:10px}
.sales-num{font-family:var(--font-num,var(--font-head));font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.sales-delta{font-size:12px;font-weight:700;color:var(--ok-text)}
.sales-sub{font-size:11.5px;color:var(--text3)}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;font-size:12.5px;border-top:1px solid var(--border-soft)}
.row:first-child{border-top:none}
.row-dim{color:var(--text3);font-size:11.5px}
.row-num{font-weight:700;font-variant-numeric:tabular-nums}

/* Trip */
.trip-route{font-size:13px;font-weight:600;line-height:1.35}
.trip-miles{font-family:var(--font-num,var(--font-head));font-size:22px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}
.trip-when{font-size:11.5px;color:var(--text3)}

/* Studio chips */
.studio-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 14px}
.studio-chip{
  background:var(--chip-bg);border:1px solid var(--border-soft);
  border-radius:var(--radius-sm);padding:10px 11px;
}
.studio-n{font-family:var(--font-num,var(--font-head));font-size:19px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.studio-l{font-size:10.5px;color:var(--text2);margin-top:4px;font-weight:600}

/* Calendar + packages */
.list{padding:4px 0}
.li{display:flex;align-items:flex-start;gap:10px;padding:8px 14px;border-top:1px solid var(--border-soft);font-size:12.5px}
.li:first-child{border-top:none}
.li-time{color:var(--text3);font-size:11.5px;font-variant-numeric:tabular-nums;flex-shrink:0;min-width:38px;font-weight:600}
.li-main{flex:1;min-width:0;line-height:1.35}
.li-sub{font-size:11px;color:var(--text3);margin-top:2px}
.tag{
  font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;
  white-space:nowrap;flex-shrink:0;letter-spacing:.02em;
}
.tag.ok{background:var(--tag-ok-bg);color:var(--tag-ok-fg)}
.tag.soon{background:var(--tag-soon-bg);color:var(--tag-soon-fg)}
.tag.late{background:var(--tag-late-bg);color:var(--tag-late-fg)}
.tag.done{background:var(--tag-done-bg);color:var(--tag-done-fg)}

/* ── Kanban ── */
.board-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.board-title{font-family:var(--font-head);font-size:var(--greet-size,22px);font-weight:var(--greet-weight,700);letter-spacing:var(--greet-track,-.02em)}
.board{display:flex;gap:var(--col-gap,10px);overflow-x:auto;padding-bottom:14px;align-items:flex-start;scrollbar-width:thin}
.board::-webkit-scrollbar{height:8px}
.board::-webkit-scrollbar-track{background:var(--border-soft);border-radius:4px}
.board::-webkit-scrollbar-thumb{background:var(--text3);border-radius:4px;opacity:.5}

.k-col{
  /* 150px keeps all eight stages on screen at laptop width, the way the
     real board does (.k-col there floors at 120px). Columns still flex
     wider on big displays, and the track scrolls rather than the body. */
  flex:1 1 0;min-width:var(--col-min,144px);
  border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;
  /* Stage colour is derived here, NOT on :root — a custom property
     substitutes var() at the element that declares it, and --sc is only
     set on .k-col. Declared on :root these would all resolve against an
     unset --sc and collapse to invalid (i.e. transparent). Designs tune
     the blend with the --mix-* percentages, which are safe on :root
     because they carry no var() of their own. */
  --k-head-bg:color-mix(in srgb,var(--sc) var(--mix-head,14%),var(--card));
  --k-head-fg:color-mix(in srgb,var(--sc) var(--mix-head-fg,74%),var(--text));
  --k-count-bg:color-mix(in srgb,var(--sc) var(--mix-count,22%),transparent);
  --k-body-bg:color-mix(in srgb,var(--sc) var(--mix-body,6%),var(--card));
}
.k-head{
  display:flex;align-items:center;justify-content:space-between;gap:6px;
  padding:9px 12px;font-size:10.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.07em;
  background:var(--k-head-bg);color:var(--k-head-fg);
}
.k-count{
  background:var(--k-count-bg);border-radius:20px;padding:1px 7px;
  font-size:10px;font-weight:700;min-width:20px;text-align:center;
  font-variant-numeric:tabular-nums;
}
.k-body{
  background:var(--k-body-bg);padding:8px;min-height:150px;
  display:flex;flex-direction:column;gap:8px;
}
.k-empty{
  text-align:center;padding:14px 8px;color:var(--text3);
  font-size:11.5px;font-style:italic;
  border:1.5px dashed var(--border);border-radius:var(--radius-sm);
}
.o-card{
  background:var(--o-card-bg);
  border:var(--o-border,1px solid var(--border));
  border-left:var(--o-edge-w,3px) solid var(--sc);
  border-radius:var(--radius-sm);padding:10px 11px 9px;
  box-shadow:var(--shadow);cursor:grab;
  transition:transform .16s var(--ease),box-shadow .16s var(--ease);
}
.o-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg)}
.o-flag{
  display:flex;align-items:center;gap:5px;
  margin:-10px -11px 8px;padding:5px 11px;
  background:var(--flag-bg);color:var(--flag-fg);
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
}
.o-name{font-size:12.5px;font-weight:700;line-height:1.3;letter-spacing:-.01em;overflow-wrap:anywhere}
.o-desc{font-size:11.5px;color:var(--text2);line-height:1.4;margin-top:5px}
.o-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.o-badge{
  font-size:10px;font-weight:600;padding:2px 6px;border-radius:5px;
  background:var(--badge-bg);color:var(--badge-fg);
  border:1px solid var(--border-soft);
  /* A pickup name like "Chaparral Crossing" is wider than a column at the
     144px floor. Ellipsize rather than let it paint past the card edge. */
  white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;
}
.o-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px;flex-wrap:wrap}
.o-price{font-family:var(--font-num,var(--font-head));font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;margin-left:auto}

/* ── Responsive ── */
@media (max-width:1080px){
  .dash-grid{grid-template-columns:1fr}
  .kpi-row{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:760px){
  .app{grid-template-columns:1fr}
  .sidebar{display:none}
  .dash-split{grid-template-columns:1fr}
  .studio-grid{grid-template-columns:repeat(2,1fr)}
  :root{--pad:14px;--view-pad:16px 14px 30px}
  .vs{padding:8px 14px 0;overflow-x:auto}
  .k-col{min-width:80vw}
  /* The topbar runs out of room before anything else does. Drop the two
     least essential items — the sync pill and the ⌘K hint — rather than
     let the icon buttons push the page into horizontal scroll. */
  .topbar{gap:6px}
  .pill{display:none}
  .topbar-title::after{display:none}
}
@media (max-width:460px){
  .kpi-row{grid-template-columns:1fr}
}
`;

// ── Markup pieces ──────────────────────────────────────────

function sidebar() {
  const nav = NAV.map(g => {
    const sec = g.section ? `<div class="sb-section">${esc(g.section)}</div>` : '';
    const items = g.items.map(([ico, label, active, badge]) =>
      `<div class="sb-item${active ? ' active' : ''}"><span class="sb-ico">${ico}</span>${esc(label)}` +
      (badge ? `<span class="sb-badge">${esc(badge)}</span>` : '') + `</div>`
    ).join('\n        ');
    return `${sec}\n        ${items}`;
  }).join('\n        ');

  return `<aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">💎</div>
        <div>
          <span class="brand-name">Stones Throw Studio</span>
          <span class="brand-sub">Order Workflow</span>
        </div>
      </div>
      <nav class="sb-nav">
        ${nav}
      </nav>
      <div class="sb-foot"><button>⚙ Integrations</button></div>
    </aside>`;
}

function topbar(designName) {
  return `<header class="topbar">
        <span class="topbar-title">Dashboard</span>
        <span class="spacer"></span>
        <span class="pill"><span class="dot"></span>Notion <span style="color:var(--text3)">2m ago</span></span>
        <button class="theme-toggle" onclick="toggleTheme()">
          <span id="themeIcon">◐</span><span id="themeLabel">Dark</span>
        </button>
        <button class="icon-btn" title="Team messages">💬</button>
        <button class="icon-btn" title="Integrations">🔌</button>
      </header>`;
}

function viewSwitch() {
  return `<div class="vs">
        <button class="vs-btn active" onclick="showView('view-dash',this)">🏠 Dashboard</button>
        <button class="vs-btn" onclick="showView('view-board',this)">📋 Order Pipeline</button>
      </div>`;
}

function kpiRow() {
  return `<div class="kpi-row">
          ${KPIS.map(k => `<div class="kpi">
            <div class="kpi-ico t-${k.tone}">${k.icon}</div>
            <div>
              <div class="kpi-num">${k.num}</div>
              <div class="kpi-lbl">${esc(k.label)}</div>
            </div>
          </div>`).join('\n          ')}
        </div>`;
}

function salesCard() {
  return `<div class="card">
              <div class="card-head"><span>💰 Weekend Sales</span><button class="card-link">Sales →</button></div>
              <div class="card-body">
                <div class="sales-total">
                  <span class="sales-num">${SALES.total}</span>
                  <span class="sales-delta">▲ ${SALES.delta}</span>
                </div>
                <div class="sales-sub" style="margin-bottom:8px">${esc(SALES.txns)} · vs last weekend</div>
                ${SALES.rows.map(([d, loc, amt]) => `<div class="row">
                  <span>${esc(d)} <span class="row-dim">· ${esc(loc)}</span></span>
                  <span class="row-num">${esc(amt)}</span>
                </div>`).join('\n                ')}
              </div>
            </div>`;
}

function tripCard() {
  return `<div class="card">
              <div class="card-head"><span>🚗 Latest Trip</span><button class="card-link">Trips →</button></div>
              <div class="card-body">
                <div class="trip-route">${esc(TRIP.route)}</div>
                <div class="trip-miles">${esc(TRIP.miles)}</div>
                <div class="trip-when">${esc(TRIP.when)}</div>
                <div class="row" style="margin-top:9px"><span class="row-dim">Year to date</span><span class="row-num">${esc(TRIP.ytd)}</span></div>
              </div>
            </div>`;
}

function studioCard() {
  return `<div class="card">
            <div class="card-head"><span>📋 Orders in Studio</span><button class="card-link">View pipeline →</button></div>
            <div class="studio-grid">
              ${STUDIO.map(([label, n]) => `<div class="studio-chip">
                <div class="studio-n">${n}</div>
                <div class="studio-l">${esc(label)}</div>
              </div>`).join('\n              ')}
            </div>
          </div>`;
}

function calendarCard() {
  return `<div class="card">
            <div class="card-head"><span>📅 Calendar</span><button class="card-link">Open full →</button></div>
            <div class="list">
              ${CALENDAR.map(([t, what, tone]) => `<div class="li">
                <span class="li-time">${esc(t)}</span>
                <span class="li-main">${esc(what)}</span>
                <span class="tag ${tone}">${tone === 'soon' ? 'Next' : 'Today'}</span>
              </div>`).join('\n              ')}
            </div>
          </div>`;
}

function packagesCard() {
  return `<div class="card">
            <div class="card-head"><span>📦 Packages</span><button class="card-link">+ New</button></div>
            <div class="list">
              ${PACKAGES.map(([dir, label, status, when, tone]) => `<div class="li">
                <span class="li-time">${dir}</span>
                <span class="li-main">${esc(label)}<div class="li-sub">${esc(when)}</div></span>
                <span class="tag ${tone}">${esc(status)}</span>
              </div>`).join('\n              ')}
            </div>
          </div>`;
}

function dashboard() {
  return `<section id="view-dash" class="view active">
        <div class="dash-head">
          <div>
            <div class="greeting">Good morning, Kyle</div>
            <div class="dash-date">Sunday, July 26 · 3 orders due this week</div>
          </div>
          <button class="btn">⟳ Refresh</button>
        </div>

        ${kpiRow()}

        <div class="dash-grid">
          <div class="dash-col">
            <div class="dash-split">
              ${salesCard()}
              ${tripCard()}
            </div>
            ${studioCard()}
          </div>
          <div class="dash-col">
            ${calendarCard()}
            ${packagesCard()}
          </div>
        </div>
      </section>`;
}

function card(c) {
  const badges = (c.badges || []).map(([ico, txt]) =>
    `<span class="o-badge">${ico} ${esc(txt)}</span>`).join('');
  return `<div class="o-card">
              ${c.flag ? `<div class="o-flag">📞 ${esc(c.flag)}</div>` : ''}
              <div class="o-name">${esc(c.name)}</div>
              <div class="o-desc">${esc(c.desc)}</div>
              ${badges ? `<div class="o-badges">${badges}</div>` : ''}
              <div class="o-foot">
                <span class="tag ${c.dueCls}">${esc(c.due)}</span>
                <span class="o-price">${esc(c.price)}</span>
              </div>
            </div>`;
}

function board() {
  const cols = COLUMNS.map(col => `<div class="k-col" style="--sc:var(--${col.hue})">
            <div class="k-head"><span>${esc(col.label)}</span><span class="k-count">${col.cards.length}</span></div>
            <div class="k-body">
              ${col.cards.map(card).join('\n              ')}
            </div>
          </div>`).join('\n          ');

  return `<section id="view-board" class="view">
        <div class="board-bar">
          <div>
            <div class="board-title">Order Pipeline</div>
            <div class="dash-date">16 active orders across 8 stages</div>
          </div>
          <button class="btn">✚ New Order</button>
        </div>
        <div class="board">
          ${cols}
        </div>
      </section>`;
}

const SCRIPT = key => `
  (function(){
    var K='sts-mock-${key}';
    var qs=new URLSearchParams(location.search).get('theme');
    var saved=null; try{ saved=localStorage.getItem(K); }catch(e){}
    var initial=qs||saved||(window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
    apply(initial);
    function apply(t){
      document.documentElement.setAttribute('data-theme',t);
      var i=document.getElementById('themeIcon'),l=document.getElementById('themeLabel');
      if(i)i.textContent=t==='dark'?'☀':'◐';
      if(l)l.textContent=t==='dark'?'Light':'Dark';
    }
    window.toggleTheme=function(){
      var t=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
      apply(t); try{ localStorage.setItem(K,t); }catch(e){}
    };
    window.showView=function(id,el){
      document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});
      document.getElementById(id).classList.add('active');
      document.querySelectorAll('.vs-btn').forEach(function(b){b.classList.remove('active')});
      el.classList.add('active');
      var t=document.querySelector('.topbar-title');
      if(t)t.textContent=id==='view-dash'?'Dashboard':'Order Pipeline';
    };
  })();
`;

function page(design) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(design.name)} — STS Redesign ${design.num}</title>
<style>
/* ══════════════════════════════════════════════════════════
   ${design.name.toUpperCase()} — ${design.thesis}
   Redesign concept ${design.num} of 10 for Stones Throw Studio.
   Self-contained mockup: no external requests, no build step.
   ══════════════════════════════════════════════════════════ */
${design.css}
/* ── Shared structure (colour comes entirely from tokens above) ── */
${STRUCTURE}
${design.extra || ''}
</style>
</head>
<body>
<div class="app">
    ${sidebar()}
    <div class="main">
      ${topbar(design.name)}
      ${viewSwitch()}
      ${dashboard()}
      ${board()}
    </div>
  </div>
<script>${SCRIPT(design.num)}</script>
</body>
</html>
`;
}

module.exports = { page, esc };
