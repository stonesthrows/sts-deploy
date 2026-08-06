// ════════════════════════════════════════════
//  DESIGN VECTORS  —  js/design-vectors.js
//  The "Vector Files" view of the Design Library tab: browse and read the
//  Illustrator artwork that lives on disk (the Spirit Animals folder on
//  the Google Drive mount) without leaving the app.
//
//  How it reads the files
//    The folder is opened once through the File System Access API
//    (showDirectoryPicker). The returned handle is kept in IndexedDB, so
//    the next visit only needs a permission click, not another picker.
//    Nothing is uploaded or copied — every read goes straight to disk, so
//    the view always shows what Illustrator last saved.
//
//  How it draws them
//    An .ai file saved with "Create PDF Compatible File" (Illustrator's
//    default) *is* a PDF — it starts with %PDF — so pdf.js renders it as-is,
//    no conversion step. Files saved without that option have no readable
//    preview; the viewer says so rather than failing silently. .svg and
//    ordinary images render as themselves.
//
//  Browsers without the picker (Safari, iPad) fall back to an ordinary file
//  input: no folder browsing, but the viewer still opens what you hand it.
// ════════════════════════════════════════════

const DVEC_ROOT_KEY  = 'dvec-root-handle';
const DVEC_VECTOR_EXT = new Set(['ai', 'pdf', 'svg', 'eps', 'dxf']);
const DVEC_IMAGE_EXT  = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
// pdf.js reads these directly; everything else is listed but not previewable.
const DVEC_PDFISH     = new Set(['ai', 'pdf']);
const DVEC_SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

let _dvecOpen     = false;   // is the Vector Files view showing?
let _dvecRoot     = null;    // FileSystemDirectoryHandle for the picked folder
let _dvecNodes    = null;    // Map path → folder node
let _dvecFiles    = [];      // flat index of every file, for search
let _dvecCwd      = '';      // current folder path ('' = root)
let _dvecSearch   = '';
let _dvecFilter   = 'vector';// vector | image | all
let _dvecExpanded = new Set();
let _dvecLoose    = [];      // files opened through the fallback input
let _dvecThumbs   = new Map(); // path → data URL (session cache)
let _dvecThumbObs = null;
let _dvecThumbQ   = [];
let _dvecThumbRun = 0;
let _dvecView     = null;    // open viewer: { entry, pdf, page, pages, scale, fit, url }
let _dvecKeyBound = false;

// ── View plumbing ───────────────────────────────────────────

function dvecToggle() {
  if (_dvecOpen) { designsShowLibrary(); return; }
  dvecShow();
}

function dvecShow() {
  _dvecOpen = true;
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  hide('designs-library'); hide('designs-pricing');
  hide('designs-form-wrap'); hide('designs-guide-wrap');
  const wrap = document.getElementById('designs-vectors');
  if (wrap) wrap.style.display = '';
  const btn = document.getElementById('dsn-vectors-btn');
  if (btn) btn.textContent = '← Library';
  const pricingBtn = document.getElementById('dsn-pricing-btn');
  if (pricingBtn) pricingBtn.style.display = 'none';
  const newBtn = document.getElementById('dsn-new-btn');
  if (newBtn) newBtn.style.display = 'none';
  const folderBtn = document.getElementById('dsn-folder-btn');
  if (folderBtn) folderBtn.style.display = 'none';
  _dvecBindKeys();
  _dvecBindClicks();
  dvecRestore();
}

// Called by designsShowLibrary/Form/Guide so the vector view never survives
// a switch to another Design Library view. Button *visibility* stays with
// the caller — it's the one that knows which page-bar buttons its view wants.
function dvecHide() {
  _dvecOpen = false;
  const wrap = document.getElementById('designs-vectors');
  if (wrap) wrap.style.display = 'none';
  const btn = document.getElementById('dsn-vectors-btn');
  if (btn) btn.textContent = '🖋 Vector Files';
  dvecViewerClose();
}

function _dvecSupported() { return typeof window.showDirectoryPicker === 'function'; }

// ── Connecting the folder ───────────────────────────────────

// Re-attach to the folder picked on a previous visit. Chrome keeps the
// handle but drops the permission grant between sessions, so a handle we
// can't read yet becomes a one-click "Reconnect" rather than a re-pick.
async function dvecRestore() {
  if (_dvecNodes) { _dvecRender(); return; }
  if (_dvecLoose.length) { _dvecRenderLoose(); return; }
  if (!_dvecSupported()) { _dvecRenderConnect('unsupported'); return; }
  let handle = null;
  try { handle = await stsStoreGet(DVEC_ROOT_KEY); } catch (e) { handle = null; }
  if (!handle || typeof handle.getDirectoryHandle !== 'function') { _dvecRenderConnect('none'); return; }
  _dvecRoot = handle;
  if (await _dvecPerm(handle, false)) { await _dvecBuildIndex(); return; }
  _dvecRenderConnect('locked');
}

async function _dvecPerm(handle, request) {
  if (!handle || typeof handle.queryPermission !== 'function') return true;
  const opts = { mode: 'read' };
  try {
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (!request) return false;
    return await handle.requestPermission(opts) === 'granted';
  } catch (e) { return false; }
}

// "Reconnect" — needs a user gesture, which is why it isn't done on restore.
async function dvecReconnect() {
  if (!_dvecRoot) { dvecPickFolder(); return; }
  if (await _dvecPerm(_dvecRoot, true)) { await _dvecBuildIndex(); return; }
  toast('Folder access was declined', '⚠');
}

async function dvecPickFolder() {
  if (!_dvecSupported()) {
    // No folder picker here — fall back to picking files, which is the only
    // thing this button could usefully do on an iPad.
    const input = document.getElementById('dvec-loose-input');
    if (input) input.click();
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'sts-vectors', mode: 'read' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // user closed the picker
    toast('Could not open that folder: ' + (e.message || e), '⚠');
    return;
  }
  _dvecRoot   = handle;
  _dvecCwd    = '';
  _dvecThumbs.clear();
  try { await stsStoreSet(DVEC_ROOT_KEY, handle); } catch (e) { /* handle still works this session */ }
  await _dvecBuildIndex();
}

async function dvecForget() {
  if (!confirm('Forget this folder? Nothing on disk is touched — you’ll just have to pick it again.')) return;
  _dvecRoot = null; _dvecNodes = null; _dvecFiles = []; _dvecCwd = ''; _dvecThumbs.clear();
  try { await stsStoreDel(DVEC_ROOT_KEY); } catch (e) {}
  _dvecRenderConnect('none');
}

function dvecRefresh() {
  if (!_dvecRoot) return;
  _dvecThumbs.clear();
  _dvecBuildIndex();
}

// ── Indexing ────────────────────────────────────────────────

// Walks the whole tree once. The artwork folder is a few hundred files, so
// a full index costs a moment on connect and buys instant search after.
async function _dvecBuildIndex() {
  const grid = document.getElementById('dvec-body');
  if (grid) grid.innerHTML = '<div class="dvec-empty">⏳ Reading folder…</div>';
  const connect = document.getElementById('dvec-connect');
  if (connect) connect.style.display = 'none';
  const browse = document.getElementById('dvec-browse');
  if (browse) browse.style.display = '';

  _dvecNodes = new Map();
  _dvecFiles = [];
  const root = { name: _dvecRoot.name || 'Folder', path: '', handle: _dvecRoot, dirs: [], files: [] };
  _dvecNodes.set('', root);
  try {
    await _dvecWalk(root, 0);
  } catch (e) {
    _dvecNodes = null;
    _dvecRenderConnect('error', e && e.message);
    return;
  }
  _dvecExpanded.add('');
  if (!_dvecNodes.has(_dvecCwd)) _dvecCwd = '';
  _dvecRender();
}

async function _dvecWalk(node, depth) {
  if (depth > 8) return;                       // artwork trees don't nest this deep
  for await (const [name, handle] of node.handle.entries()) {
    if (name.startsWith('.') || DVEC_SKIP_NAMES.has(name.toLowerCase())) continue;
    const path = node.path ? node.path + '/' + name : name;
    if (handle.kind === 'directory') {
      const child = { name, path, handle, dirs: [], files: [], parent: node.path };
      _dvecNodes.set(path, child);
      node.dirs.push(child);
      await _dvecWalk(child, depth + 1);
    } else {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      const entry = { name, ext, path, handle, dir: node.path, dirName: node.name };
      node.files.push(entry);
      _dvecFiles.push(entry);
    }
  }
  node.dirs.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
}

function _dvecKind(ext) {
  if (DVEC_VECTOR_EXT.has(ext)) return 'vector';
  if (DVEC_IMAGE_EXT.has(ext))  return 'image';
  return 'other';
}

function _dvecPassesFilter(entry) {
  if (_dvecFilter === 'all') return true;
  return _dvecKind(entry.ext) === _dvecFilter;
}

// ── Rendering ───────────────────────────────────────────────

function _dvecRenderConnect(state, detail) {
  const browse = document.getElementById('dvec-browse');
  if (browse) browse.style.display = 'none';
  const wrap = document.getElementById('dvec-connect');
  if (!wrap) return;
  wrap.style.display = '';
  const looseBtn = `
    <label class="btn btn-outline btn-sm dvec-file-btn">📄 Open files…
      <input type="file" multiple accept=".ai,.pdf,.svg,image/*" style="display:none"
             onchange="dvecOpenLoose(this.files);this.value=''">
    </label>`;
  if (state === 'unsupported') {
    wrap.innerHTML = `
      <div class="dvec-connect-card">
        <div class="dvec-connect-icon">🖋</div>
        <div class="dvec-connect-title">Folder browsing needs Chrome or Edge</div>
        <div class="dvec-connect-body">This browser can’t open a folder directly. You can still
          open individual <strong>.ai</strong>, <strong>.pdf</strong> and <strong>.svg</strong> files and read them here.</div>
        <div class="dvec-connect-actions">${looseBtn}</div>
      </div>`;
    return;
  }
  if (state === 'locked') {
    wrap.innerHTML = `
      <div class="dvec-connect-card">
        <div class="dvec-connect-icon">🔒</div>
        <div class="dvec-connect-title">Reconnect “${esc(_dvecRoot && _dvecRoot.name || 'folder')}”</div>
        <div class="dvec-connect-body">The browser drops folder access between sessions. One click restores it — the folder is remembered.</div>
        <div class="dvec-connect-actions">
          <button class="btn btn-gold btn-sm" onclick="dvecReconnect()">🔓 Reconnect</button>
          <button class="btn btn-outline btn-sm" onclick="dvecPickFolder()">📂 Pick a different folder</button>
          <button class="btn btn-outline btn-sm" onclick="dvecForget()">✕ Forget</button>
        </div>
      </div>`;
    return;
  }
  if (state === 'error') {
    wrap.innerHTML = `
      <div class="dvec-connect-card">
        <div class="dvec-connect-icon">⚠</div>
        <div class="dvec-connect-title">Couldn’t read that folder</div>
        <div class="dvec-connect-body">${esc(detail || 'Unknown error')}</div>
        <div class="dvec-connect-actions">
          <button class="btn btn-gold btn-sm" onclick="dvecPickFolder()">📂 Choose folder</button>
        </div>
      </div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="dvec-connect-card">
      <div class="dvec-connect-icon">📂</div>
      <div class="dvec-connect-title">Point this at your artwork folder</div>
      <div class="dvec-connect-body">Pick the folder your Illustrator files live in — <em>Spirit Animals</em>, say —
        and it stays picked. Files are read straight from disk: nothing is uploaded, nothing is copied,
        and saving in Illustrator updates what you see here.</div>
      <div class="dvec-connect-actions">
        <button class="btn btn-gold btn-sm" onclick="dvecPickFolder()">📂 Choose folder</button>
        ${looseBtn}
      </div>
    </div>`;
}

function _dvecRender() {
  const connect = document.getElementById('dvec-connect');
  if (connect) connect.style.display = 'none';
  const browse = document.getElementById('dvec-browse');
  if (browse) { browse.style.display = ''; browse.classList.remove('loose'); }
  _dvecRenderRail();
  _dvecRenderCrumb();
  _dvecRenderBody();
}

function _dvecRenderRail() {
  const rail = document.getElementById('dvec-rail');
  if (!rail) return;
  if (!_dvecNodes) { rail.innerHTML = ''; return; }
  // Keep every ancestor of the open folder expanded so it's always visible.
  let p = _dvecCwd;
  while (p) { _dvecExpanded.add(p); p = p.slice(0, p.lastIndexOf('/') > 0 ? p.lastIndexOf('/') : 0); }
  const out = [];
  const walk = (node, depth) => {
    const open   = _dvecExpanded.has(node.path);
    const active = node.path === _dvecCwd;
    const count  = node.files.filter(_dvecPassesFilter).length;
    out.push(`
      <div class="dvec-rail-row${active ? ' active' : ''}" style="padding-left:${6 + depth * 12}px">
        <button type="button" class="dvec-rail-twist${node.dirs.length ? '' : ' empty'}"
                data-dvec-twist="${esc(node.path)}"
                aria-label="${open ? 'Collapse' : 'Expand'}">${node.dirs.length ? (open ? '▾' : '▸') : '·'}</button>
        <button type="button" class="dvec-rail-name" data-dvec-go="${esc(node.path)}">
          <span class="dvec-rail-label">${esc(node.name)}</span>
          ${count ? `<span class="dvec-rail-count">${count}</span>` : ''}
        </button>
      </div>`);
    if (open) node.dirs.forEach(d => walk(d, depth + 1));
  };
  walk(_dvecNodes.get(''), 0);
  rail.innerHTML = out.join('');
}

function _dvecRenderCrumb() {
  const el = document.getElementById('dvec-crumb');
  if (!el) return;
  if (!_dvecNodes) { el.innerHTML = ''; return; }
  const parts = _dvecCwd ? _dvecCwd.split('/') : [];
  const root  = _dvecNodes.get('');
  const bits  = [`<button type="button" class="dvec-crumb-bit" data-dvec-go="">${esc(root.name)}</button>`];
  let acc = '';
  parts.forEach(p => {
    acc = acc ? acc + '/' + p : p;
    bits.push('<span class="dvec-crumb-sep">/</span>');
    bits.push(`<button type="button" class="dvec-crumb-bit" data-dvec-go="${esc(acc)}">${esc(p)}</button>`);
  });
  el.innerHTML = bits.join('');
}

function _dvecRenderBody() {
  const body = document.getElementById('dvec-body');
  if (!body) return;
  _dvecThumbTeardown();

  const q = _dvecSearch.trim().toLowerCase();
  let folders = [], files = [], searching = !!q;

  if (_dvecLoose.length && !_dvecNodes) {
    files = _dvecLoose.filter(e => !q || e.name.toLowerCase().includes(q));
  } else if (searching) {
    // Match on the whole path so "fox pendant" finds Fox/Pendants/… .
    const terms = q.split(/\s+/);
    files = _dvecFiles.filter(e => _dvecPassesFilter(e) &&
      terms.every(t => e.path.toLowerCase().includes(t)));
  } else {
    const node = _dvecNodes && _dvecNodes.get(_dvecCwd);
    if (!node) { body.innerHTML = '<div class="dvec-empty">Folder is gone — try ↻ Refresh.</div>'; return; }
    folders = node.dirs;
    files   = node.files.filter(_dvecPassesFilter);
  }

  const countEl = document.getElementById('dvec-count');
  if (countEl) {
    countEl.textContent = searching
      ? `${files.length} match${files.length === 1 ? '' : 'es'}`
      : `${files.length} file${files.length === 1 ? '' : 's'}${folders.length ? ` · ${folders.length} folder${folders.length === 1 ? '' : 's'}` : ''}`;
  }

  const out = [];
  if (folders.length) {
    out.push('<div class="dvec-folders">');
    folders.forEach(d => {
      const n = _dvecCountDeep(d);
      out.push(`
        <button type="button" class="dvec-folder" data-dvec-go="${esc(d.path)}">
          <span class="dvec-folder-icon">📁</span>
          <span class="dvec-folder-name">${esc(d.name)}</span>
          <span class="dvec-folder-count">${n}</span>
        </button>`);
    });
    out.push('</div>');
  }
  if (!files.length) {
    out.push(`<div class="dvec-empty">${searching
      ? 'Nothing matches that.'
      : (folders.length ? 'No files here — open a folder above.' : 'This folder is empty.')}</div>`);
  } else {
    out.push('<div class="dvec-grid">');
    files.forEach(e => {
      const sub = searching && _dvecNodes ? esc(e.dir || _dvecNodes.get('').name) : '';
      out.push(`
        <button type="button" class="dvec-card" data-dvec-open="${esc(e.path)}">
          <span class="dvec-thumb" data-dvec-path="${esc(e.path)}"><span class="dvec-thumb-ext">${esc(e.ext.toUpperCase() || 'FILE')}</span></span>
          <span class="dvec-card-name" title="${esc(e.path)}">${esc(_dvecStem(e.name))}</span>
          ${sub ? `<span class="dvec-card-sub">${sub}</span>` : ''}
        </button>`);
    });
    out.push('</div>');
  }
  body.innerHTML = out.join('');
  _dvecThumbSetup();
}

function _dvecStem(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

// Files in this folder and everything under it, after the current filter.
function _dvecCountDeep(node) {
  let n = node.files.filter(_dvecPassesFilter).length;
  node.dirs.forEach(d => { n += _dvecCountDeep(d); });
  return n;
}

function dvecGo(path) {
  _dvecCwd = path;
  if (_dvecSearch) { _dvecSearch = ''; const s = document.getElementById('dvec-search'); if (s) s.value = ''; }
  _dvecExpanded.add(path);
  _dvecRender();
}

function dvecToggleExpand(path) {
  if (_dvecExpanded.has(path)) _dvecExpanded.delete(path); else _dvecExpanded.add(path);
  _dvecRenderRail();
}

function dvecSetSearch(v) {
  _dvecSearch = v || '';
  const clear = document.getElementById('dvec-search-clear');
  if (clear) clear.style.display = _dvecSearch ? '' : 'none';
  _dvecRenderBody();
}

function dvecClearSearch() {
  const s = document.getElementById('dvec-search');
  if (s) s.value = '';
  dvecSetSearch('');
}

function dvecSetFilter(f) {
  _dvecFilter = f;
  document.querySelectorAll('.dvec-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dvecFilter === f);
  });
  _dvecRender();
}

// Fallback path: files handed over by the file input, with no folder behind them.
function dvecOpenLoose(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  _dvecLoose = files.map((f, i) => {
    const dot = f.name.lastIndexOf('.');
    return {
      name: f.name,
      ext:  dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '',
      path: 'loose:' + i + ':' + f.name,
      file: f, dir: '', loose: true
    };
  });
  _dvecRenderLoose();
  if (_dvecLoose.length === 1) dvecOpenEntry(_dvecLoose[0].path);
}

// The loose-file shell. Kept apart from _dvecRender() so re-entering the
// view still finds the files that were opened earlier.
function _dvecRenderLoose() {
  const connect = document.getElementById('dvec-connect');
  if (connect) connect.style.display = 'none';
  const browse = document.getElementById('dvec-browse');
  // No folder behind these files, so no tree to rail off and nothing the
  // type filter could usefully hide — the user already chose the files.
  if (browse) { browse.style.display = ''; browse.classList.add('loose'); }
  const rail = document.getElementById('dvec-rail');
  if (rail) rail.innerHTML = '';
  const crumb = document.getElementById('dvec-crumb');
  if (crumb) crumb.innerHTML = '<span class="dvec-crumb-bit">Opened files</span>';
  _dvecRenderBody();
}

// ── Reading a file off disk ─────────────────────────────────

function _dvecEntry(path) {
  const loose = _dvecLoose.find(e => e.path === path);
  if (loose) return loose;
  return _dvecFiles.find(e => e.path === path) || null;
}

async function _dvecFileOf(entry) {
  if (entry.file) return entry.file;
  // Attachments live in R2, not the picked folder — fetch once, then the
  // entry behaves like any other loose file (viewer, zoom, save a copy).
  if (entry.url) {
    entry.file = await dvecFetchAsFile(entry.url, entry.name);
    return entry.file;
  }
  return await entry.handle.getFile();
}

// Shared with the Design Library's own attachment gallery (designs.js),
// which needs the same R2 file → File conversion to build PDF thumbnails.
async function dvecFetchAsFile(url, name) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not fetch that file (${resp.status})`);
  const blob = await resp.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

// ── Thumbnails ──────────────────────────────────────────────
// Rendered lazily as cards scroll in, two at a time — a full folder of
// Illustrator files is a lot of pdf.js work to start at once.

function _dvecThumbTeardown() {
  if (_dvecThumbObs) { _dvecThumbObs.disconnect(); _dvecThumbObs = null; }
  _dvecThumbQ = [];
}

function _dvecThumbSetup() {
  const holders = document.querySelectorAll('#dvec-body .dvec-thumb');
  if (!holders.length) return;
  if (!('IntersectionObserver' in window)) {
    holders.forEach(h => _dvecThumbQueue(h));
    return;
  }
  _dvecThumbObs = new IntersectionObserver((entries, obs) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      obs.unobserve(en.target);
      _dvecThumbQueue(en.target);
    });
  }, { rootMargin: '300px' });
  holders.forEach(h => _dvecThumbObs.observe(h));
}

function _dvecThumbQueue(holder) {
  const path = holder.dataset.dvecPath;
  const cached = _dvecThumbs.get(path);
  if (cached === 'none') { holder.classList.add('no-preview'); return; }
  if (cached) { _dvecThumbPaint(holder, cached); return; }
  _dvecThumbQ.push(holder);
  _dvecThumbPump();
}

function _dvecThumbPump() {
  while (_dvecThumbRun < 2 && _dvecThumbQ.length) {
    const holder = _dvecThumbQ.shift();
    _dvecThumbRun++;
    _dvecThumbMake(holder)
      .catch(() => {})
      .then(() => { _dvecThumbRun--; _dvecThumbPump(); });
  }
}

function _dvecThumbPaint(holder, url) {
  if (!holder.isConnected) return;
  holder.classList.add('has-img');
  holder.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
}

async function _dvecThumbMake(holder) {
  const path  = holder.dataset.dvecPath;
  const entry = _dvecEntry(path);
  if (!entry) return;
  const kindPdf = DVEC_PDFISH.has(entry.ext);
  const kindImg = DVEC_IMAGE_EXT.has(entry.ext) || entry.ext === 'svg';
  if (!kindPdf && !kindImg) { _dvecThumbs.set(path, 'none'); holder.classList.add('no-preview'); return; }

  holder.classList.add('loading');
  try {
    const file = await _dvecFileOf(entry);
    let url;
    if (kindPdf) {
      url = await _dvecRenderPdfThumb(file);
    } else {
      url = await _dvecRenderImgThumb(file);
    }
    if (!url) throw new Error('no preview');
    _dvecThumbs.set(path, url);
    holder.classList.remove('loading');
    _dvecThumbPaint(holder, url);
  } catch (e) {
    _dvecThumbs.set(path, 'none');
    holder.classList.remove('loading');
    holder.classList.add('no-preview');
  }
}

const DVEC_THUMB_W = 260;
const DVEC_THUMB_H = 200;

// A pendant drawn 20mm across sits on a letter artboard, so a straight
// page render is a card of white with a speck in it. Probe the page small,
// find where the ink actually is, then render just that box.
async function _dvecRenderPdfThumb(file) {
  const lib = window.pdfjsLib;
  if (!lib) return null;
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  try {
    const page  = await pdf.getPage(1);
    const base  = page.getViewport({ scale: 1 });
    const probe = Math.min(180 / base.width, 180 / base.height, 1);
    const box   = await _dvecInkBox(page, probe > 0 ? probe : 1);
    // Nothing but white — fall back to the whole page rather than an empty crop.
    const view = box || { x: 0, y: 0, w: base.width, h: base.height };
    const scale = Math.min(DVEC_THUMB_W / view.w, DVEC_THUMB_H / view.h, 8);
    const vp = page.getViewport({
      scale, offsetX: -view.x * scale, offsetY: -view.y * scale,
    });
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.ceil(view.w * scale));
    canvas.height = Math.max(1, Math.ceil(view.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';                   // artwork is drawn for white paper
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    try { pdf.destroy(); } catch (e) {}
  }
}

// Bounding box of the non-white pixels, returned in scale-1 viewport units
// with a little air around it. Null when the page renders blank.
async function _dvecInkBox(page, scale) {
  const vp = page.getViewport({ scale });
  const w = Math.max(1, Math.ceil(vp.width)), h = Math.max(1, Math.ceil(vp.height));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) * 0.04));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return {
    x: x0 / scale, y: y0 / scale,
    w: Math.max(1, (x1 - x0 + 1) / scale),
    h: Math.max(1, (y1 - y0 + 1) / scale),
  };
}

function _dvecRenderImgThumb(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(260 / img.width, 200 / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('image failed')); };
    img.src = src;
  });
}

// ── Viewer ──────────────────────────────────────────────────

async function dvecOpenEntry(path) {
  const entry = _dvecEntry(path);
  if (!entry) { toast('That file is no longer in the folder', '⚠'); return; }
  return dvecOpenFile(entry);
}

// Open a file the folder browser doesn't own — a design's attachment, held
// in R2 and named by URL. Same viewer, so a PDF attached to a design reads
// exactly like an .ai from the artwork folder.
function dvecOpenUrl(url, name, subtitle) {
  _dvecBindKeys();
  return dvecOpenFile({
    name,
    ext:  (name.split('.').pop() || '').toLowerCase(),
    path: url,
    dir:  subtitle || '',
    url,
  });
}

async function dvecOpenFile(entry) {
  const overlay = document.getElementById('dvec-viewer');
  if (!overlay) return;
  dvecViewerClose();
  _dvecView = { entry, pdf: null, page: 1, pages: 1, scale: 1, fit: true, url: null };
  overlay.style.display = 'flex';
  document.body.classList.add('dvec-viewer-open');
  _dvecViewerHead();
  const stage = document.getElementById('dvec-stage');
  stage.innerHTML = '<div class="dvec-stage-msg">⏳ Opening…</div>';

  try {
    const file = await _dvecFileOf(entry);
    if (DVEC_PDFISH.has(entry.ext)) {
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('PDF reader not loaded');
      const buf = await file.arrayBuffer();
      const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      if (!_dvecView || _dvecView.entry !== entry) { try { pdf.destroy(); } catch (e) {} return; }
      _dvecView.pdf   = pdf;
      _dvecView.pages = pdf.numPages;
      stage.innerHTML = '<canvas id="dvec-canvas" class="dvec-canvas"></canvas>';
      await _dvecViewerDraw();
    } else if (entry.ext === 'svg' || DVEC_IMAGE_EXT.has(entry.ext)) {
      const url = URL.createObjectURL(file);
      _dvecView.url = url;
      stage.innerHTML = `<img id="dvec-img" class="dvec-img" src="${url}" alt="${esc(entry.name)}">`;
      const img = document.getElementById('dvec-img');
      img.onerror = () => { stage.innerHTML = _dvecNoPreview(entry, 'That file wouldn’t render as an image.'); };
    } else {
      stage.innerHTML = _dvecNoPreview(entry, 'No preview for .' + esc(entry.ext) + ' files.');
    }
  } catch (e) {
    const broken = /pdf|password|structure|invalid/i.test(e && e.message || '');
    const msg = broken && entry.ext === 'ai'
      ? 'This .ai file has no PDF preview inside it — re-save it from Illustrator with “Create PDF Compatible File” ticked and it will open here.'
      : broken
        ? 'That file wouldn’t open as a PDF — it may be damaged or password-protected.'
        : ('Couldn’t read the file: ' + esc(e && e.message || e));
    stage.innerHTML = _dvecNoPreview(entry, msg);
  }
  _dvecViewerHead();
}

function _dvecNoPreview(entry, msg) {
  return `
    <div class="dvec-stage-msg">
      <div class="dvec-stage-icon">🖋</div>
      <div class="dvec-stage-title">${esc(entry.name)}</div>
      <div class="dvec-stage-body">${msg}</div>
      <button class="btn btn-outline btn-sm" onclick="dvecViewerSave()">⬇ Save a copy</button>
    </div>`;
}

function _dvecViewerHead() {
  const v = _dvecView;
  const nameEl = document.getElementById('dvec-v-name');
  const pathEl = document.getElementById('dvec-v-path');
  const pageEl = document.getElementById('dvec-v-page');
  const zoomEl = document.getElementById('dvec-v-zoom');
  if (!v) return;
  if (nameEl) nameEl.textContent = v.entry.name;
  if (pathEl) pathEl.textContent = v.entry.loose ? '' : (v.entry.dir || '');
  if (pageEl) {
    pageEl.style.display = v.pages > 1 ? '' : 'none';
    pageEl.textContent = `${v.page} / ${v.pages}`;
  }
  const nav = document.getElementById('dvec-v-nav');
  if (nav) nav.style.display = v.pages > 1 ? '' : 'none';
  if (zoomEl) zoomEl.textContent = v.fit ? 'Fit' : Math.round(v.scale * 100) + '%';
}

async function _dvecViewerDraw() {
  const v = _dvecView;
  if (!v || !v.pdf) return;
  const canvas = document.getElementById('dvec-canvas');
  const stage  = document.getElementById('dvec-stage');
  if (!canvas || !stage) return;
  const page = await v.pdf.getPage(v.page);
  const base = page.getViewport({ scale: 1 });
  if (v.fit) {
    const pad = 48;
    v.scale = Math.min((stage.clientWidth - pad) / base.width,
                       (stage.clientHeight - pad) / base.height);
    if (!(v.scale > 0)) v.scale = 1;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp  = page.getViewport({ scale: v.scale * dpr });
  canvas.width  = Math.max(1, Math.ceil(vp.width));
  canvas.height = Math.max(1, Math.ceil(vp.height));
  canvas.style.width  = Math.ceil(vp.width / dpr) + 'px';
  canvas.style.height = Math.ceil(vp.height / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  _dvecViewerHead();
}

function dvecViewerPage(delta) {
  const v = _dvecView;
  if (!v || !v.pdf) return;
  const next = v.page + delta;
  if (next < 1 || next > v.pages) return;
  v.page = next;
  _dvecViewerDraw();
}

function dvecViewerZoom(mult) {
  const v = _dvecView;
  if (!v) return;
  v.fit   = false;
  v.scale = Math.min(8, Math.max(0.1, v.scale * mult));
  if (v.pdf) { _dvecViewerDraw(); return; }
  const img = document.getElementById('dvec-img');
  if (img) { img.style.width = (v.scale * 100) + '%'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; }
  _dvecViewerHead();
}

function dvecViewerFit() {
  const v = _dvecView;
  if (!v) return;
  v.fit = true; v.scale = 1;
  if (v.pdf) { _dvecViewerDraw(); return; }
  const img = document.getElementById('dvec-img');
  if (img) { img.style.width = ''; img.style.maxWidth = ''; img.style.maxHeight = ''; }
  _dvecViewerHead();
}

async function dvecViewerSave() {
  const v = _dvecView;
  if (!v) return;
  try {
    const file = await _dvecFileOf(v.entry);
    const url  = URL.createObjectURL(file);
    const a    = document.createElement('a');
    a.href = url; a.download = v.entry.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    toast('Could not copy that file: ' + (e.message || e), '⚠');
  }
}

function dvecViewerClose() {
  const overlay = document.getElementById('dvec-viewer');
  if (overlay) overlay.style.display = 'none';
  document.body.classList.remove('dvec-viewer-open');
  const stage = document.getElementById('dvec-stage');
  if (stage) stage.innerHTML = '';
  if (_dvecView) {
    if (_dvecView.url) { try { URL.revokeObjectURL(_dvecView.url); } catch (e) {} }
    if (_dvecView.pdf) { try { _dvecView.pdf.destroy(); } catch (e) {} }
  }
  _dvecView = null;
}

// Folder paths carry apostrophes ("Kyle's owl.ai"), which an inline
// onclick="…('path')" would break on, so every click in this view is
// delegated off a data attribute instead.
function _dvecBindClicks() {
  const wrap = document.getElementById('designs-vectors');
  if (!wrap || wrap.dataset.dvecBound) return;
  wrap.dataset.dvecBound = '1';
  wrap.addEventListener('click', e => {
    const twist = e.target.closest('[data-dvec-twist]');
    if (twist && wrap.contains(twist)) {
      e.stopPropagation();
      dvecToggleExpand(twist.dataset.dvecTwist);
      return;
    }
    const go = e.target.closest('[data-dvec-go]');
    if (go && wrap.contains(go)) { dvecGo(go.dataset.dvecGo); return; }
    const open = e.target.closest('[data-dvec-open]');
    if (open && wrap.contains(open)) { dvecOpenEntry(open.dataset.dvecOpen); }
  });
}

function _dvecBindKeys() {
  if (_dvecKeyBound) return;
  _dvecKeyBound = true;
  document.addEventListener('keydown', e => {
    if (!_dvecView) return;
    if (e.key === 'Escape')      { dvecViewerClose(); }
    else if (e.key === 'ArrowRight') { dvecViewerPage(1); }
    else if (e.key === 'ArrowLeft')  { dvecViewerPage(-1); }
    else if (e.key === '+' || e.key === '=') { dvecViewerZoom(1.25); }
    else if (e.key === '-')      { dvecViewerZoom(0.8); }
    else if (e.key === '0')      { dvecViewerFit(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => {
    if (_dvecView && _dvecView.pdf && _dvecView.fit) _dvecViewerDraw();
  });
}
