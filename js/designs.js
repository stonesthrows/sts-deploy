// ════════════════════════════════════════════
//  DESIGNS  —  js/designs.js
//  Jewelry design specs & instructions library
// ════════════════════════════════════════════

const DESIGNS_KEY  = 'sts-designs';          // legacy localStorage key (migration only)
const DESIGNS_CATS = ['Ear Cuffs', 'Rings', 'Earrings', 'Pendants / Necklaces', 'Meditation Rings', 'Other'];

// Index-only array — no images, just metadata for the library listing.
// Full design (with images) is fetched from KV only when editing.
let _designs         = [];
let _designsCurrentFull = null; // full design currently loaded for editing
let _designsEditId   = null;    // null = new, string = editing existing
let _designsView     = 'library';
let _designsCatFilter = 'all';
let _designsSubTab   = 'families'; // library sub-tab: 'families' (landing) | 'all' | 'stackable'
const DSN_STACK_FAMILY = 'Stackable Rings'; // collection backing the Stackable Rings sub-tab
let _designsSearch   = '';      // library search query, lowercased (empty = no search)
let _dsnSearchTimer  = null;
let _designsFamilyOpen = null;  // design-family drill-in (null = top level)
let _designsFolders  = [];      // manually-created empty folder names (no design tagged in yet)
let _dsnRailOpen     = new Set(); // desktop folder rail: paths currently expanded

// Two browse layouts for the same tree: a wide screen gets the rail beside
// the grid, a narrow one gets shelves (a horizontal row per collection, no
// drilling). The markup differs between them, so the breakpoint has to live
// in JS as well as CSS — re-render whenever it flips.
const _dsnNarrowMq = window.matchMedia('(max-width: 899px)');
function _dsnIsNarrow() { return _dsnNarrowMq.matches; }

// Narrow-ness at the last folder render. The mq 'change' event alone isn't
// enough — it doesn't fire reliably when the viewport is resized from
// outside the page (devtools, embedded webviews), which leaves the rail
// blank and the shelves stranded. Listening to resize too and re-rendering
// only when the mode actually flipped covers both and costs nothing.
let _dsnLastNarrow  = null;
let _dsnResizeTimer = null;
function _dsnOnViewportChange() {
  clearTimeout(_dsnResizeTimer);
  _dsnResizeTimer = setTimeout(() => {
    if (_designsView !== 'library' || _designsSubTab !== 'families') return;
    if (_dsnIsNarrow() === _dsnLastNarrow) return;
    designsRenderLibrary();
  }, 120);
}
_dsnNarrowMq.addEventListener('change', _dsnOnViewportChange);
window.addEventListener('resize', _dsnOnViewportChange);
let _designsImgQueue = [];      // base64 strings staged for current edit session
let _designsAttachQueue = [];   // {key,name,size,contentType} metadata for files uploaded to R2
let _designsImgEditMode = false;

// BOM (Phase 3): material recipe on the design record
let _designsBom       = [];   // [{materialId, qty}] staged for current edit
let _designsMaterials = null; // active materials for the picker (null = loading)
let _shopSettings     = null; // {wasteDefaultPct, wastePctByMetal, shopHourlyRate, …} from /api/shop-settings

// Costing (Phase 4): Square link + labor/retail sources
let _dsnLabor         = null; // parent squareItemId|custom:name -> {hrs, pcs, minPerPc} from work sessions
let _dsnVarToItem     = {};   // squareVariationId -> parent ITEM id (labor pools across sizes)
let _dsnSqPrices      = {};   // squareVariationId -> retail price (null = fetched, no price)
let _dsnSqFetchAttempted = new Set(); // squareVariationId already fetched-and-rendered once (success or fail) — guards against _dsnVariantsRender re-triggering its own fetch forever
let _dsnLinkedSq      = null; // {id, name} staged for current edit
let _dsnSqSearchTimer = null;
let _designsPricingOpen = false;
let _designsPricingFamilyFilter = null; // family name to scope Pricing Sheet rows (null = all designs)

// ── KV API helpers ────────────────────────────
async function _designsApiFetch(id) {
  const url = id ? `/api/designs?id=${encodeURIComponent(id)}` : '/api/designs';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
  return resp.json();
}

async function _designsApiFetchFolders() {
  const resp = await fetch('/api/designs?folders=1');
  if (!resp.ok) throw new Error(`Load failed (${resp.status})`);
  return resp.json();
}

async function _designsApiSave(design) {
  const resp = await fetch('/api/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(design),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Save failed (${resp.status})`);
  }
}

async function _designsApiDelete(id) {
  const resp = await fetch(`/api/designs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
}

// ── Load index from KV ────────────────────────
async function designsLoad() {
  try {
    _designs = await _designsApiFetch();
  } catch {
    // Fallback to legacy localStorage if KV unreachable
    try { _designs = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); }
    catch { _designs = []; }
  }
  try { _designsFolders = await _designsApiFetchFolders(); }
  catch { _designsFolders = []; }
}

// ── Init (fired by TAB_HOOKS) ─────────────────
async function designsInit() {
  _designsShowLoadingPlaceholder();
  await designsLoad();
  await _designsMigrateLocalStorage();
  designsShowLibrary();
  _designsLoadCosting();
}

// Background load of the materials picker + waste settings (BOM editor).
// Runs on every tab visit so new library entries appear without a reload;
// never blocks the library view — re-renders the BOM section when it lands.
function _designsLoadCosting() {
  if (typeof _materialsApiFetch === 'function') {
    _materialsApiFetch()
      .then(ms => { _designsMaterials = ms.filter(m => m.active !== false); _designsBomRender(); _dsnGuideRefresh(); })
      .catch(() => { if (_designsMaterials === null) _designsMaterials = []; _designsBomRender(); _dsnGuideRefresh(); });
  }
  fetch('/api/shop-settings')
    .then(r => r.json())
    .then(s => { _shopSettings = (s && !s.error) ? s : {}; dsnWasteDefaultsRefreshLabel(); dsnBomRecalcEffective(); _dsnGuideRefresh(); })
    .catch(() => { if (_shopSettings === null) _shopSettings = {}; dsnWasteDefaultsRefreshLabel(); });
}

function _designsShowLoadingPlaceholder() {
  document.getElementById('designs-library').style.display = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  document.getElementById('designs-guide-wrap').style.display = 'none';
  const list = document.getElementById('designs-list');
  if (list) list.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Loading designs…</div>';
}

// ── One-time localStorage → KV migration ──────
async function _designsMigrateLocalStorage() {
  if (localStorage.getItem('sts-designs-kv-migrated')) return;

  let local = [];
  try { local = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]'); } catch { local = []; }

  if (local.length) {
    const list = document.getElementById('designs-list');
    if (list) list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Migrating ${local.length} design${local.length > 1 ? 's' : ''} to cloud…</div>`;

    for (const d of local) {
      // Generate a thumb if design has images but no thumb yet
      if (d.images && d.images.length && !d.thumb) {
        try { d.thumb = await _designsMakeThumb(d.images[0]); } catch { d.thumb = null; }
      }
      try { await _designsApiSave(d); } catch { /* best-effort */ }
    }
    await designsLoad();
  }

  localStorage.setItem('sts-designs-kv-migrated', '1');
}

// ── View switching ────────────────────────────
function designsShowLibrary() {
  _designsView   = 'library';
  _designsEditId = null;
  _designsCurrentFull = null;
  _designsImgQueue = [];
  _designsAttachQueue = [];
  _designsImgEditMode = false;
  _designsPricingOpen = false;
  const pricing = document.getElementById('designs-pricing');
  if (pricing) pricing.style.display = 'none';
  const priceBtn = document.getElementById('dsn-pricing-btn');
  if (priceBtn) { priceBtn.style.display = ''; priceBtn.textContent = '💲 Pricing Sheet'; }
  document.getElementById('designs-library').style.display  = '';
  document.getElementById('designs-form-wrap').style.display = 'none';
  document.getElementById('designs-guide-wrap').style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = '';
  const folderBtn = document.getElementById('dsn-folder-btn');
  if (folderBtn) folderBtn.style.display = '';
  designsCloseGearMenu();
  const addRow = document.getElementById('dsn-img-add-row');
  if (addRow) addRow.style.display = 'none';
  designsRenderLibrary();
}

async function designsShowForm(id) {
  _designsView   = 'form';
  _designsEditId = id || null;
  _designsImgQueue   = [];
  _designsAttachQueue = [];
  _designsCurrentFull = null;
  _designsImgEditMode = false;
  _designsPricingOpen = false;
  const pricing = document.getElementById('designs-pricing');
  if (pricing) pricing.style.display = 'none';
  const priceBtn = document.getElementById('dsn-pricing-btn');
  if (priceBtn) priceBtn.style.display = 'none';
  document.getElementById('designs-library').style.display   = 'none';
  document.getElementById('designs-form-wrap').style.display = '';
  document.getElementById('designs-guide-wrap').style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = 'none';
  const folderBtn = document.getElementById('dsn-folder-btn');
  if (folderBtn) folderBtn.style.display = 'none';

  if (id) {
    // Show brief skeleton while fetching full design from KV
    document.getElementById('dsn-name').value  = '';
    document.getElementById('dsn-specs').value = '';
    document.getElementById('dsn-instructions').value = '';
    document.getElementById('dsn-pdf-status').textContent = '⏳ Loading…';
    _dsnStatusTone(document.getElementById('dsn-pdf-status'), '');
    try {
      _designsCurrentFull = await _designsApiFetch(id);
      document.getElementById('dsn-pdf-status').textContent = '';
    } catch(e) {
      document.getElementById('dsn-pdf-status').textContent = '❌ Could not load design: ' + e.message;
      _dsnStatusTone(document.getElementById('dsn-pdf-status'), 'err');
    }
  }

  designsRenderForm();
}

// ── Library ───────────────────────────────────
// A design may belong to multiple families. New designs store `families`
// (array); designs saved before multi-family support only have the legacy
// singular `family` string — normalize that into a one-item array on read.
function _dsnFamiliesOf(d) {
  if (Array.isArray(d.families)) return d.families.map(f => (f || '').trim()).filter(Boolean);
  const legacy = (d.family || '').trim();
  return legacy ? [legacy] : [];
}

// ── Folder tree (Design Families) ────────────────
// The tree is DERIVED, not stored: a design's folder path is its category
// followed by its collection — "Rings/Meditation Rings". Category is the
// top level because that's the one axis every design has.
//
// Collections here are mostly motifs (Dragonfly, Ginkgo, Snake) that each
// exist as a ring AND an earring AND a pendant, so prefixing them by
// category splits one collection into several folders of a single design.
// A collection therefore only earns a subfolder once DSN_SUBFOLDER_MIN
// designs share that exact category+collection pair; below that it
// dissolves and the design sits directly in its category. Meditation
// Rings, Stackable Rings and the charm designs clear the bar; the
// cross-category motifs don't, and would otherwise each strand a design
// inside a folder the anti-clutter rule hides.
//
// Nothing here writes to families[] — the motif tags stay on the records
// (and stay searchable), so this is reversible and a motif filter can be
// built on them later without a migration.
const DSN_SUBFOLDER_MIN = 2;

let _dsnPairCache = null; // "Category/Collection" -> design count, per render

// '/' is the path separator, so it cannot survive inside a single segment.
// The "Pendants / Necklaces" category would otherwise split into a phantom
// "Pendants" parent holding nothing, which the visibility rule then hides
// — stranding every design in that category with no way to reach it.
function _dsnSeg(name) {
  return (name || '').replace(/\s*\/\s*/g, ' & ').trim();
}

const DESIGNS_CAT_SEGS = DESIGNS_CATS.map(_dsnSeg);

function _dsnCategoryOf(d) {
  return _dsnSeg(d.category) || 'Other';
}

// Cleared at the top of every library render — see designsRenderLibrary.
function _dsnPairCounts() {
  if (_dsnPairCache) return _dsnPairCache;
  const counts = new Map();
  for (const d of _designs) {
    const cat = _dsnCategoryOf(d);
    for (const f of _dsnFamiliesOf(d)) {
      const key = `${cat}/${_dsnSeg(f)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  _dsnPairCache = counts;
  return counts;
}

// Where a design actually lives in the tree. Always at least its category.
function _dsnEffectiveFolders(d) {
  const cat = _dsnCategoryOf(d);
  const counts = _dsnPairCounts();
  const kept = _dsnFamiliesOf(d)
    .map(f => `${cat}/${_dsnSeg(f)}`)
    .filter(p => (counts.get(p) || 0) >= DSN_SUBFOLDER_MIN);
  return kept.length ? kept : [cat];
}

// Every path that should exist as a node: every ancestor segment of every
// design's effective path, every manually-created (possibly still-empty)
// folder, and all six categories so the top level is stable even when a
// category is empty.
function _dsnAllFolderPaths() {
  const paths = new Set(DESIGNS_CAT_SEGS);
  const addAncestors = (full) => {
    const parts = (full || '').split('/').map(p => p.trim()).filter(Boolean);
    let acc = '';
    for (const part of parts) { acc = acc ? `${acc}/${part}` : part; paths.add(acc); }
  };
  _designs.forEach(d => _dsnEffectiveFolders(d).forEach(addAncestors));
  _designsFolders.forEach(addAncestors);
  return paths;
}

// Direct child paths exactly one segment below parentPath (falsy = top level).
function _dsnFolderChildPaths(parentPath) {
  const depth  = parentPath ? parentPath.split('/').length + 1 : 1;
  const prefix = parentPath ? parentPath + '/' : '';
  return [..._dsnAllFolderPaths()]
    .filter(p => p.split('/').length === depth && (!parentPath || p.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));
}

// Designs sitting at this exact path (not a deeper subfolder).
function _dsnFolderDirectDesigns(path) {
  return _designs.filter(d => _dsnEffectiveFolders(d).includes(path));
}

// Designs at this path, or anywhere nested underneath it.
function _dsnFolderDescendantDesigns(path) {
  const prefix = path + '/';
  return _designs.filter(d => _dsnEffectiveFolders(d).some(f => f === path || f.startsWith(prefix)));
}

// A folder shows in the tree if it was explicitly created, has 2+ designs
// filed directly in it, or has visible content underneath it — the same
// "don't clutter the grid with a one-off family typo" rule the flat
// version used, extended so a deliberately-nested subfolder always
// surfaces its ancestors even when an ancestor holds nothing directly.
function _dsnVisibleFolderPaths() {
  const explicit = new Set(_designsFolders.map(f => f.trim()).filter(Boolean));
  const categories = new Set(DESIGNS_CAT_SEGS);
  const byDepthDesc = [..._dsnAllFolderPaths()].sort((a, b) => b.split('/').length - a.split('/').length);
  const visible = new Set();
  for (const path of byDepthDesc) {
    const directCount     = _dsnFolderDirectDesigns(path).length;
    const hasVisibleChild = _dsnFolderChildPaths(path).some(c => visible.has(c));
    // A category earns its row on a single design; a derived collection
    // folder needs two, so a one-off doesn't spawn a folder of its own.
    // An empty category shows nothing at all — a permanent row for a
    // category holding no designs is noise, and reads as a duplicate when
    // a same-named collection exists under another category.
    const min = categories.has(path) ? 1 : DSN_SUBFOLDER_MIN;
    if (explicit.has(path) || directCount >= min || hasVisibleChild) visible.add(path);
  }
  return visible;
}

// All search terms must hit somewhere on the design (AND across terms).
function _dsnMatchesSearch(d) {
  if (!_designsSearch) return true;
  const hay = [d.name, d.category, ..._dsnFamiliesOf(d), d.preview]
    .filter(Boolean).join(' ').toLowerCase();
  return _designsSearch.split(/\s+/).every(t => hay.includes(t));
}

// Every term must hit the folder's own path or one of its descendant designs' names.
function _dsnFolderMatchesSearch(path) {
  if (!_designsSearch) return true;
  const desc = _dsnFolderDescendantDesigns(path);
  const hay = [path, ...desc.map(m => m.name || '')].join(' ').toLowerCase();
  return _designsSearch.split(/\s+/).every(t => hay.includes(t));
}

function designsSetSearch(q) {
  _designsSearch = (q || '').trim().toLowerCase();
  const clr = document.getElementById('dsn-search-clear');
  if (clr) clr.style.display = _designsSearch ? '' : 'none';
  clearTimeout(_dsnSearchTimer);
  _dsnSearchTimer = setTimeout(designsRenderLibrary, 120);
}

function designsClearSearch() {
  const inp = document.getElementById('dsn-search');
  if (inp) inp.value = '';
  designsSetSearch('');
  if (inp) inp.focus();
}

function _dsnDesignCardHtml(d) {
  const thumb = d.thumb
    ? `<div class="dsn-card-thumb" style="background-image:url('${d.thumb}')"></div>`
    : `<div class="dsn-card-thumb dsn-card-thumb-empty"><span style="font-size:22px">💎</span></div>`;
  const imgCount = d.imgCount || 0;
  const imgBadge = imgCount > 1 ? `<span class="dsn-img-badge">+${imgCount - 1}</span>` : '';
  const cat     = d.category || 'Uncategorized';
  const preview = (d.preview || '').slice(0, 90).replace(/\n/g, ' ') || 'No details';
  const bomN    = Array.isArray(d.bom) ? d.bom.length : 0;
  const bomChip = bomN
    ? `<div class="dsn-cat-chip dsn-bom-chip weighed">⚖ ${bomN} material${bomN !== 1 ? 's' : ''}</div>`
    : `<div class="dsn-cat-chip dsn-bom-chip">⚖ Not weighed</div>`;
  return `
    <div class="dsn-card" onclick="designsShowGuide('${d.id}')">
      <div class="dsn-card-thumb-wrap">${thumb}${imgBadge}</div>
      <div class="dsn-card-body">
        <div class="dsn-cat-chip">${cat}</div>${bomChip}
        <div class="dsn-card-name">${escHtml(d.name || 'Untitled')}</div>
        <div class="dsn-card-preview">${escHtml(preview)}${preview.length >= 90 ? '…' : ''}</div>
      </div>
    </div>`;
}

function _dsnFolderCardHtml(path) {
  const desc = _dsnFolderDescendantDesigns(path);
  const thumbs = desc.filter(m => m.thumb).slice(0, 4).map(m => m.thumb);
  const collage = thumbs.length
    ? `<div class="dsn-family-collage${thumbs.length === 1 ? ' cols-1' : ''}">${thumbs.map(t => `<div style="background-image:url('${t}')"></div>`).join('')}</div>`
    : `<div class="dsn-card-thumb dsn-card-thumb-empty"><span style="font-size:22px">📁</span></div>`;
  const name = path.split('/').pop();
  // A folder can only be deleted if it holds nothing anywhere underneath it
  // — not just directly, since a subfolder with its own content shouldn't
  // vanish along with an empty-looking parent.
  const isEmpty = desc.length === 0 && !_dsnFolderChildPaths(path).length;
  const delBtn = isEmpty
    ? `<button type="button" class="dsn-family-del-btn" data-path="${escHtml(path)}" title="Delete empty folder"
         onclick="event.stopPropagation();dsnFolderDelete(this.dataset.path)">✕</button>`
    : '';
  const names = desc.map(m => m.name || 'Untitled').join(' · ');
  const preview = isEmpty
    ? 'Empty folder — add designs or a subfolder'
    : escHtml(names.slice(0, 90)) + (names.length > 90 ? '…' : '');
  return `
    <div class="dsn-card" data-path="${escHtml(path)}" onclick="designsOpenFamily(this.dataset.path)">
      <div class="dsn-card-thumb-wrap">${collage}<span class="dsn-img-badge">${desc.length} design${desc.length === 1 ? '' : 's'}</span>${delBtn}</div>
      <div class="dsn-card-body">
        <div class="dsn-cat-chip">📁 Folder</div>
        <div class="dsn-card-name">${escHtml(name)}</div>
        <div class="dsn-card-preview">${preview}</div>
      </div>
    </div>`;
}

// ── Desktop: folder rail ─────────────────────────
// The whole tree, always visible, so jumping from Ear Cuffs to Meditation
// Rings is one click instead of a walk back up through the breadcrumb.
// Counts are descendant designs — what actually lives under that node.

// Keep the open folder's ancestors expanded so the rail always shows where
// you are, however you got there (breadcrumb, folder card, or shelf).
function _dsnRailAutoExpand() {
  if (!_designsFamilyOpen) return;
  let acc = '';
  for (const part of _designsFamilyOpen.split('/')) {
    acc = acc ? `${acc}/${part}` : part;
    _dsnRailOpen.add(acc);
  }
}

function dsnRailToggle(path) {
  if (_dsnRailOpen.has(path)) _dsnRailOpen.delete(path);
  else _dsnRailOpen.add(path);
  _dsnRenderRail();
}

function _dsnRailNodeHtml(path, depth, visible) {
  const name     = path.split('/').pop();
  const hasKids  = _dsnFolderChildPaths(path).some(c => visible.has(c));
  const expanded = _dsnRailOpen.has(path);
  const active   = _designsFamilyOpen === path;
  const count    = _dsnFolderDescendantDesigns(path).length;
  const twisty = hasKids
    ? `<button type="button" class="dsn-rail-tw" data-path="${escHtml(path)}"
         aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escHtml(name)}"
         onclick="event.stopPropagation();dsnRailToggle(this.dataset.path)">${expanded ? '▾' : '▸'}</button>`
    : `<span class="dsn-rail-tw" aria-hidden="true"></span>`;
  return `
    <div class="dsn-rail-node${active ? ' active' : ''}" style="padding-left:${6 + depth * 13}px">
      ${twisty}
      <button type="button" class="dsn-rail-lbl" data-path="${escHtml(path)}"
              ${active ? 'aria-current="true"' : ''}
              onclick="designsOpenFamily(this.dataset.path)">${escHtml(name)}</button>
      <span class="dsn-rail-ct">${count}</span>
    </div>`;
}

function _dsnRenderRail() {
  const rail = document.getElementById('dsn-rail');
  if (!rail) return;
  if (_dsnIsNarrow()) { rail.innerHTML = ''; return; }

  _dsnRailAutoExpand();
  const visible = _dsnVisibleFolderPaths();
  const rows = [];
  const walk = (parent, depth) => {
    for (const path of _dsnFolderChildPaths(parent).filter(p => visible.has(p))) {
      rows.push(_dsnRailNodeHtml(path, depth, visible));
      if (_dsnRailOpen.has(path)) walk(path, depth + 1);
    }
  };
  walk(null, 0);

  const rootRow = `
    <div class="dsn-rail-node dsn-rail-root${!_designsFamilyOpen ? ' active' : ''}">
      <span class="dsn-rail-tw" aria-hidden="true"></span>
      <button type="button" class="dsn-rail-lbl" onclick="designsOpenFamily('')">📁 All families</button>
      <span class="dsn-rail-ct">${_designs.length}</span>
    </div>`;
  rail.innerHTML = rootRow + (rows.length
    ? rows.join('')
    : `<div class="dsn-rail-empty">No folders yet</div>`);
}

// ── Mobile: shelf view ───────────────────────────
// One horizontal row per collection down a single vertical scroll, so the
// whole library is reachable with a thumb and nothing is hidden behind a
// drill-in. A shelf is any visible folder that holds designs directly;
// nested ones title themselves with their full path.
const DSN_SHELF_MAX = 12; // cards per shelf before the "see all" tile

function _dsnShelfPaths() {
  return [..._dsnVisibleFolderPaths()]
    .filter(p => _dsnFolderDirectDesigns(p).length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function _dsnShelfHtml(path, designs) {
  const name  = path.split('/').pop();
  const trail = path.split('/').slice(0, -1).join(' › ');
  const shown = designs.slice(0, DSN_SHELF_MAX);
  const more  = designs.length - shown.length;
  const moreTile = more > 0
    ? `<button type="button" class="dsn-shelf-more" data-path="${escHtml(path)}"
         onclick="designsOpenFamily(this.dataset.path)">+${more}<span>more</span></button>`
    : '';
  return `
    <section class="dsn-shelf">
      <div class="dsn-shelf-head">
        <button type="button" class="dsn-shelf-title" data-path="${escHtml(path)}"
                onclick="designsOpenFamily(this.dataset.path)">
          ${trail ? `<span class="dsn-shelf-trail">${escHtml(trail)}</span>` : ''}
          <span class="dsn-shelf-leaf">${escHtml(name)}</span>
        </button>
        <span class="dsn-shelf-n">${designs.length}</span>
        <button type="button" class="dsn-shelf-all" data-path="${escHtml(path)}"
                onclick="designsOpenFamily(this.dataset.path)">See all →</button>
      </div>
      <div class="dsn-shelf-row">${shown.map(_dsnDesignCardHtml).join('')}${moreTile}</div>
    </section>`;
}

function _dsnRenderShelves() {
  const wrap = document.getElementById('dsn-shelves');
  if (!wrap) return;

  const shelves = [];
  for (const path of _dsnShelfPaths()) {
    let designs = _dsnFolderDirectDesigns(path);
    if (_designsCatFilter !== 'all') designs = designs.filter(d => d.category === _designsCatFilter);
    // _dsnMatchesSearch already searches families[], so a term matching the
    // folder path keeps that shelf's designs without a separate path check.
    if (_designsSearch) designs = designs.filter(_dsnMatchesSearch);
    if (designs.length) shelves.push(_dsnShelfHtml(path, designs));
  }

  // A folder holding nothing anywhere gets no shelf, at any depth — without
  // this it would be unreachable on a phone and you could never file into
  // it. Full paths, since the leaf name alone ("Signet") isn't enough.
  const emptyPaths = [..._dsnVisibleFolderPaths()]
    .filter(p => _dsnFolderDescendantDesigns(p).length === 0)
    .filter(p => !_designsSearch || _dsnFolderMatchesSearch(p))
    .sort((a, b) => a.localeCompare(b));

  const count = document.getElementById('dsn-family-count');
  if (count) count.textContent = shelves.length
    ? `${shelves.length} collection${shelves.length !== 1 ? 's' : ''}`
    : '';

  if (!shelves.length && !emptyPaths.length) {
    wrap.innerHTML = _designsSearch
      ? `<div class="dsn-shelf-empty">
           <div style="font-size:13px;margin-bottom:10px">Nothing here matches “${escHtml(_designsSearch)}”.</div>
           <button class="btn btn-outline btn-sm" onclick="designsClearSearch()">Clear search</button>
         </div>`
      : `<div class="dsn-shelf-empty">
           <div style="font-size:36px;margin-bottom:12px">📁</div>
           <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">No design families yet</div>
           <div style="font-size:12px">Tap <strong>📁 Add Folder</strong>, or give two or more designs<br>the same <strong>Design Family</strong> to group them here.</div>
         </div>`;
    return;
  }

  const emptySection = emptyPaths.length
    ? `<section class="dsn-shelf">
         <div class="dsn-shelf-head"><span class="dsn-shelf-title as-label">Empty folders</span></div>
         <div class="dsn-empty-folders">${emptyPaths.map(p => `
           <button type="button" class="dsn-empty-folder" data-path="${escHtml(p)}"
                   onclick="designsOpenFamily(this.dataset.path)">📁 ${escHtml(p)}</button>`).join('')}</div>
       </section>`
    : '';
  wrap.innerHTML = shelves.join('') + emptySection;
}

// Breadcrumb trail for the current folder path — every ancestor segment is
// clickable (jumps straight there), the current segment is plain text.
function _dsnBreadcrumbHtml() {
  if (!_designsFamilyOpen) return `<span class="dsn-crumb current">📁 Design Families</span>`;
  const root = `<button type="button" class="dsn-crumb" onclick="designsOpenFamily('')">📁 Design Families</button>`;
  const parts = _designsFamilyOpen.split('/');
  let acc = '';
  const trail = parts.map((part, i) => {
    acc = acc ? `${acc}/${part}` : part;
    const isLast = i === parts.length - 1;
    return isLast
      ? `<span class="dsn-crumb-sep">›</span><span class="dsn-crumb current">${escHtml(part)}</span>`
      : `<span class="dsn-crumb-sep">›</span><button type="button" class="dsn-crumb" data-path="${escHtml(acc)}" onclick="designsOpenFamily(this.dataset.path)">${escHtml(part)}</button>`;
  }).join('');
  return root + trail;
}

// Design Families tab — one folder level at a time: subfolders first, then
// any designs filed directly at this path. Root shows only folders (no
// loose designs) to match prior behavior; drill into a folder to see both
// its subfolders and its own designs, same as a file browser.
function _dsnRenderFolderLevel() {
  const grid = document.getElementById('dsn-family-grid');
  if (!grid) return;

  _dsnRenderRail();

  // Narrow + at the root is the one place the shelf view applies. Drilled
  // into a folder, both widths show the same level grid — the rail (or the
  // breadcrumb) is already telling you where you are.
  _dsnLastNarrow = _dsnIsNarrow();
  const shelfMode = _dsnLastNarrow && !_designsFamilyOpen;
  const shelves = document.getElementById('dsn-shelves');
  if (shelves) shelves.style.display = shelfMode ? '' : 'none';
  grid.style.display = shelfMode ? 'none' : '';
  if (shelfMode) { _dsnRenderShelves(); return; }

  const path = _designsFamilyOpen; // null = root
  const visible = _dsnVisibleFolderPaths();
  let childPaths = _dsnFolderChildPaths(path).filter(p => visible.has(p));
  let directDesigns = path ? _dsnFolderDirectDesigns(path) : [];
  if (path && _designsCatFilter !== 'all') directDesigns = directDesigns.filter(d => d.category === _designsCatFilter);

  if (_designsSearch) {
    childPaths = childPaths.filter(_dsnFolderMatchesSearch);
    directDesigns = directDesigns.filter(_dsnMatchesSearch);
  }

  const count = document.getElementById('dsn-family-count');
  if (count) {
    const parts = [];
    if (childPaths.length) parts.push(`${childPaths.length} folder${childPaths.length !== 1 ? 's' : ''}`);
    if (directDesigns.length) parts.push(`${directDesigns.length} design${directDesigns.length !== 1 ? 's' : ''}`);
    count.textContent = parts.join(', ');
  }

  if (!childPaths.length && !directDesigns.length) {
    if (_designsSearch) {
      grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:13px;margin-bottom:10px">Nothing here matches “${escHtml(_designsSearch)}”.</div>
        <button class="btn btn-outline btn-sm" onclick="designsClearSearch()">Clear search</button>
      </div>`;
    } else if (!path) {
      grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📁</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">No design families yet</div>
        <div style="font-size:12px">Click <strong>📁 Add Folder</strong>, or give two or more designs<br>the same <strong>Design Family</strong> to group them here.</div>
      </div>`;
    } else {
      grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📁</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">This folder is empty</div>
        <div style="font-size:12px">Open a design and set its <strong>Design Family</strong> to<br>“${escHtml(path)}”, or add a subfolder here.</div>
      </div>`;
    }
    return;
  }

  grid.innerHTML = childPaths.map(_dsnFolderCardHtml).join('') + directDesigns.map(_dsnDesignCardHtml).join('');
}

function designsSetSubTab(tab) {
  _designsSubTab = (tab === 'all' || tab === 'stackable') ? tab : 'families';
  _designsFamilyOpen = null;
  document.querySelectorAll('.dsn-subtab').forEach(b => {
    const on = b.dataset.subtab === _designsSubTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  designsRenderLibrary();
}

function designsRenderLibrary() {
  const list = document.getElementById('designs-list');
  if (!list) return;

  // The derived tree reads category+collection counts many times per render;
  // compute them once here and let every helper below share the result.
  _dsnPairCache = null;

  // The library is the folder browser now — the All Designs / Stackable
  // Rings sub-tabs and the flat category chip row are gone, since category
  // is the top level of the tree itself.
  _designsSubTab = 'families';

  // Drop the drill-in if the folder no longer exists (rename / delete). A
  // manually-created folder with nothing in it yet still "exists" as long
  // as it's a known path (explicit, or an ancestor of a design/folder) —
  // don't kick the user out of an empty one.
  if (_designsFamilyOpen && !_dsnAllFolderPaths().has(_designsFamilyOpen)) {
    _designsFamilyOpen = null;
  }

  const isFolderBrowser = _designsSubTab === 'families';

  const crumbBack = document.getElementById('dsn-crumb-back');
  if (crumbBack) crumbBack.style.display = _designsFamilyOpen ? '' : 'none';
  const compareBtn = document.getElementById('dsn-compare-costs-btn');
  if (compareBtn) compareBtn.style.display = _designsFamilyOpen ? '' : 'none';
  const crumb = document.getElementById('dsn-breadcrumb');
  if (crumb) crumb.innerHTML = _dsnBreadcrumbHtml();

  const subtabs = document.getElementById('dsn-subtabs');
  if (subtabs) subtabs.style.display = _designsFamilyOpen ? 'none' : '';
  const catBar = document.getElementById('dsn-filter-bar');
  // Stackable Rings is a single-collection view — the category filter is
  // redundant there. At Families-root there's nothing to filter yet either.
  if (catBar) catBar.style.display = ((isFolderBrowser && !_designsFamilyOpen) || _designsSubTab === 'stackable') ? 'none' : '';
  const famWrap = document.getElementById('dsn-family-grid-wrap');
  if (famWrap) famWrap.style.display = isFolderBrowser ? '' : 'none';
  list.style.display = isFolderBrowser ? 'none' : '';

  const search = document.getElementById('dsn-search');
  if (search) {
    search.placeholder = isFolderBrowser
      ? 'Search folders and designs…'
      : 'Search designs — name, collection, category, or details…';
  }

  if (isFolderBrowser) { _dsnRenderFolderLevel(); return; }

  let filtered = _designs;
  if (_designsSubTab === 'stackable') {
    filtered = filtered.filter(d => _dsnFamiliesOf(d).includes(DSN_STACK_FAMILY));
  } else if (_designsCatFilter !== 'all') {
    filtered = filtered.filter(d => d.category === _designsCatFilter);
  }
  if (_designsSearch) filtered = filtered.filter(_dsnMatchesSearch);

  if (filtered.length === 0) {
    if (_designs.length === 0) {
      list.innerHTML = `
      <div style="text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">No designs yet</div>
        <div style="font-size:12px">Click <strong>+ New Design</strong> to add your first one,<br>or upload a PDF to get started.</div>
      </div>`;
    } else if (_designsSearch) {
      list.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:52px 32px;color:var(--text3)">
        <div style="font-size:13px;margin-bottom:10px">No designs match “${escHtml(_designsSearch)}”.</div>
        <button class="btn btn-outline btn-sm" onclick="designsClearSearch()">Clear search</button>
      </div>`;
    } else {
      list.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:52px 32px;color:var(--text3);font-size:13px">No designs match this view.</div>`;
    }
    return;
  }

  list.innerHTML = filtered.map(_dsnDesignCardHtml).join('');
}

// Opens any path directly — a folder card's child path, or a breadcrumb's
// ancestor path. Pass '' (or nothing) to jump back to the root.
function designsOpenFamily(fam) {
  _designsFamilyOpen = fam || null;
  designsRenderLibrary();
}

// "← Back" — one level up, not all the way to root (breadcrumb segments
// handle jumping further back). Hidden at Families-root, see the
// crumbBack toggle in designsRenderLibrary.
function designsCloseFamily() {
  if (!_designsFamilyOpen) return;
  const parts = _designsFamilyOpen.split('/');
  parts.pop();
  designsOpenFamily(parts.join('/'));
}
// Existing family names → datalist so the form autocompletes and
// spelling stays consistent across a family's members.
function _dsnFamilyDatalistRefresh() {
  const dl = document.getElementById('dsn-family-list');
  if (!dl) return;
  const fams = [...new Set([...(_designs.flatMap(_dsnFamiliesOf)), ..._designsFolders])].sort((a, b) => a.localeCompare(b));
  dl.innerHTML = fams.map(f => `<option value="${escHtml(f)}"></option>`).join('');
}

// ── Design Families chip picker (form) ──────────
let _designsFormFamilies = [];

function _dsnFamilyChipsRender() {
  const list = document.getElementById('dsn-family-chip-list');
  if (!list) return;
  list.innerHTML = _designsFormFamilies.map((f, i) =>
    `<span class="dsn-family-chip">${escHtml(f)}<button type="button" onclick="event.stopPropagation();dsnFamilyRemove(${i})" aria-label="Remove ${escHtml(f)}">×</button></span>`
  ).join('');
}

function dsnFamilyAdd(raw) {
  const name = (raw || '').trim();
  const inp = document.getElementById('dsn-family-input');
  if (inp) inp.value = '';
  if (!name) return;
  if (!_designsFormFamilies.some(f => f.toLowerCase() === name.toLowerCase())) {
    _designsFormFamilies.push(name);
    _dsnFamilyChipsRender();
  }
}

function dsnFamilyRemove(idx) {
  _designsFormFamilies.splice(idx, 1);
  _dsnFamilyChipsRender();
}

// Flushes whatever's still typed (but not yet committed as a chip) into the
// family list — called before save so an un-Entered value isn't lost.
function _dsnFamilySyncFromInput() {
  const inp = document.getElementById('dsn-family-input');
  if (inp && inp.value.trim()) dsnFamilyAdd(inp.value);
}

function dsnFamilyInputKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    dsnFamilyAdd(e.target.value);
  } else if (e.key === 'Backspace' && !e.target.value && _designsFormFamilies.length) {
    dsnFamilyRemove(_designsFormFamilies.length - 1);
  }
}

function dsnFamilyChipsClick() {
  const inp = document.getElementById('dsn-family-input');
  if (inp) inp.focus();
}

function designsSetCatFilter(cat) {
  _designsCatFilter = cat;
  document.querySelectorAll('.dsn-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  designsRenderLibrary();
}

// ── Folders (Design Families, nested) ────────────
// Typing a name containing '/' creates the whole chain in one step;
// otherwise the new folder is filed under whichever folder is currently
// open (so "Add Folder" always creates relative to where you're standing,
// same as a file browser's "New Folder").
async function dsnFolderCreate() {
  const parent = _designsSubTab === 'families' ? _designsFamilyOpen : null;
  const raw = (prompt(parent
    ? `New folder inside "${parent}":`
    : 'New top-level folder name (type "Parent/Child" to nest it in one step):') || '').trim();
  if (!raw) return;

  const fullPath = (parent ? `${parent}/${raw}` : raw)
    .split('/').map(p => p.trim()).filter(Boolean).join('/');
  if (!fullPath) return;
  if (fullPath.length > 120) { alert('Folder path is too long (max 120 characters).'); return; }

  const existing = new Set([..._dsnAllFolderPaths()].map(p => p.toLowerCase()));
  if (existing.has(fullPath.toLowerCase())) { alert(`"${fullPath}" already exists.`); return; }

  try {
    const resp = await fetch('/api/designs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: fullPath }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Save failed (${resp.status})`);
    }
  } catch (e) {
    alert('Could not create folder: ' + e.message);
    return;
  }

  if (!_designsFolders.some(f => f.toLowerCase() === fullPath.toLowerCase())) _designsFolders.push(fullPath);

  // Land back where the folder was created (not all the way at root) —
  // designsSetSubTab() would reset _designsFamilyOpen, so switch tabs
  // manually and then open the parent path.
  _designsSubTab = 'families';
  document.querySelectorAll('.dsn-subtab').forEach(b => {
    const on = b.dataset.subtab === 'families';
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  designsOpenFamily(parent || '');
}

async function dsnFolderDelete(path) {
  if (!path) return;
  const hasContent = _dsnFolderDescendantDesigns(path).length > 0 || _dsnFolderChildPaths(path).length > 0;
  if (hasContent) { alert('This folder still has designs or subfolders in it — empty it first.'); return; }
  if (!confirm(`Delete empty folder "${path.split('/').pop()}"?`)) return;

  try {
    const resp = await fetch(`/api/designs?folder=${encodeURIComponent(path)}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`Delete failed (${resp.status})`);
  } catch (e) {
    alert('Could not delete folder: ' + e.message);
    return;
  }

  _designsFolders = _designsFolders.filter(f => f.toLowerCase() !== path.toLowerCase());
  designsRenderLibrary();
}

// ════════════════════════════════════════════
//  GUIDE VIEW — read-only formatted Design Guide
//  Library card click lands here; ✎ Edit opens the form.
//  Prints to 8.5×11 letter via window.print() — BOM and
//  costing carry .dsn-no-print and never reach paper.
// ════════════════════════════════════════════

let _dsnGuideCostOpen = false;
let _dsnGuideVarOpen  = false;

async function designsShowGuide(id) {
  if (!id) return;
  _designsView   = 'guide';
  _designsEditId = id;
  _designsCurrentFull = null;
  _dsnGuideCostOpen   = false;
  _dsnGuideVarOpen    = false;
  _designsPricingOpen = false;
  const pricing = document.getElementById('designs-pricing');
  if (pricing) pricing.style.display = 'none';
  const priceBtn = document.getElementById('dsn-pricing-btn');
  if (priceBtn) priceBtn.style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = 'none';
  const folderBtn = document.getElementById('dsn-folder-btn');
  if (folderBtn) folderBtn.style.display = 'none';
  document.getElementById('designs-library').style.display    = 'none';
  document.getElementById('designs-form-wrap').style.display  = 'none';
  document.getElementById('designs-guide-wrap').style.display = '';

  const page = document.getElementById('dsn-guide-page');
  if (page) page.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Loading design…</div>';

  try {
    _designsCurrentFull = await _designsApiFetch(id);
  } catch(e) {
    if (page) page.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">❌ Could not load design — ${escHtml(e.message || String(e))}</div>`;
    return;
  }
  if (_designsView !== 'guide' || _designsEditId !== id) return; // navigated away mid-fetch
  designsRenderGuide();
  _dsnLoadLabor().then(_dsnGuideCostRender);
  if (_designsCurrentFull.squareItemId) _dsnLoadSqPrices([_designsCurrentFull.squareItemId]).then(_dsnGuideCostRender);
  _dsnGuideVarRender();
}

function designsRenderGuide() {
  const page = document.getElementById('dsn-guide-page');
  if (!page) return;
  const d = _designsCurrentFull;
  if (!d) {
    page.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text3);font-size:13px">Could not load this design.</div>';
    return;
  }
  const imgs = d.images || [];
  const hero = imgs.length
    ? `<img class="dsn-gd-hero" src="${imgs[0]}" alt="${escHtml(d.name || 'Design')}" onclick="dsnGuideViewImage(0)">`
    : '';
  const thumbs = imgs.length > 1
    ? `<div class="dsn-gd-thumbs">${imgs.slice(1).map((s, i) =>
        `<img src="${s}" class="dsn-gd-thumb" alt="Reference ${i + 2}" onclick="dsnGuideViewImage(${i + 1})">`).join('')}</div>`
    : '';
  const upd = d.updatedAt
    ? new Date(d.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  page.innerHTML = `
    <header class="dsn-gd-head">
      <div class="dsn-gd-headtext">
        ${d.category ? `<div class="dsn-cat-chip">${escHtml(d.category)}</div>` : ''}${_dsnFamiliesOf(d).map(f => ` <div class="dsn-cat-chip">📁 ${escHtml(f)}</div>`).join('')}
        <h1 class="dsn-gd-title">${escHtml(d.name || 'Untitled')}</h1>
        <div class="dsn-gd-meta">Stones Throw Studio · Design Guide${upd ? ' · Updated ' + upd : ''}</div>
      </div>
      ${hero}
    </header>
    ${thumbs}
    ${d.specs ? `<section class="dsn-gd-sec"><h2 class="dsn-gd-h2">Specifications</h2>${_dsnGuideParseText(d.specs)}</section>` : ''}
    <section class="dsn-gd-sec dsn-no-print" id="dsn-guide-bom-sec" style="display:none">
      <h2 class="dsn-gd-h2">Materials per piece</h2>
      <div id="dsn-guide-bom-body"></div>
    </section>
    ${d.instructions
      ? `<section class="dsn-gd-sec"><h2 class="dsn-gd-h2">Instructions</h2>${_dsnGuideParseText(d.instructions)}</section>`
      : '<section class="dsn-gd-sec"><h2 class="dsn-gd-h2">Instructions</h2><p class="dsn-gd-p" style="color:var(--text3)">No instructions yet — open ✎ Edit to add them.</p></section>'}
    <div id="dsn-guide-cost" class="dsn-no-print"></div>
    <div id="dsn-guide-var" class="dsn-no-print"></div>`;

  _dsnGuideBomRender();
  _dsnGuideCostRender();
  _dsnGuideVarRender();
}

// Light formatter: numbered lines ("1." / "Step 1:") become badged steps,
// dash/star lines become bullets, short ALL-CAPS or colon-ended lines become
// subheads, everything else a paragraph. A dash line INDENTED with spaces
// attaches to the step or bullet above it as an indented dash sub-line, or
// stands alone as a dash line when there is no step/bullet above it.
// Misparses degrade to plain text.
function _dsnGuideParseText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null; // { type:'steps'|'bullets', items:[] }
  const subHtml = subs => subs.map(s =>
    `<div class="dsn-gd-substep"><span class="dsn-gd-dash">–</span><span>${s}</span></div>`).join('');
  const flush = () => {
    if (!list) return;
    if (list.type === 'steps') {
      out.push('<div class="dsn-gd-steps">' + list.items.map(it =>
        `<div class="dsn-gd-step"><span class="dsn-gd-stepnum">${it.n}</span><div class="dsn-gd-steptext">${it.html}${subHtml(it.subs)}</div></div>`).join('') + '</div>');
    } else {
      out.push('<ul class="dsn-gd-bullets">' + list.items.map(it => `<li>${it.html}${subHtml(it.subs)}</li>`).join('') + '</ul>');
    }
    list = null;
  };
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    // Indented dash line → sub-item of the step/bullet above it, or a
    // standalone dash line when there's nothing to attach to
    if (/^[ \t]/.test(raw)) {
      const sm = line.match(/^[-•*·—–]\s+(.*)/);
      if (sm) {
        if (list && list.items.length) {
          list.items[list.items.length - 1].subs.push(escHtml(sm[1]));
        } else {
          flush();
          out.push(subHtml([escHtml(sm[1])]));
        }
        return;
      }
    }
    let m = line.match(/^(?:step\s*)?(\d{1,3})[.):]\s+(.*)/i);
    if (m) {
      if (!list || list.type !== 'steps') { flush(); list = { type: 'steps', items: [] }; }
      list.items.push({ n: m[1], html: escHtml(m[2]), subs: [] });
      return;
    }
    m = line.match(/^[-•*·]\s+(.*)/);
    if (m) {
      if (!list || list.type !== 'bullets') { flush(); list = { type: 'bullets', items: [] }; }
      list.items.push({ html: escHtml(m[1]), subs: [] });
      return;
    }
    flush();
    const isHead = line.length <= 42
      && (/:$/.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line)));
    out.push(isHead
      ? `<h3 class="dsn-gd-subhead">${escHtml(line.replace(/:$/, ''))}</h3>`
      : `<p class="dsn-gd-p">${escHtml(line)}</p>`);
  });
  flush();
  return out.join('');
}

// "What you need" list — quantities + waste-inclusive cut lengths, no prices
// (prices live in the costing strip). Hidden entirely when the BOM is empty.
function _dsnGuideBomRender() {
  const sec  = document.getElementById('dsn-guide-bom-sec');
  const body = document.getElementById('dsn-guide-bom-body');
  if (!sec || !body || _designsView !== 'guide' || !_designsCurrentFull) return;
  const d   = _designsCurrentFull;
  const bom = d.bom || [];
  if (!bom.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  if (_designsMaterials === null) {
    body.innerHTML = '<div class="dsn-bom-note">Loading materials…</div>';
    return;
  }
  body.innerHTML = '<ul class="dsn-gd-matlist">' + bom.map(l => {
    const m = _dsnBomMat(l.materialId);
    if (!m) return '<li><span class="dsn-gd-matname" style="color:var(--text3)">Unknown material</span></li>';
    const unit = _dsnUnitSuffix(m);
    let qty = `${l.qty} ${unit}`;
    if (m.category === 'metal') {
      const w = _dsnWastePctResolve(m, d.wasteOverridePct != null ? d.wasteOverridePct : null);
      if (w > 0) qty += ` <span class="dsn-ru-dim">cut ${(l.qty * (1 + w / 100)).toFixed(2)} ${unit} incl. ${w}% waste</span>`;
    }
    return `<li><span class="dsn-gd-matname">${escHtml(m.name || 'Untitled')}</span><span class="dsn-gd-matqty">${qty}</span></li>`;
  }).join('') + '</ul>';
}

// Collapsed one-line costing strip at the foot of the guide
function dsnGuideCostToggle() {
  _dsnGuideCostOpen = !_dsnGuideCostOpen;
  _dsnGuideCostRender();
}

function _dsnGuideCostRender() {
  const el = document.getElementById('dsn-guide-cost');
  if (!el || _designsView !== 'guide' || !_designsCurrentFull) return;
  if (_designsMaterials === null) {
    el.innerHTML = '<div class="dsn-guide-cost-bar static"><span>💲 Costing</span><span class="dsn-ru-dim">loading…</span></div>';
    return;
  }
  const r = dsnCostRollup(_designsCurrentFull);
  const empty = !r.hasBom && r.laborCost == null;
  const summary = empty
    ? '<span class="dsn-ru-dim">not yet weighed — add materials in ✎ Edit</span>'
    : `Cost ${_dsnMoney(r.pieceCost)} · Retail ${_dsnMoney(r.retail)} · Margin ${r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—'}`;
  if (empty) {
    el.innerHTML = `<div class="dsn-guide-cost-bar static"><span>💲 Costing</span><span>${summary}</span></div>`;
    return;
  }
  el.innerHTML =
    `<button type="button" class="dsn-guide-cost-bar${_dsnGuideCostOpen ? ' open' : ''}" onclick="dsnGuideCostToggle()">
      <span>💲 Costing</span><span>${summary}</span><span class="dsn-gd-chev">${_dsnGuideCostOpen ? '▾' : '▸'}</span>
    </button>`
    + (_dsnGuideCostOpen ? `<div class="dsn-guide-cost-detail">${_dsnRollupBoxHtml(r)}</div>` : '');
}

// Collapsed one-line variations strip at the foot of the guide, below Costing
function dsnGuideVarToggle() {
  _dsnGuideVarOpen = !_dsnGuideVarOpen;
  _dsnGuideVarRender();
}

function _dsnGuideVarRender() {
  const el = document.getElementById('dsn-guide-var');
  if (!el || _designsView !== 'guide' || !_designsCurrentFull) return;
  const variants = _designsCurrentFull.variants || [];
  if (!variants.length) {
    el.innerHTML = '<div class="dsn-guide-cost-bar static"><span>📐 Variations</span><span class="dsn-ru-dim">none yet — add in ✎ Edit</span></div>';
    return;
  }
  if (_designsMaterials === null) {
    el.innerHTML = '<div class="dsn-guide-cost-bar static"><span>📐 Variations</span><span class="dsn-ru-dim">loading…</span></div>';
    return;
  }
  const sqIds = variants.map(v => v.squareItemId).filter(Boolean);
  const sqNewIds = sqIds.filter(id => !_dsnSqFetchAttempted.has(id));
  if (sqNewIds.length) {
    sqNewIds.forEach(id => _dsnSqFetchAttempted.add(id));
    _dsnLoadSqPrices(sqIds).then(_dsnGuideVarRender);
  }
  const summary = `${variants.length} variation${variants.length === 1 ? '' : 's'}`;
  const rows = variants.map(v => {
    const r = dsnCostRollup(v);
    const stats = [
      `Piece ${_dsnMoney(r.pieceCost)}`,
      `Retail ${_dsnMoney(r.retail)}`,
      `Margin ${r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—'}`,
    ].join(' · ');
    return `<div class="dsn-var-row">
      <div class="dsn-var-row-main">
        <div class="dsn-var-row-label">${escHtml(v.label || 'Untitled variation')}</div>
        <div class="dsn-var-row-stats">${stats}</div>
      </div>
    </div>`;
  }).join('');
  el.innerHTML =
    `<button type="button" class="dsn-guide-cost-bar${_dsnGuideVarOpen ? ' open' : ''}" onclick="dsnGuideVarToggle()">
      <span>📐 Variations</span><span>${summary}</span><span class="dsn-gd-chev">${_dsnGuideVarOpen ? '▾' : '▸'}</span>
    </button>`
    + (_dsnGuideVarOpen ? `<div class="dsn-guide-cost-detail">${rows}</div>` : '');
}

// Re-render guide modules when background costing data lands (no-op elsewhere)
function _dsnGuideRefresh() {
  if (_designsView !== 'guide') return;
  _dsnGuideBomRender();
  _dsnGuideCostRender();
  _dsnGuideVarRender();
}

// Lightbox over the guide's own image set
function dsnGuideViewImage(idx) {
  const src = ((_designsCurrentFull && _designsCurrentFull.images) || [])[idx];
  if (!src) return;
  document.getElementById('dsn-img-overlay-img').src = src;
  document.getElementById('dsn-img-overlay').style.display = 'flex';
}

function dsnGuidePrint() { window.print(); }

// Scope print styling to the guide — Ctrl+P works too, and other tabs
// printing this document are untouched because the class never lands.
window.addEventListener('beforeprint', () => {
  if (_designsView === 'guide') document.body.classList.add('dsn-printing');
});
window.addEventListener('afterprint', () => document.body.classList.remove('dsn-printing'));

// ── Form ──────────────────────────────────────
function designsRenderForm() {
  const design = _designsCurrentFull;
  const isEdit = !!design;

  document.getElementById('dsn-name').value         = design ? (design.name         || '') : '';
  document.getElementById('dsn-cat').value           = design ? (design.category     || '') : '';
  // New designs started from inside a family drill-in inherit that family
  _designsFormFamilies = design ? _dsnFamiliesOf(design) : (_designsFamilyOpen ? [_designsFamilyOpen] : []);
  const famInput = document.getElementById('dsn-family-input');
  if (famInput) famInput.value = '';
  _dsnFamilyChipsRender();
  _dsnFamilyDatalistRefresh();
  document.getElementById('dsn-specs').value         = design ? (design.specs        || '') : '';
  document.getElementById('dsn-instructions').value  = design ? (design.instructions || '') : '';

  _designsBom = (design && Array.isArray(design.bom))
    ? design.bom.map(l => ({ materialId: l.materialId, qty: l.qty, pct: l.pct != null ? l.pct : null }))
    : [];
  const splitOn = !!(design && (design.bomTotalWeightOzt != null || design.bomTotalWeightG != null));
  const splitEl = document.getElementById('dsn-bom-split');
  const totalEl = document.getElementById('dsn-bom-total');
  const totWrap = document.getElementById('dsn-bom-total-wrap');
  if (splitEl) splitEl.checked = splitOn;
  if (totalEl) totalEl.value = !splitOn ? ''
    : (design.bomTotalWeightOzt != null
        ? design.bomTotalWeightOzt
        : Math.round(design.bomTotalWeightG / _DSN_G_PER_OZT * 1000) / 1000); // legacy grams total
  if (totWrap) totWrap.style.display = splitOn ? '' : 'none';
  const wasteEl = document.getElementById('dsn-waste');
  if (wasteEl) wasteEl.value = (design && design.wasteOverridePct != null) ? design.wasteOverridePct : '';

  _dsnLinkedSq = (design && design.squareItemId)
    ? { id: design.squareItemId, name: design.squareItemName || design.squareItemId }
    : null;
  const retailOv = document.getElementById('dsn-retail-ov');
  if (retailOv) retailOv.value = (design && design.retailPriceOverride != null) ? design.retailPriceOverride : '';
  const laborOv = document.getElementById('dsn-labor-ov');
  if (laborOv) laborOv.value = (design && design.laborMinPerPieceOverride != null) ? design.laborMinPerPieceOverride : '';
  dsnSqLinkRender();
  _dsnLoadLabor().then(dsnRollupRender);
  if (_dsnLinkedSq) _dsnLoadSqPrices([_dsnLinkedSq.id]).then(dsnRollupRender);

  _designsBomRender();
  _dsnVariantsInit(design);

  _designsImgQueue = design ? [...(design.images || [])] : [];
  designsRenderImagePreviews();
  _designsAttachQueue = design ? [...(design.attachments || [])] : [];
  designsRenderAttachments();

  const delBtn = document.getElementById('dsn-delete-btn');
  if (delBtn) delBtn.style.display = isEdit ? '' : 'none';
  const copyBtn = document.getElementById('dsn-copy-btn');
  if (copyBtn) copyBtn.style.display = isEdit ? '' : 'none';

  const st = document.getElementById('dsn-pdf-status');
  if (st && !st.textContent.startsWith('❌')) st.textContent = '';
  designsRefreshApiKeyUI();

  setTimeout(dsnAutoResizeAll, 0);
}

function designsRenderImagePreviews() {
  const wrap = document.getElementById('dsn-img-previews');
  if (!wrap) return;
  if (_designsImgQueue.length === 0) {
    wrap.className = 'dsn-img-col';
    wrap.innerHTML = '<span style="color:var(--text3);font-size:12px">No images yet</span>';
    return;
  }
  wrap.className = 'dsn-img-col' + (_designsImgEditMode ? ' edit-mode' : '');
  wrap.innerHTML = _designsImgQueue.map((src, i) => `
    <div class="dsn-thumb-wrap">
      <img src="${src}" class="dsn-thumb" alt="Design image ${i+1}" onclick="designsViewImage(${i})">
      <button class="dsn-thumb-del" onclick="designsRemoveImage(${i})" title="Remove image">×</button>
    </div>`).join('');
}

function designsToggleImageEdit() {
  _designsImgEditMode = !_designsImgEditMode;
  const btn = document.getElementById('dsn-img-edit-btn');
  if (btn) {
    btn.textContent = _designsImgEditMode ? '✓ Done Managing' : '🖼 Manage Images';
    btn.classList.toggle('active', _designsImgEditMode);
  }
  const wrap = document.getElementById('dsn-img-previews');
  if (wrap && _designsImgQueue.length > 0) {
    wrap.classList.toggle('edit-mode', _designsImgEditMode);
  }
  const addRow = document.getElementById('dsn-img-add-row');
  if (addRow) addRow.style.display = _designsImgEditMode ? '' : 'none';
}

function designsRemoveImage(idx) {
  _designsImgQueue.splice(idx, 1);
  designsRenderImagePreviews();
}

function designsViewImage(idx) {
  const src = _designsImgQueue[idx];
  if (!src) return;
  document.getElementById('dsn-img-overlay-img').src = src;
  document.getElementById('dsn-img-overlay').style.display = 'flex';
}

function designsCloseImageOverlay() {
  document.getElementById('dsn-img-overlay').style.display = 'none';
  document.getElementById('dsn-img-overlay-img').src = '';
}

// ── File attachments (Illustrator files, PDFs, etc. — stored in R2) ──
function _dsnAttachFmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function designsRenderAttachments() {
  const wrap = document.getElementById('dsn-attach-list');
  if (!wrap) return;
  if (_designsAttachQueue.length === 0) {
    wrap.innerHTML = '<span style="color:var(--text3);font-size:12px">No files yet</span>';
    return;
  }
  wrap.innerHTML = _designsAttachQueue.map((f, i) => `
    <div class="dsn-attach-row">
      <a href="/api/design-files?key=${encodeURIComponent(f.key)}" target="_blank" rel="noopener" class="dsn-attach-name">📎 ${escHtml(f.name)}</a>
      <span class="dsn-attach-size">${_dsnAttachFmtSize(f.size)}</span>
      <button type="button" class="dsn-attach-del" onclick="designsRemoveAttachment(${i})" title="Remove file">×</button>
    </div>`).join('');
}

async function designsAttachFile(file) {
  if (!file) return;
  if (!_designsEditId) _designsEditId = 'dsn-' + Date.now();

  const key = `designs/${_designsEditId}/${Date.now()}-${file.name}`;
  try {
    const resp = await fetch(`/api/design-files?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!resp.ok) throw new Error(`Upload failed (${resp.status})`);
    _designsAttachQueue.push({ key, name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' });
    designsRenderAttachments();
    toast('File attached', '📎');
  } catch (e) {
    toast('Attach failed — ' + (e.message || e), '❌');
  }
}

async function designsRemoveAttachment(idx) {
  const f = _designsAttachQueue[idx];
  if (!f) return;
  if (!confirm(`Remove "${f.name}"?`)) return;
  try {
    await fetch(`/api/design-files?key=${encodeURIComponent(f.key)}`, { method: 'DELETE' });
  } catch (e) { /* best-effort — still drop it from the design */ }
  _designsAttachQueue.splice(idx, 1);
  designsRenderAttachments();
}

// ── Save / Delete ─────────────────────────────
async function designsSaveDesign() {
  const name = document.getElementById('dsn-name').value.trim();
  if (!name) { toast('Please enter a design name', '⚠'); return; }

  const now = new Date().toISOString();
  const id  = _designsEditId || ('dsn-' + Date.now());

  dsnBomSyncFromDom();
  _dsnFamilySyncFromInput();
  const splitOn     = _dsnBomSplitOn();
  const splitTotalG = _dsnBomTotalG();
  if (splitOn && splitTotalG == null && _designsBom.some(l => l.materialId && l.pct > 0)) {
    toast('Enter the total piece weight for the % split', '⚠'); return;
  }
  const wasteRaw = (document.getElementById('dsn-waste') || {}).value;
  const design = {
    ...((_designsEditId && _designsCurrentFull) ? _designsCurrentFull : {}),
    id,
    name,
    category:     document.getElementById('dsn-cat').value,
    families:     [..._designsFormFamilies],
    specs:        document.getElementById('dsn-specs').value.trim(),
    instructions: document.getElementById('dsn-instructions').value.trim(),
    bom:          _designsBom
                    .filter(l => l.materialId && l.qty > 0)
                    .map(l => (splitOn && l.pct > 0)
                      ? { materialId: l.materialId, qty: l.qty, pct: l.pct }
                      : { materialId: l.materialId, qty: l.qty }),
    bomTotalWeightOzt: splitOn ? _dsnBomTotalOzt() : null,
    bomTotalWeightG:   splitOn ? splitTotalG : null,
    wasteOverridePct: (wasteRaw === '' || wasteRaw == null) ? null : parseFloat(wasteRaw),
    squareItemId:   _dsnLinkedSq ? _dsnLinkedSq.id   : null,
    squareItemName: _dsnLinkedSq ? _dsnLinkedSq.name : null,
    retailPriceOverride:      _dsnNumOrNull((document.getElementById('dsn-retail-ov') || {}).value),
    laborMinPerPieceOverride: _dsnNumOrNull((document.getElementById('dsn-labor-ov')  || {}).value),
    variants:     _dsnVariants,
    images:       [..._designsImgQueue],
    attachments:  [..._designsAttachQueue],
    createdAt:    (_designsCurrentFull && _designsCurrentFull.createdAt) ? _designsCurrentFull.createdAt : now,
    updatedAt:    now,
    thumb:        _designsImgQueue.length
                    ? await _designsMakeThumb(_designsImgQueue[0])
                    : null,
  };

  try {
    await _designsApiSave(design);
    toast(_designsEditId ? 'Design updated' : 'Design saved', '✓');
    await designsLoad();
    designsShowLibrary();
  } catch(e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

async function designsCopyDesign() {
  if (!_designsEditId) return;
  designsCloseGearMenu();
  try {
    // Copy the saved version from KV so images, BOM, and overrides all carry over
    const src = _designsCurrentFull || await _designsApiFetch(_designsEditId);
    const now = new Date().toISOString();
    const copy = {
      ...src,
      id: 'dsn-' + Date.now(),
      name: (src.name || 'Untitled') + ' (Copy)',
      createdAt: now,
      updatedAt: now,
    };
    await _designsApiSave(copy);
    toast('Design copied', '✓');
    await designsLoad();
    await designsShowForm(copy.id);
  } catch(e) {
    toast('Copy failed — ' + (e.message || e), '❌');
  }
}

async function designsDeleteDesign() {
  if (!_designsEditId) return;
  const d = _designsCurrentFull;
  if (!confirm(`Delete "${(d && d.name) || 'this design'}"? This cannot be undone.`)) return;
  try {
    await _designsApiDelete(_designsEditId);
    toast('Design deleted', '🗑');
    await designsLoad();
    designsShowLibrary();
  } catch(e) {
    toast('Delete failed — ' + (e.message || e), '❌');
  }
}

// ── Thumbnail generator (300px square crop, for index card) ──
function _designsMakeThumb(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const SIZE  = 600;
      // scale so the shorter side fills SIZE (cover behavior)
      const scale = SIZE / Math.min(img.width, img.height);
      const sw = Math.round(img.width  * scale);
      const sh = Math.round(img.height * scale);
      c.width  = SIZE;
      c.height = SIZE;
      // center-crop
      c.getContext('2d').drawImage(img, -(sw - SIZE) / 2, -(sh - SIZE) / 2, sw, sh);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Image upload ──────────────────────────────
// Add an image by URL. A cross-origin image taints the canvas, so the bytes
// come back through /api/img-fetch and are handed to designsHandleImages as a
// File — same downscale, same cap, same previews as a picked file.
async function designsAddImageFromUrl() {
  designsCloseGearMenu();
  const MAX = 10;
  if (_designsImgQueue.length >= MAX) { toast(`Max ${MAX} images per design`, '⚠'); return; }

  const url = (prompt("Image URL — the direct link to the image file\n(usually ends in .jpg or .png):") || '').trim();
  if (!url) return;

  try {
    let blob;
    if (/^data:image\//i.test(url)) {
      blob = await (await fetch(url)).blob();     // already local, no round trip
    } else {
      toast('Fetching image…', '⏳');
      const resp = await fetch('/api/img-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || `Couldn't fetch that image (${resp.status})`);
      }
      blob = await resp.blob();
    }
    let name = 'image';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || name; } catch {}
    designsHandleImages([new File([blob], name, { type: blob.type })]);
  } catch (e) {
    toast(e.message || "Couldn't add that image", '⚠');
  }
}

function designsHandleImages(files) {
  const MAX = 10;
  const remaining = MAX - _designsImgQueue.length;
  if (remaining <= 0) { toast(`Max ${MAX} images per design`, '⚠'); return; }
  const toAdd = Array.from(files).slice(0, remaining);
  let loaded = 0;
  toAdd.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_W  = 1200;
        const scale  = img.width > MAX_W ? MAX_W / img.width : 1;
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        _designsImgQueue.push(canvas.toDataURL('image/jpeg', 0.82));
        loaded++;
        if (loaded === toAdd.length) designsRenderImagePreviews();
      };
      // Without this an undecodable file (e.g. HEIC in Chrome) just dead-ends.
      img.onerror = () => toast(`Couldn't read ${file.name || 'that image'}`, '⚠');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── PDF upload → Google Cloud Vision OCR ──────
async function designsHandlePDF(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Please upload a PDF file', '⚠');
    return;
  }
  const status = document.getElementById('dsn-pdf-status');
  const apiKey = localStorage.getItem('sts-gcv-key');
  if (!apiKey) {
    _dsnStatusTone(status, 'err');
    status.textContent = '⚠ Enter your Google Cloud Vision API key — click ⚙ to add it';
    const panel = document.getElementById('dsn-api-key-panel');
    if (panel) { panel.style.display = ''; designsRefreshApiKeyUI(); }
    setTimeout(() => document.getElementById('dsn-api-key-input')?.focus(), 50);
    return;
  }

  _dsnStatusTone(status, '');
  status.textContent = '⏳ Rendering PDF pages…';

  const buf = await file.arrayBuffer();
  try {
    const lib = window.pdfjsLib;
    if (!lib) { status.textContent = '❌ PDF reader not loaded'; return; }

    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;

    const pageImages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page     = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pageImages.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }

    status.textContent = '⏳ Reading the form with Google Vision…';

    const resp = await fetch('/api/vision-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        requests: pageImages.map(img => ({
          image: { content: img },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        })),
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${resp.status}`);
    }

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'Vision API error');

    const fullText = (data.responses || []).map(r => {
      if (r.error) throw new Error(r.error.message || 'Vision API error');
      return r.fullTextAnnotation?.text || '';
    }).join('\n').trim();
    if (!fullText) throw new Error('No text found in the PDF');

    const parsed = designsParseScanText(fullText);

    const nameEl = document.getElementById('dsn-name');
    const specsEl = document.getElementById('dsn-specs');
    const instrEl = document.getElementById('dsn-instructions');
    if (!nameEl.value.trim()  && parsed.name)         nameEl.value  = parsed.name;
    if (!specsEl.value.trim() && parsed.specs)         specsEl.value = parsed.specs;
    if (!instrEl.value.trim() && parsed.instructions)  instrEl.value = parsed.instructions;

    setTimeout(dsnAutoResizeAll, 0);
    _dsnStatusTone(status, 'ok');
    status.textContent = parsed.usedFallback
      ? '✓ Text scanned — sections not detected, full text placed in Instructions for review'
      : '✓ Fields filled from scan — review and edit below';
  } catch(err) {
    _dsnStatusTone(status, 'err');
    status.textContent = '❌ ' + (err.message || err);
  }
}

// ── Parse OCR text into the three form fields ─
// The instruction forms have a "Jewelry Design Name:" label, a
// SPECIFICATIONS section, and a numbered instructions section.
// Google Vision returns plain text only, so the split happens here.
function designsParseScanText(text) {
  const lines = text.split('\n');
  const isSectionHead = l => /^(specifications|instructions|steps|directions)\b/i.test(l);

  let name = '', nameIdx = -1, specIdx = -1, instrIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (nameIdx < 0) {
      const m = l.match(/jewelry\s*design\s*name\s*[:\-]?\s*(.*)/i);
      if (m) { nameIdx = i; name = m[1].trim(); continue; }
    }
    if (specIdx < 0 && /^specifications\b/i.test(l)) { specIdx = i; continue; }
    if (instrIdx < 0 && specIdx >= 0 && /^(instructions|steps|directions)\b/i.test(l)) { instrIdx = i; }
  }

  // Name written on the line below its label
  if (nameIdx >= 0 && !name) {
    for (let i = nameIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (!isSectionHead(l)) name = l;
      break;
    }
  }

  // No INSTRUCTIONS heading — fall back to the first numbered step after SPECIFICATIONS
  let instrFrom = -1;
  if (instrIdx >= 0) instrFrom = instrIdx + 1;
  else if (specIdx >= 0) {
    for (let i = specIdx + 1; i < lines.length; i++) {
      if (/^\s*\d+\s*[.)]\s+/.test(lines[i])) { instrFrom = i; break; }
    }
  }

  if (specIdx < 0 && instrFrom < 0) {
    const rest = lines.filter((_, i) => i !== nameIdx).join('\n').trim();
    return { name, specs: '', instructions: rest, usedFallback: true };
  }

  const specEnd = instrFrom >= 0 ? (instrIdx >= 0 ? instrIdx : instrFrom) : lines.length;
  const specs = specIdx >= 0 ? lines.slice(specIdx + 1, specEnd).join('\n').trim() : '';
  const instructions = instrFrom >= 0 ? lines.slice(instrFrom).join('\n').trim() : '';
  return { name, specs, instructions, usedFallback: false };
}

// ── API key management ────────────────────────
function designsSaveApiKey() {
  const val = (document.getElementById('dsn-api-key-input').value || '').trim();
  if (!val) { toast('Please enter an API key', '⚠'); return; }
  localStorage.setItem('sts-gcv-key', val);
  document.getElementById('dsn-api-key-input').value = '';
  const panel = document.getElementById('dsn-api-key-panel');
  if (panel) panel.style.display = 'none';
  toast('API key saved', '✓');
}

function designsClearApiKey() {
  localStorage.removeItem('sts-gcv-key');
  designsRefreshApiKeyUI();
}

function designsRefreshApiKeyUI() {
  const key   = localStorage.getItem('sts-gcv-key');
  const row   = document.getElementById('dsn-api-key-row');
  const saved = document.getElementById('dsn-api-key-saved');
  if (!row || !saved) return;
  if (key) { row.style.display = 'none'; saved.style.display = ''; }
  else     { row.style.display = '';     saved.style.display = 'none'; }
}

function designsToggleGearMenu() {
  const menu = document.getElementById('dsn-gear-menu');
  if (!menu) return;
  const opening = menu.style.display === 'none';
  menu.style.display = opening ? '' : 'none';
  if (opening) {
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'dsn-gear-btn') {
        menu.style.display = 'none';
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }
}

function designsCloseGearMenu() {
  const menu = document.getElementById('dsn-gear-menu');
  if (menu) menu.style.display = 'none';
}

function designsToggleApiKeyPanel() {
  const panel = document.getElementById('dsn-api-key-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  if (opening) {
    designsRefreshApiKeyUI();
    const key = localStorage.getItem('sts-gcv-key');
    if (!key) setTimeout(() => document.getElementById('dsn-api-key-input')?.focus(), 50);
  }
}

// ── Status tone (presentational only) ─────────
// Swaps the .dsn-pdf-status color modifier classes ('' = accent/default,
// 'err' = red, 'ok' = text color) so the midnight theme can restyle them
// in CSS instead of fighting hardcoded inline hex colors.
function _dsnStatusTone(el, tone) {
  if (!el) return;
  el.classList.remove('err', 'ok');
  if (tone) el.classList.add(tone);
}

// ── Auto-resize textareas ─────────────────────
function dsnAutoResize(el) {
  el.style.height = '0';
  el.style.height = (el.scrollHeight + 2) + 'px';
}
function dsnAutoResizeAll() {
  document.querySelectorAll('#designs-form-wrap .dsn-textarea').forEach(dsnAutoResize);
}

// ── Utility ───────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════
//  BOM EDITOR (Phase 3)
//  Material recipe lines on the design record. Metal lines carry a
//  waste factor: design override → metal-type default → shop default.
//  Component lines never carry waste.
// ════════════════════════════════════════════

function _dsnBomMat(id) {
  return (_designsMaterials || []).find(m => m.notionPageId === id);
}

function _dsnUnitSuffix(m) {
  return m ? matUnitAbbr(m.unit) : 'pc';
}

// ── Total-weight % split (multi-material pieces) ──
//  When on, weight-based lines (gram/ozt) take a % of the piece's total
//  weight instead of an absolute qty; piece/foot lines keep absolute qty.
//  qty is always computed and stored, so cost rollups, the pricing sheet
//  and the replenishment engine are untouched.
const _DSN_G_PER_OZT = 31.1035;
const _DSN_IN_PER_FT = 12;

function _dsnIsWeightUnit(m) { return !!m && (m.unit === 'gram' || m.unit === 'ozt'); }
function _dsnIsChainMat(m)   { return !!m && m.category === 'chain'; }
function _dsnBomSplitOn()    { const el = document.getElementById('dsn-bom-split'); return !!(el && el.checked); }
// The total-weight field is entered in troy ounces; line math runs in grams
function _dsnBomTotalOzt()   { const v = parseFloat((document.getElementById('dsn-bom-total') || {}).value); return isNaN(v) ? null : v; }
function _dsnBomTotalG()     { const v = _dsnBomTotalOzt(); return v == null ? null : v * _DSN_G_PER_OZT; }

// qty in the material's own unit from total grams × pct
function _dsnSplitQty(m, totalG, pct) {
  if (!m || totalG == null || pct == null || !(pct > 0)) return null;
  const q = totalG * pct / 100 / (m.unit === 'ozt' ? _DSN_G_PER_OZT : 1);
  return Math.round(q * 1000) / 1000;
}

function dsnBomSplitToggle() {
  const on = _dsnBomSplitOn();
  const wrap = document.getElementById('dsn-bom-total-wrap');
  if (wrap) wrap.style.display = on ? '' : 'none';
  dsnBomSyncFromDom();
  if (on) {
    // Seed total + % from any absolute weights already entered
    const totalEl = document.getElementById('dsn-bom-total');
    if (totalEl && totalEl.value === '') {
      let totG = 0;
      _designsBom.forEach(l => {
        const m = _dsnBomMat(l.materialId);
        if (_dsnIsWeightUnit(m) && l.qty > 0) totG += l.qty * (m.unit === 'ozt' ? _DSN_G_PER_OZT : 1);
      });
      if (totG > 0) {
        totalEl.value = Math.round(totG / _DSN_G_PER_OZT * 1000) / 1000;
        _designsBom.forEach(l => {
          const m = _dsnBomMat(l.materialId);
          if (_dsnIsWeightUnit(m) && l.qty > 0) {
            l.pct = Math.round(l.qty * (m.unit === 'ozt' ? _DSN_G_PER_OZT : 1) / totG * 1000) / 10;
          }
        });
      }
    }
  }
  _designsBomRender();
}

function dsnBomTotalInput() {
  dsnBomSyncFromDom();
  dsnBomRecalcEffective();
  _dsnBomPctSumRender();
}

function _dsnBomPctSumRender() {
  const el = document.getElementById('dsn-bom-pct-sum');
  if (!el) return;
  if (!_dsnBomSplitOn()) { el.textContent = ''; return; }
  let sum = 0, any = false;
  _designsBom.forEach(l => {
    if (_dsnIsWeightUnit(_dsnBomMat(l.materialId)) && l.pct > 0) { sum += l.pct; any = true; }
  });
  sum = Math.round(sum * 10) / 10;
  if (_dsnBomTotalG() == null) {
    el.textContent = any ? '⚠ enter total weight' : '';
    el.className = 'dsn-bom-pct-sum warn';
    return;
  }
  el.textContent = 'Σ ' + sum + '%' + (sum === 100 ? ' ✓' : '');
  el.className = 'dsn-bom-pct-sum ' + (sum === 100 ? 'ok' : 'warn');
}

// Effective waste % for a metal line (spec §5 hybrid model) — pure form,
// usable outside the edit form (pricing sheet, cost rollups)
function _dsnWastePctResolve(m, overridePct) {
  if (overridePct != null && !isNaN(overridePct)) return overridePct;
  const s = _shopSettings || {};
  const mt = (s.wastePctByMetal || {})[m.metalType];
  if (typeof mt === 'number') return mt;
  return typeof s.wasteDefaultPct === 'number' ? s.wasteDefaultPct : 0;
}

// Form-context wrapper: reads the design's waste override from the DOM
function _dsnWastePctFor(m) {
  const ov = parseFloat((document.getElementById('dsn-waste') || {}).value);
  return _dsnWastePctResolve(m, isNaN(ov) ? null : ov);
}

function _dsnEffectiveLabel(l, split) {
  const m = _dsnBomMat(l.materialId);
  if (!m) return '';
  // Chain lines are entered in inches but priced/stocked by the ft the
  // Materials Library carries — show the ft the entered length converts to.
  if (_dsnIsChainMat(m)) return l.qty > 0 ? ('= ' + l.qty.toFixed(2) + ' ft') : '';
  if (!(l.qty > 0)) return '';
  const unit = _dsnUnitSuffix(m);
  // Troy-oz equivalent of the entered qty on gram-based lines
  const oztEq = (m.unit === 'gram')
    ? '(' + (Math.round(l.qty / _DSN_G_PER_OZT * 1000) / 1000) + ' ozt)'
    : '';
  const base = (split && _dsnIsWeightUnit(m))
    ? '= ' + l.qty + ' ' + unit + (oztEq ? ' ' + oztEq : '')
    : '';
  if (m.category !== 'metal') return base || (l.qty + ' ' + unit + (oztEq ? ' ' + oztEq : ''));
  const w = _dsnWastePctFor(m);
  const head = base ? base + ' ' : (oztEq ? oztEq + ' ' : '');
  return head + '→ ' + (l.qty * (1 + w / 100)).toFixed(2) + ' ' + unit + ' incl. ' + w + '% waste';
}

function _dsnBomOptions(selectedId) {
  function opts(list) {
    return list.map(m =>
      `<option value="${m.notionPageId}"${m.notionPageId === selectedId ? ' selected' : ''}>${escHtml(m.name || 'Untitled')} (${_dsnUnitSuffix(m)})</option>`
    ).join('');
  }
  const metals = _designsMaterials.filter(m => m.category === 'metal');
  const wire   = metals.filter(m => m.form === 'wire');
  const sheet  = metals.filter(m => m.form === 'sheet');
  const others = metals.filter(m => m.form !== 'wire' && m.form !== 'sheet');
  const chains = _designsMaterials.filter(m => m.category === 'chain');
  const comps  = _designsMaterials.filter(m => m.category !== 'metal' && m.category !== 'chain');
  return '<option value="">Pick material…</option>'
    + (wire.length   ? '<optgroup label="Wire">'       + opts(wire)   + '</optgroup>' : '')
    + (sheet.length  ? '<optgroup label="Sheet">'      + opts(sheet)  + '</optgroup>' : '')
    + (others.length ? '<optgroup label="Metals">'     + opts(others) + '</optgroup>' : '')
    + (chains.length ? '<optgroup label="Chains">'     + opts(chains) + '</optgroup>' : '')
    + (comps.length  ? '<optgroup label="Components">' + opts(comps)  + '</optgroup>' : '');
}

function dsnBomAdd() {
  dsnBomSyncFromDom();
  _designsBom.push({ materialId: '', qty: null, pct: null });
  _designsBomRender();
}

function _designsBomRender() {
  const wrap = document.getElementById('dsn-bom-rows');
  if (!wrap || _designsView !== 'form') return;
  if (_designsMaterials === null) {
    wrap.innerHTML = '<div class="dsn-bom-note">Loading materials…</div>';
    return;
  }
  if (!_designsMaterials.length) {
    wrap.innerHTML = '<div class="dsn-bom-note">No materials in the library yet — seed <strong>Supplies → Materials Library</strong> first.</div>';
    return;
  }

  const split = _dsnBomSplitOn();
  const total = _dsnBomTotalG();
  wrap.innerHTML = _designsBom.map((l, i) => {
    const m = _dsnBomMat(l.materialId);
    const usePct = split && _dsnIsWeightUnit(m);
    if (usePct) l.qty = _dsnSplitQty(m, total, l.pct);
    const isChain = !usePct && _dsnIsChainMat(m);
    let inputHtml;
    if (usePct) {
      inputHtml = `<input type="number" step="0.1" min="0" max="100" class="dsn-bom-pct" placeholder="% of total" value="${l.pct != null ? l.pct : ''}">`;
    } else if (isChain) {
      const inVal = l.qty > 0 ? Math.round(l.qty * _DSN_IN_PER_FT * 1000) / 1000 : '';
      inputHtml = `<input type="number" step="0.01" min="0" class="dsn-bom-qty dsn-bom-chain-in" placeholder="Length (in)" value="${inVal}">`;
    } else {
      inputHtml = `<input type="number" step="0.01" min="0" class="dsn-bom-qty" placeholder="Qty${m ? ' (' + _dsnUnitSuffix(m) + ')' : ''}" value="${l.qty != null ? l.qty : ''}">`;
    }
    return `<div class="dsn-bom-row" data-idx="${i}">
      <select class="dsn-bom-mat">${_dsnBomOptions(l.materialId)}</select>
      ${inputHtml}
      <span class="dsn-bom-eff">${escHtml(_dsnEffectiveLabel(l, split))}</span>
      <button type="button" class="dsn-bom-remove" title="Remove line">✕</button>
    </div>`;
  }).join('') || '<div class="dsn-bom-note">No materials weighed yet — the recipe powers cost rollups and the replenishment engine.</div>';

  wrap.querySelectorAll('.dsn-bom-row').forEach(row => {
    const idx   = parseInt(row.dataset.idx, 10);
    const sel   = row.querySelector('.dsn-bom-mat');
    const qtyEl = row.querySelector('.dsn-bom-qty, .dsn-bom-pct');
    sel.addEventListener('change', () => {
      dsnBomSyncFromDom();
      // Switching materials can switch the input's unit (e.g. plain qty ↔
      // chain-by-length) — the old value no longer means anything, and a
      // full re-render swaps the input type in.
      const l = _designsBom[idx];
      if (l) { l.qty = null; l.pct = null; }
      _designsBomRender();
    });
    qtyEl.addEventListener('input', () => { dsnBomSyncFromDom(); dsnBomRecalcEffective(); _dsnBomPctSumRender(); });
    row.querySelector('.dsn-bom-remove').addEventListener('click', () => {
      dsnBomSyncFromDom();
      _designsBom.splice(idx, 1);
      _designsBomRender();
    });
  });

  dsnWasteDefaultsRefreshLabel();
  dsnRollupRender();
  _dsnBomPctSumRender();
}

function dsnBomSyncFromDom() {
  const total = _dsnBomTotalG();
  document.querySelectorAll('#dsn-bom-rows .dsn-bom-row').forEach(row => {
    const l = _designsBom[parseInt(row.dataset.idx, 10)];
    if (!l) return;
    l.materialId = row.querySelector('.dsn-bom-mat').value;
    const pctEl     = row.querySelector('.dsn-bom-pct');
    const chainInEl = row.querySelector('.dsn-bom-chain-in');
    if (pctEl) {
      const p = parseFloat(pctEl.value);
      l.pct = isNaN(p) ? null : p;
      l.qty = _dsnSplitQty(_dsnBomMat(l.materialId), total, l.pct);
    } else if (chainInEl) {
      // Entered in inches, stored in ft — still priced/stocked per foot.
      const inches = parseFloat(chainInEl.value);
      l.qty = isNaN(inches) ? null : Math.round(inches / _DSN_IN_PER_FT * 1000) / 1000;
    } else {
      const q = parseFloat(row.querySelector('.dsn-bom-qty').value);
      l.qty = isNaN(q) ? null : q;
    }
  });
}

// Refresh only the per-row effective-consumption labels (waste % changed)
function dsnBomRecalcEffective() {
  const split = _dsnBomSplitOn();
  document.querySelectorAll('#dsn-bom-rows .dsn-bom-row').forEach(row => {
    const l = _designsBom[parseInt(row.dataset.idx, 10)];
    const eff = row.querySelector('.dsn-bom-eff');
    if (l && eff) eff.textContent = _dsnEffectiveLabel(l, split);
  });
  dsnRollupRender();
}

// ── Shop-wide waste defaults (shared via /api/shop-settings) ──
function dsnWasteDefaultsRefreshLabel() {
  const el = document.getElementById('dsnWasteDefaultsLbl');
  if (!el) return;
  if (_shopSettings === null) { el.textContent = 'Waste defaults: loading…'; return; }
  const pm  = _shopSettings.wastePctByMetal || {};
  const mp  = _shopSettings.metalPricePerOzt || {};
  const fmt = v => (typeof v === 'number' ? v + '%' : '—');
  const fm$ = v => (typeof v === 'number' ? '$' + v.toFixed(2) : '—');
  el.textContent = 'Waste defaults — shop: ' + fmt(_shopSettings.wasteDefaultPct)
    + ' · argentium: ' + fmt(pm.argentium)
    + ' · gold-fill: ' + fmt(pm.gold_fill)
    + '  |  Metal $/ozt — argentium: ' + fm$(mp.argentium)
    + ' · gold-fill: ' + fm$(mp.gold_fill);
}

function dsnWasteDefaultsToggle() {
  const p = document.getElementById('dsnWasteDefaultsPanel');
  if (!p) return;
  const opening = p.style.display === 'none';
  if (opening) {
    const s  = _shopSettings || {};
    const pm = s.wastePctByMetal || {};
    const mp = s.metalPricePerOzt || {};
    document.getElementById('dsnWdShop').value      = s.wasteDefaultPct ?? '';
    document.getElementById('dsnWdArgentium').value = pm.argentium ?? '';
    document.getElementById('dsnWdGf').value        = pm.gold_fill ?? '';
    document.getElementById('dsnWdAgPrice').value   = mp.argentium ?? '';
    document.getElementById('dsnWdGfPrice').value   = mp.gold_fill ?? '';
  }
  p.style.display = opening ? '' : 'none';
}

async function dsnWasteDefaultsSave() {
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  // Preserve Phase 4 fields (hourly rate, margins) already in the blob
  const s = Object.assign({}, _shopSettings || {});
  s.wasteDefaultPct = num(document.getElementById('dsnWdShop').value);
  s.wastePctByMetal = {};
  const ag = num(document.getElementById('dsnWdArgentium').value);
  const gf = num(document.getElementById('dsnWdGf').value);
  if (ag != null) s.wastePctByMetal.argentium = ag;
  if (gf != null) s.wastePctByMetal.gold_fill = gf;
  s.metalPricePerOzt = {};
  const agP = num(document.getElementById('dsnWdAgPrice').value);
  const gfP = num(document.getElementById('dsnWdGfPrice').value);
  if (agP != null) s.metalPricePerOzt.argentium = agP;
  if (gfP != null) s.metalPricePerOzt.gold_fill = gfP;
  try {
    const r = await fetch('/api/shop-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    _shopSettings = s;
    toast('Waste defaults saved', '✓');
    dsnWasteDefaultsToggle();
    dsnWasteDefaultsRefreshLabel();
    dsnBomRecalcEffective();
  } catch (e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

// ════════════════════════════════════════════
//  COST ROLLUP & PRICING (Phase 4)
//  True per-piece cost: BOM materials (incl. waste) + tracked labor.
//  Labor minutes/piece derive from the same work-session history the
//  Production Report reads (pooled by parent Square ITEM, so sessions
//  logged against any size variation count for the design); retail
//  price comes live from Square. Manual overrides cover unlinked or
//  untracked designs.
// ════════════════════════════════════════════

function _dsnNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// ── Labor: aggregate work sessions → minutes/piece per item key ──
// Same share math as the Production Report's By Design view: a session's
// net time splits across its items proportionally to pieces made.
// Sessions log per size variation; labor pools under the parent ITEM id
// so a design linked to any size sees all of that item's sessions.
function _dsnLoadLabor(force) {
  if (_dsnLabor !== null && !force) return Promise.resolve(_dsnLabor);
  return fetch('/api/notion-timesession?all=true')
    .then(r => (r.ok ? r.json() : []))
    .then(ns => {
      const sessions = [];
      const varIds = [];
      (Array.isArray(ns) ? ns : []).forEach(s => {
        if (s.netMin == null) return;
        let items = null;
        if (s.itemsJson) { try { items = JSON.parse(s.itemsJson); } catch (e) {} }
        if (!items) items = s.itemName ? [{ name: s.itemName, squareId: s.squareItemId || '', pieces: s.pieces, isCustom: false }] : [];
        const withPcs = (items || []).filter(it => it.pieces > 0);
        const totalPcs = withPcs.reduce((t, it) => t + it.pieces, 0);
        if (!totalPcs) return;
        withPcs.forEach(it => { if (it.squareId && !it.isCustom) varIds.push(it.squareId); });
        sessions.push({ netMin: s.netMin, withPcs, totalPcs });
      });
      return _dsnLoadVarToItem(varIds).then(() => {
        const agg = {};
        sessions.forEach(s => {
          s.withPcs.forEach(it => {
            const key = (it.squareId && !it.isCustom)
              ? (_dsnVarToItem[it.squareId] || it.squareId)
              : 'custom:' + (it.name || '');
            const g = agg[key] = agg[key] || { hrs: 0, pcs: 0 };
            g.hrs += (s.netMin / 60) * (it.pieces / s.totalPcs);
            g.pcs += it.pieces;
          });
        });
        Object.keys(agg).forEach(k => { agg[k].minPerPc = agg[k].pcs ? (agg[k].hrs * 60 / agg[k].pcs) : null; });
        _dsnLabor = agg;
        return agg;
      });
    })
    .catch(() => { if (_dsnLabor === null) _dsnLabor = {}; return _dsnLabor; });
}

// ── Variation → parent item: batch-retrieve unknown variation ids ──
// Falls back silently on API failure; unmapped ids key labor by the
// variation itself (the old behavior).
function _dsnLoadVarToItem(varIds) {
  const need = [...new Set((varIds || []).filter(id => id && !(id in _dsnVarToItem)))];
  if (!need.length) return Promise.resolve(_dsnVarToItem);
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/batch-retrieve', method: 'POST', body: { object_ids: need } }),
  })
    .then(r => r.json())
    .then(data => {
      (data.objects || []).forEach(obj => {
        if (obj.type !== 'ITEM_VARIATION') return;
        const vd = obj.item_variation_data || {};
        if (vd.item_id) _dsnVarToItem[obj.id] = vd.item_id;
      });
      return _dsnVarToItem;
    })
    .catch(() => _dsnVarToItem);
}

// ── Retail prices: batch-retrieve linked Square variations ──
function _dsnLoadSqPrices(varIds) {
  // Also fetches when only the var→item mapping is missing (e.g. a price
  // cached from search results by dsnSqLink never hit batch-retrieve).
  const need = (varIds || []).filter(id => id && (!(id in _dsnSqPrices) || !(id in _dsnVarToItem)));
  if (!need.length) return Promise.resolve(_dsnSqPrices);
  return fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/batch-retrieve', method: 'POST', body: { object_ids: need } }),
  })
    .then(r => r.json())
    .then(data => {
      need.forEach(id => { if (!(id in _dsnSqPrices)) _dsnSqPrices[id] = null; });
      (data.objects || []).forEach(obj => {
        if (obj.type !== 'ITEM_VARIATION') return;
        const vd = obj.item_variation_data || {};
        _dsnSqPrices[obj.id] = vd.price_money ? vd.price_money.amount / 100 : null;
        if (vd.item_id) _dsnVarToItem[obj.id] = vd.item_id;
      });
      return _dsnSqPrices;
    })
    .catch(() => _dsnSqPrices);
}

// ── The rollup (spec §6) ──────────────────────
// d needs: bom, wasteOverridePct, squareItemId, retailPriceOverride,
// laborMinPerPieceOverride. Works for form snapshots and index entries.
function dsnCostRollup(d) {
  const matById = {};
  (_designsMaterials || []).forEach(m => { matById[m.notionPageId] = m; });
  const s = _shopSettings || {};
  const shopPrices = s.metalPricePerOzt || {};

  const lines = [];
  let matCost = 0, matMissing = false;
  (d.bom || []).forEach(l => {
    const m = matById[l.materialId];
    if (!m || !(l.qty > 0)) { matMissing = true; return; }
    const isMetal = m.category === 'metal';
    const w = isMetal ? _dsnWastePctResolve(m, d.wasteOverridePct != null ? d.wasteOverridePct : null) : 0;
    const effQty = l.qty * (1 + w / 100);
    // Per-material cost wins; metals with no cost fall back to the
    // shop-wide $/ozt price for their metal type (argentium / gold_fill).
    const shopPrice = isMetal && typeof shopPrices[m.metalType] === 'number' ? shopPrices[m.metalType] : null;
    const unitCost = m.currentCostPerUnit != null ? m.currentCostPerUnit : shopPrice;
    const cost = unitCost != null ? effQty * unitCost : null;
    if (cost == null) matMissing = true; else matCost += cost;
    lines.push({
      name: m.name, qty: l.qty, unit: _dsnUnitSuffix(m),
      wastePct: isMetal ? w : null, effQty, unitCost, cost,
      shopPriced: m.currentCostPerUnit == null && unitCost != null,
    });
  });
  const hasBom = (d.bom || []).length > 0;

  const vkey = d.squareItemId || null;                       // linked variation: retail price
  const key = vkey ? (_dsnVarToItem[vkey] || vkey) : null;   // parent item: pooled labor
  const tracked = (key && _dsnLabor && _dsnLabor[key]) ? _dsnLabor[key].minPerPc : null;
  const laborMin = d.laborMinPerPieceOverride != null ? d.laborMinPerPieceOverride : tracked;
  const laborSource = d.laborMinPerPieceOverride != null ? 'override' : (tracked != null ? 'tracked' : null);
  const rate = typeof s.shopHourlyRate === 'number' ? s.shopHourlyRate : null;
  const laborCost = (laborMin != null && rate != null) ? (laborMin / 60) * rate : null;

  const sqPrice = (vkey && _dsnSqPrices[vkey] != null) ? _dsnSqPrices[vkey] : null;
  const retail = d.retailPriceOverride != null ? d.retailPriceOverride : sqPrice;
  const retailSource = d.retailPriceOverride != null ? 'override' : (sqPrice != null ? 'square' : null);

  const pieceCost = (hasBom || laborCost != null) ? matCost + (laborCost || 0) : null;
  const margin = (retail > 0 && pieceCost != null) ? (retail - pieceCost) / retail : null;
  const target = typeof s.targetMarginPct === 'number' ? s.targetMarginPct : null;
  const suggested = (pieceCost != null && target != null && target < 100) ? pieceCost / (1 - target / 100) : null;

  return { lines, matCost, matMissing, hasBom, laborMin, laborSource, laborCost, rate,
           retail, retailSource, pieceCost, margin, suggested };
}

// A design's own top-level bom/squareItemId/etc. are its "default" combo;
// each entry in d.variants[] is another size/metal/width combo sharing the
// same specs/instructions/images. Expand a design into one cost-rollup row
// per combo so the Pricing Sheet (and CSV export) can compare them.
function _dsnDesignEntries(d) {
  const entries = [{ label: d.name || 'Untitled', r: dsnCostRollup(d), isVariant: false }];
  (d.variants || []).forEach(v => {
    entries.push({ label: (d.name || 'Untitled') + ' — ' + (v.label || 'Variation'), r: dsnCostRollup(v), isVariant: true });
  });
  return entries;
}

// ── Cost breakdown panel on the design form ──
function _dsnFormDesignSnapshot() {
  dsnBomSyncFromDom();
  const wasteRaw = (document.getElementById('dsn-waste') || {}).value;
  return {
    bom: _designsBom.filter(l => l.materialId && l.qty > 0),
    wasteOverridePct: (wasteRaw === '' || wasteRaw == null) ? null : parseFloat(wasteRaw),
    squareItemId: _dsnLinkedSq ? _dsnLinkedSq.id : null,
    retailPriceOverride:      _dsnNumOrNull((document.getElementById('dsn-retail-ov') || {}).value),
    laborMinPerPieceOverride: _dsnNumOrNull((document.getElementById('dsn-labor-ov')  || {}).value),
  };
}

const _dsnMoney = v => (v != null ? '$' + v.toFixed(2) : '—');

function dsnRollupRender() {
  const el = document.getElementById('dsn-rollup');
  if (!el || _designsView !== 'form') return;
  if (_designsMaterials === null) { el.innerHTML = '<div class="dsn-bom-note">Loading cost data…</div>'; return; }

  const r = dsnCostRollup(_dsnFormDesignSnapshot());
  if (!r.hasBom && r.laborCost == null) {
    el.innerHTML = '<div class="dsn-bom-note">⚖ Materials not yet weighed — add BOM lines above to see true piece cost.</div>';
    return;
  }

  el.innerHTML = _dsnRollupBoxHtml(r);
}

// Shared breakdown box — form cost panel + guide costing strip detail
function _dsnRollupBoxHtml(r) {
  const matRows = r.lines.map(l => {
    const wasteTxt = l.wastePct != null && l.wastePct > 0 ? ` <span class="dsn-ru-dim">+${l.wastePct}% waste → ${l.effQty.toFixed(2)}${l.unit}</span>` : '';
    const shopTxt = l.shopPriced ? ` <span class="dsn-ru-dim">@ shop $${l.unitCost.toFixed(2)}/${l.unit}</span>` : '';
    return `<div class="dsn-ru-row"><span>${escHtml(l.name)} · ${l.qty}${l.unit}${wasteTxt}${shopTxt}</span><span>${_dsnMoney(l.cost)}</span></div>`;
  }).join('');

  const laborNote = r.laborSource === 'tracked' ? ` <span class="dsn-ru-dim">(${r.laborMin.toFixed(1)} min/pc from timers)</span>`
    : r.laborSource === 'override' ? ` <span class="dsn-ru-dim">(${r.laborMin} min/pc, manual)</span>` : '';
  const laborVal = r.laborCost != null ? _dsnMoney(r.laborCost)
    : (r.rate == null ? 'set hourly rate' : 'no time data');
  const retailNote = r.retailSource === 'square' ? ' <span class="dsn-ru-dim">(Square)</span>'
    : r.retailSource === 'override' ? ' <span class="dsn-ru-dim">(manual)</span>' : '';
  const marginTxt = r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—';
  const floor = (_shopSettings || {}).marginFloorPct;
  const marginBad = r.margin != null && typeof floor === 'number' && r.margin * 100 < floor;

  return '<div class="dsn-ru-box">'
    + matRows
    + (r.matMissing ? '<div class="dsn-bom-note">⚠ Some lines missing a material price — totals incomplete</div>' : '')
    + `<div class="dsn-ru-row dsn-ru-sub"><span>Materials</span><span>${_dsnMoney(r.matCost)}</span></div>`
    + `<div class="dsn-ru-row dsn-ru-sub"><span>Labor${laborNote}</span><span>${laborVal}</span></div>`
    + `<div class="dsn-ru-row dsn-ru-total"><span>Piece cost</span><span>${_dsnMoney(r.pieceCost)}</span></div>`
    + `<div class="dsn-ru-row"><span>Retail${retailNote}</span><span>${_dsnMoney(r.retail)}</span></div>`
    + `<div class="dsn-ru-row ${marginBad ? 'dsn-ru-bad' : ''}"><span>Margin${marginBad ? ' ⚠ below floor' : ''}</span><span>${marginTxt}</span></div>`
    + (r.suggested != null ? `<div class="dsn-ru-row dsn-ru-dim2"><span>Suggested @ ${(_shopSettings || {}).targetMarginPct}% target</span><span>${_dsnMoney(r.suggested)}</span></div>` : '')
    + '</div>';
}

// ── Square item link picker ───────────────────
function dsnSqLinkRender() {
  const linked = document.getElementById('dsn-sq-linked');
  const search = document.getElementById('dsn-sq-search-wrap');
  if (!linked || !search) return;
  if (_dsnLinkedSq) {
    linked.style.display = '';
    search.style.display = 'none';
    document.getElementById('dsn-sq-linked-name').textContent = _dsnLinkedSq.name;
  } else {
    linked.style.display = 'none';
    search.style.display = '';
    const inp = document.getElementById('dsn-sq-search');
    if (inp) inp.value = '';
    const res = document.getElementById('dsn-sq-results');
    if (res) res.style.display = 'none';
  }
}

function dsnSqSearchInput(q) {
  clearTimeout(_dsnSqSearchTimer);
  const res = document.getElementById('dsn-sq-results');
  if (!q || q.trim().length < 2) { if (res) res.style.display = 'none'; return; }
  _dsnSqSearchTimer = setTimeout(() => _dsnSqSearchRun(q.trim()), 350);
}

function _dsnSqSearchRun(q) {
  const res = document.getElementById('dsn-sq-results');
  if (!res) return;
  res.style.display = '';
  res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Searching Square…</div>';
  fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/search-catalog-items', method: 'POST', body: { text_filter: q, limit: 10 } }),
  })
    .then(r => r.json())
    .then(data => {
      const out = [];
      (data.items || []).forEach(item => {
        const nm = (item.item_data && item.item_data.name) || '';
        ((item.item_data && item.item_data.variations) || []).forEach(v => {
          const vd = v.item_variation_data || {};
          const label = nm + (vd.name && vd.name !== 'Regular' ? ' — ' + vd.name : '');
          const price = vd.price_money ? vd.price_money.amount / 100 : null;
          out.push({ id: v.id, label, price });
        });
      });
      if (!out.length) { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">No Square items found</div>'; return; }
      res.innerHTML = out.map(o =>
        `<button type="button" class="dsn-sq-result" onclick="dsnSqLink('${o.id}','${escHtml(o.label).replace(/'/g, '&#39;')}',${o.price != null ? o.price : 'null'})">${escHtml(o.label)}${o.price != null ? ' <span class="dsn-ru-dim">$' + o.price.toFixed(2) + '</span>' : ''}</button>`
      ).join('');
    })
    .catch(() => { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Square search failed</div>'; });
}

function dsnSqLink(id, label, price) {
  _dsnLinkedSq = { id, name: label };
  if (price != null) _dsnSqPrices[id] = price;
  dsnSqLinkRender();
  _dsnLoadSqPrices([id]).then(dsnRollupRender);
  dsnRollupRender();
}

function dsnSqUnlink() {
  _dsnLinkedSq = null;
  dsnSqLinkRender();
  dsnRollupRender();
}

// ── Design Variants (size / metal / width combos) ──────────────
// A design's own top-level bom/squareItemId/etc. represent its "default"
// combo (e.g. Small / Gold Fill). Other combos that share the same specs,
// instructions and images but cost or sell differently (Large / Silver,
// a wider gauge, …) live in d.variants[], each with its own BOM and Square
// link, so cost/margin can be compared side-by-side without duplicating
// the whole design.
let _dsnVariants         = [];   // working copy for the design open in the form
let _dsnVarEditIdx       = null; // index into _dsnVariants being edited, null = new
let _dsnVarBom           = [];   // working BOM lines for the variant in the modal
let _dsnVarLinkedSq      = null; // {id, name} staged for the variant in the modal
let _dsnVarSqSearchTimer = null;

function _dsnVariantsInit(design) {
  _dsnVariants = (design && Array.isArray(design.variants))
    ? design.variants.map(v => ({
        id: v.id, label: v.label || '',
        bom: (v.bom || []).map(l => ({ materialId: l.materialId, qty: l.qty })),
        wasteOverridePct: v.wasteOverridePct != null ? v.wasteOverridePct : null,
        squareItemId: v.squareItemId || null, squareItemName: v.squareItemName || null,
        retailPriceOverride: v.retailPriceOverride != null ? v.retailPriceOverride : null,
        laborMinPerPieceOverride: v.laborMinPerPieceOverride != null ? v.laborMinPerPieceOverride : null,
      }))
    : [];
  _dsnVariantsRender();
}

function _dsnVariantsRender() {
  const wrap = document.getElementById('dsn-var-list');
  if (!wrap) return;
  if (!_dsnVariants.length) {
    wrap.innerHTML = '<div class="dsn-bom-note">No other combos yet — add sizes, metals, or widths that share this design\'s specs but cost or sell differently.</div>';
    return;
  }
  const sqIds = _dsnVariants.map(v => v.squareItemId).filter(Boolean);
  const sqNewIds = sqIds.filter(id => !_dsnSqFetchAttempted.has(id));
  if (sqNewIds.length) {
    sqNewIds.forEach(id => _dsnSqFetchAttempted.add(id));
    _dsnLoadSqPrices(sqIds).then(_dsnVariantsRender);
  }
  wrap.innerHTML = _dsnVariants.map((v, i) => {
    const r = dsnCostRollup(v);
    const stats = [
      `Mat ${r.hasBom ? _dsnMoney(r.matCost) : '—'}`,
      `Labor ${_dsnMoney(r.laborCost)}`,
      `Piece ${_dsnMoney(r.pieceCost)}`,
      `Retail ${_dsnMoney(r.retail)}`,
      `Margin ${r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—'}`,
    ].join(' · ');
    return `<div class="dsn-var-row">
      <div class="dsn-var-row-main">
        <div class="dsn-var-row-label">${escHtml(v.label || 'Untitled variation')}</div>
        <div class="dsn-var-row-stats">${stats}</div>
      </div>
      <div class="dsn-var-row-actions">
        <button type="button" class="dsn-bom-remove" onclick="dsnVariantEdit(${i})" title="Edit">✎</button>
        <button type="button" class="dsn-bom-remove" onclick="dsnVariantDelete(${i})" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');
}

function dsnVariantDelete(idx) {
  if (!confirm('Remove this variation?')) return;
  _dsnVariants.splice(idx, 1);
  _dsnVariantsRender();
}

function dsnVariantAdd()        { _dsnVariantModalOpen(null); }
function dsnVariantEdit(idx)    { _dsnVariantModalOpen(idx); }

function _dsnVariantModalOpen(idx) {
  _dsnVarEditIdx = idx;
  const v = idx != null ? _dsnVariants[idx] : null;
  document.getElementById('dsnVarModalTitle').textContent = v ? 'Edit Variation' : 'Add Variation';
  document.getElementById('dsn-var-label').value = v ? v.label : '';
  _dsnVarBom = v ? v.bom.map(l => ({ materialId: l.materialId, qty: l.qty })) : [];
  document.getElementById('dsn-var-waste').value = (v && v.wasteOverridePct != null) ? v.wasteOverridePct : '';
  _dsnVarLinkedSq = (v && v.squareItemId) ? { id: v.squareItemId, name: v.squareItemName || v.squareItemId } : null;
  document.getElementById('dsn-var-retail-ov').value = (v && v.retailPriceOverride != null) ? v.retailPriceOverride : '';
  document.getElementById('dsn-var-labor-ov').value  = (v && v.laborMinPerPieceOverride != null) ? v.laborMinPerPieceOverride : '';
  dsnVarSqLinkRender();
  _dsnVarBomRender();
  if (_dsnVarLinkedSq) _dsnLoadSqPrices([_dsnVarLinkedSq.id]).then(dsnVariantModalRollupRender);
  document.getElementById('dsnVarOverlay').classList.add('active');
  document.getElementById('dsnVarModal').classList.add('active');
}

function dsnVariantModalClose() {
  document.getElementById('dsnVarOverlay').classList.remove('active');
  document.getElementById('dsnVarModal').classList.remove('active');
  _dsnVarEditIdx = null;
}

function dsnVariantModalSave() {
  const label = document.getElementById('dsn-var-label').value.trim();
  if (!label) { toast('Give this variation a label', '⚠'); return; }
  dsnVarBomSyncFromDom();
  const variant = {
    id: (_dsnVarEditIdx != null && _dsnVariants[_dsnVarEditIdx].id) || ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    label,
    bom: _dsnVarBom.filter(l => l.materialId && l.qty > 0),
    wasteOverridePct: _dsnNumOrNull(document.getElementById('dsn-var-waste').value),
    squareItemId: _dsnVarLinkedSq ? _dsnVarLinkedSq.id : null,
    squareItemName: _dsnVarLinkedSq ? _dsnVarLinkedSq.name : null,
    retailPriceOverride: _dsnNumOrNull(document.getElementById('dsn-var-retail-ov').value),
    laborMinPerPieceOverride: _dsnNumOrNull(document.getElementById('dsn-var-labor-ov').value),
  };
  if (_dsnVarEditIdx != null) _dsnVariants[_dsnVarEditIdx] = variant;
  else _dsnVariants.push(variant);
  dsnVariantModalClose();
  _dsnVariantsRender();
}

// ── Variant modal: BOM editor (simplified — no total-weight % split mode) ──
function dsnVarBomAdd() {
  dsnVarBomSyncFromDom();
  _dsnVarBom.push({ materialId: '', qty: null });
  _dsnVarBomRender();
}

function _dsnVarWastePctFor(m) {
  const ov = parseFloat((document.getElementById('dsn-var-waste') || {}).value);
  return _dsnWastePctResolve(m, isNaN(ov) ? null : ov);
}

function _dsnVarEffectiveLabel(l) {
  const m = _dsnBomMat(l.materialId);
  if (!m || !(l.qty > 0)) return '';
  const unit = _dsnUnitSuffix(m);
  if (m.category !== 'metal') return l.qty + ' ' + unit;
  const w = _dsnVarWastePctFor(m);
  return '→ ' + (l.qty * (1 + w / 100)).toFixed(2) + ' ' + unit + ' incl. ' + w + '% waste';
}

function _dsnVarBomRender() {
  const wrap = document.getElementById('dsn-var-bom-rows');
  if (!wrap) return;
  if (_designsMaterials === null) { wrap.innerHTML = '<div class="dsn-bom-note">Loading materials…</div>'; return; }
  wrap.innerHTML = _dsnVarBom.map((l, i) => `<div class="dsn-bom-row" data-idx="${i}">
      <select class="dsn-bom-mat">${_dsnBomOptions(l.materialId)}</select>
      <input type="number" step="0.01" min="0" class="dsn-bom-qty" placeholder="Qty${_dsnBomMat(l.materialId) ? ' (' + _dsnUnitSuffix(_dsnBomMat(l.materialId)) + ')' : ''}" value="${l.qty != null ? l.qty : ''}">
      <span class="dsn-bom-eff">${escHtml(_dsnVarEffectiveLabel(l))}</span>
      <button type="button" class="dsn-bom-remove" title="Remove line">✕</button>
    </div>`).join('') || '<div class="dsn-bom-note">No materials yet for this variation.</div>';

  wrap.querySelectorAll('.dsn-bom-row').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    const sel = row.querySelector('.dsn-bom-mat');
    const qtyEl = row.querySelector('.dsn-bom-qty');
    sel.addEventListener('change', () => {
      dsnVarBomSyncFromDom();
      const m = _dsnBomMat(sel.value);
      if (m) qtyEl.placeholder = 'Qty (' + _dsnUnitSuffix(m) + ')';
      dsnVarBomRecalcEffective();
    });
    qtyEl.addEventListener('input', () => { dsnVarBomSyncFromDom(); dsnVarBomRecalcEffective(); });
    row.querySelector('.dsn-bom-remove').addEventListener('click', () => {
      dsnVarBomSyncFromDom();
      _dsnVarBom.splice(idx, 1);
      _dsnVarBomRender();
    });
  });
  dsnVariantModalRollupRender();
}

function dsnVarBomSyncFromDom() {
  document.querySelectorAll('#dsn-var-bom-rows .dsn-bom-row').forEach(row => {
    const l = _dsnVarBom[parseInt(row.dataset.idx, 10)];
    if (!l) return;
    l.materialId = row.querySelector('.dsn-bom-mat').value;
    const q = parseFloat(row.querySelector('.dsn-bom-qty').value);
    l.qty = isNaN(q) ? null : q;
  });
}

function dsnVarBomRecalcEffective() {
  document.querySelectorAll('#dsn-var-bom-rows .dsn-bom-row').forEach(row => {
    const l = _dsnVarBom[parseInt(row.dataset.idx, 10)];
    const eff = row.querySelector('.dsn-bom-eff');
    if (l && eff) eff.textContent = _dsnVarEffectiveLabel(l);
  });
  dsnVariantModalRollupRender();
}

// ── Variant modal: Square link picker (mirrors the main design's) ──
function dsnVarSqLinkRender() {
  const linked = document.getElementById('dsn-var-sq-linked');
  const search = document.getElementById('dsn-var-sq-search-wrap');
  if (!linked || !search) return;
  if (_dsnVarLinkedSq) {
    linked.style.display = '';
    search.style.display = 'none';
    document.getElementById('dsn-var-sq-linked-name').textContent = _dsnVarLinkedSq.name;
  } else {
    linked.style.display = 'none';
    search.style.display = '';
    const inp = document.getElementById('dsn-var-sq-search');
    if (inp) inp.value = '';
    const res = document.getElementById('dsn-var-sq-results');
    if (res) res.style.display = 'none';
  }
}

function dsnVarSqSearchInput(q) {
  clearTimeout(_dsnVarSqSearchTimer);
  const res = document.getElementById('dsn-var-sq-results');
  if (!q || q.trim().length < 2) { if (res) res.style.display = 'none'; return; }
  _dsnVarSqSearchTimer = setTimeout(() => _dsnVarSqSearchRun(q.trim()), 350);
}

function _dsnVarSqSearchRun(q) {
  const res = document.getElementById('dsn-var-sq-results');
  if (!res) return;
  res.style.display = '';
  res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Searching Square…</div>';
  fetch('/api/square', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/v2/catalog/search-catalog-items', method: 'POST', body: { text_filter: q, limit: 10 } }),
  })
    .then(r => r.json())
    .then(data => {
      const out = [];
      (data.items || []).forEach(item => {
        const nm = (item.item_data && item.item_data.name) || '';
        ((item.item_data && item.item_data.variations) || []).forEach(v => {
          const vd = v.item_variation_data || {};
          const label = nm + (vd.name && vd.name !== 'Regular' ? ' — ' + vd.name : '');
          const price = vd.price_money ? vd.price_money.amount / 100 : null;
          out.push({ id: v.id, label, price });
        });
      });
      if (!out.length) { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">No Square items found</div>'; return; }
      res.innerHTML = out.map(o =>
        `<button type="button" class="dsn-sq-result" onclick="dsnVarSqLink('${o.id}','${escHtml(o.label).replace(/'/g, '&#39;')}',${o.price != null ? o.price : 'null'})">${escHtml(o.label)}${o.price != null ? ' <span class="dsn-ru-dim">$' + o.price.toFixed(2) + '</span>' : ''}</button>`
      ).join('');
    })
    .catch(() => { res.innerHTML = '<div class="dsn-sq-result dsn-ru-dim">Square search failed</div>'; });
}

function dsnVarSqLink(id, label, price) {
  _dsnVarLinkedSq = { id, name: label };
  if (price != null) _dsnSqPrices[id] = price;
  const labelInput = document.getElementById('dsn-var-label');
  if (labelInput) labelInput.value = label;
  dsnVarSqLinkRender();
  _dsnLoadSqPrices([id]).then(dsnVariantModalRollupRender);
  dsnVariantModalRollupRender();
}

function dsnVarSqUnlink() {
  _dsnVarLinkedSq = null;
  dsnVarSqLinkRender();
  dsnVariantModalRollupRender();
}

function dsnVariantModalRollupRender() {
  const el = document.getElementById('dsn-var-rollup');
  if (!el) return;
  if (_designsMaterials === null) { el.innerHTML = '<div class="dsn-bom-note">Loading cost data…</div>'; return; }
  const snapshot = {
    bom: _dsnVarBom.filter(l => l.materialId && l.qty > 0),
    wasteOverridePct: _dsnNumOrNull(document.getElementById('dsn-var-waste').value),
    squareItemId: _dsnVarLinkedSq ? _dsnVarLinkedSq.id : null,
    retailPriceOverride: _dsnNumOrNull(document.getElementById('dsn-var-retail-ov').value),
    laborMinPerPieceOverride: _dsnNumOrNull(document.getElementById('dsn-var-labor-ov').value),
  };
  const r = dsnCostRollup(snapshot);
  if (!r.hasBom && r.laborCost == null) {
    el.innerHTML = '<div class="dsn-bom-note">⚖ Add materials above to see this variation\'s piece cost.</div>';
    return;
  }
  el.innerHTML = _dsnRollupBoxHtml(r);
}

// ── Pricing Sheet view ─────────────────────────
function dsnPricingToggle() {
  _designsPricingOpen = !_designsPricingOpen;
  document.getElementById('designs-library').style.display = _designsPricingOpen ? 'none' : '';
  document.getElementById('designs-pricing').style.display = _designsPricingOpen ? '' : 'none';
  const btn = document.getElementById('dsn-pricing-btn');
  if (btn) btn.textContent = _designsPricingOpen ? '← Library' : '💲 Pricing Sheet';
  if (_designsPricingOpen) {
    // Inherit whichever family (if any) was drilled into in the Library view,
    // so "Pricing Sheet" opened from a family card lands pre-scoped to it.
    _designsPricingFamilyFilter = _designsFamilyOpen || null;
    dsnPricingRender();
  } else {
    designsRenderLibrary();
  }
}

// Jump straight to the Pricing Sheet, pre-scoped to one family — used by the
// "💲 Compare costs" link on a family card/drill-in bar.
function dsnPricingOpenForFamily(fam) {
  _designsPricingFamilyFilter = fam || null;
  _designsPricingOpen = true;
  document.getElementById('designs-library').style.display = 'none';
  document.getElementById('designs-pricing').style.display = '';
  const btn = document.getElementById('dsn-pricing-btn');
  if (btn) btn.textContent = '← Library';
  dsnPricingRender();
}

// Populate the family-scope <select> on the Pricing Sheet with every family
// that has 2+ members (families of 1 have nothing to compare).
function _dsnFamilyDropdownRefresh() {
  const sel = document.getElementById('dsn-ps-family');
  if (!sel) return;
  const counts = new Map();
  for (const d of _designs) {
    for (const f of _dsnFamiliesOf(d)) counts.set(f, (counts.get(f) || 0) + 1);
  }
  const fams = [...counts.keys()].filter(f => counts.get(f) > 1).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All designs</option>'
    + fams.map(f => `<option value="${escHtml(f)}">📁 ${escHtml(f)} (${counts.get(f)})</option>`).join('');
  sel.value = fams.includes(_designsPricingFamilyFilter) ? _designsPricingFamilyFilter : '';
  if (!fams.includes(_designsPricingFamilyFilter)) _designsPricingFamilyFilter = null;
}

function dsnPricingFamilyFilterChange() {
  const sel = document.getElementById('dsn-ps-family');
  _designsPricingFamilyFilter = (sel && sel.value) ? sel.value : null;
  dsnPricingRender();
}

function _dsnEnsureCostingData() {
  const p1 = (typeof _materialsApiFetch === 'function')
    ? _materialsApiFetch().then(ms => { _designsMaterials = ms.filter(m => m.active !== false); })
        .catch(() => { if (_designsMaterials === null) _designsMaterials = []; })
    : Promise.resolve();
  const p2 = fetch('/api/shop-settings').then(r => r.json())
    .then(s => { _shopSettings = (s && !s.error) ? s : {}; })
    .catch(() => { if (_shopSettings === null) _shopSettings = {}; });
  return Promise.all([p1, p2]);
}

async function dsnPricingRender(forceRefresh) {
  const body = document.getElementById('dsn-ps-body');
  if (!body) return;
  _dsnFamilyDropdownRefresh();
  body.innerHTML = '<tr><td colspan="7" class="oh-empty">Computing costs…</td></tr>';
  if (forceRefresh) { _dsnLabor = null; _dsnSqPrices = {}; _dsnSqFetchAttempted = new Set(); }
  await _dsnEnsureCostingData();
  await _dsnLoadLabor(forceRefresh);
  const sqIds = [];
  _designs.forEach(d => {
    if (d.squareItemId) sqIds.push(d.squareItemId);
    (d.variants || []).forEach(v => { if (v.squareItemId) sqIds.push(v.squareItemId); });
  });
  await _dsnLoadSqPrices(sqIds);

  const s = _shopSettings || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v != null ? v : ''; };
  setVal('dsn-set-rate',   s.shopHourlyRate);
  setVal('dsn-set-target', s.targetMarginPct);
  setVal('dsn-set-floor',  s.marginFloorPct);

  const scoped = _designsPricingFamilyFilter
    ? _designs.filter(d => _dsnFamiliesOf(d).includes(_designsPricingFamilyFilter))
    : _designs;
  const rows = [];
  scoped.forEach(d => { _dsnDesignEntries(d).forEach(e => rows.push({ d, e })); });
  const floor = typeof s.marginFloorPct === 'number' ? s.marginFloorPct : null;

  // Margin-erosion alert strip
  const alerts = rows.filter(x => floor != null && x.e.r.margin != null && x.e.r.margin * 100 < floor);
  const alertEl = document.getElementById('dsn-ps-alerts');
  if (alertEl) {
    alertEl.innerHTML = alerts.length
      ? `<div class="dsn-ps-alert">⚠ Below ${floor}% margin floor: `
        + alerts.map(x => `<strong>${escHtml(x.e.label)}</strong> (${(x.e.r.margin * 100).toFixed(0)}%)`).join(' · ')
        + '</div>'
      : '';
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="oh-empty">${_designsPricingFamilyFilter ? 'No designs in this family.' : 'No designs yet.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(x => {
    const { d, e } = x;
    const r = e.r;
    const bad = floor != null && r.margin != null && r.margin * 100 < floor;
    const marginTxt = r.margin != null ? (r.margin * 100).toFixed(0) + '%' : '—';
    const flags = [];
    if (!r.hasBom) flags.push('⚖ not weighed');
    if (r.matMissing) flags.push('missing price');
    if (r.laborCost == null) flags.push('no labor data');
    return `<tr class="${bad ? 'dsn-ps-bad' : ''} ${e.isVariant ? 'dsn-ps-variant' : ''}" onclick="designsShowForm('${d.id}')" style="cursor:pointer">`
      + `<td>${e.isVariant ? '↳ ' : ''}${escHtml(e.label)}</td>`
      + `<td>${r.hasBom ? _dsnMoney(r.matCost) : '—'}</td>`
      + `<td>${_dsnMoney(r.laborCost)}</td>`
      + `<td>${_dsnMoney(r.pieceCost)}</td>`
      + `<td>${_dsnMoney(r.retail)}</td>`
      + `<td>${marginTxt}${bad ? ' ⚠' : ''}</td>`
      + `<td class="dsn-ru-dim">${r.suggested != null ? _dsnMoney(r.suggested) : ''}${flags.length ? (r.suggested != null ? ' · ' : '') + flags.join(' · ') : ''}</td>`
      + '</tr>';
  }).join('');
}

async function dsnPricingSettingsSave() {
  const s = Object.assign({}, _shopSettings || {});
  s.shopHourlyRate  = _dsnNumOrNull(document.getElementById('dsn-set-rate').value);
  s.targetMarginPct = _dsnNumOrNull(document.getElementById('dsn-set-target').value);
  s.marginFloorPct  = _dsnNumOrNull(document.getElementById('dsn-set-floor').value);
  try {
    const r = await fetch('/api/shop-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    _shopSettings = s;
    toast('Pricing settings saved', '✓');
    dsnPricingRender();
  } catch (e) {
    toast('Save failed — ' + (e.message || e), '❌');
  }
}

function dsnPricingExport() {
  const scoped = _designsPricingFamilyFilter
    ? _designs.filter(d => _dsnFamiliesOf(d).includes(_designsPricingFamilyFilter))
    : _designs;
  const rows = [];
  scoped.forEach(d => { _dsnDesignEntries(d).forEach(e => rows.push({ d, e })); });
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const money = v => (v != null ? v.toFixed(2) : '');
  const csv = [
    ['Design', 'Category', 'Material Cost', 'Labor Cost', 'Piece Cost', 'Retail', 'Margin %', 'Suggested Price', 'Flags'].map(esc).join(','),
  ].concat(rows.map(({ d, e }) => { const r = e.r; return [
    e.label, d.category || '',
    r.hasBom ? money(r.matCost) : '', money(r.laborCost), money(r.pieceCost), money(r.retail),
    r.margin != null ? (r.margin * 100).toFixed(1) : '',
    money(r.suggested),
    [!r.hasBom ? 'not weighed' : '', r.matMissing ? 'missing material price' : '', r.laborCost == null ? 'no labor data' : ''].filter(Boolean).join('; '),
  ].map(esc).join(','); })).join('\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const famSlug = _designsPricingFamilyFilter ? '-' + _designsPricingFamilyFilter.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';
  a.download = 'pricing-sheet' + famSlug + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
