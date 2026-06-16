// ════════════════════════════════════════════
//  STULLER CATALOG SEARCH  —  js/stuller.js
//  SKU lookup + category browse modal for
//  the Estimate Builder (New Order tab).
// ════════════════════════════════════════════

window.StullerSearch = (() => {
  let _rowId = null;

  // ── Lazy-inject the modal DOM ───────────────
  function _inject() {
    if (document.getElementById('stl-bg')) return;
    const bg = document.createElement('div');
    bg.id = 'stl-bg';
    bg.className = 'stl-bg';
    bg.onclick = e => { if (e.target === bg) close(); };
    bg.innerHTML = `
<div class="stl-modal">
  <div class="stl-head">
    <span>🔍 Stuller Catalog</span>
    <button class="stl-close" onclick="StullerSearch.close()">✕</button>
  </div>

  <!-- Shared filters — used by both tabs -->
  <div class="stl-filters">
    <select id="stl-cat" class="stl-select" onchange="StullerSearch.onCatChange()">
      <option value="">— Category —</option>
      <option value="4">Metals</option>
      <option value="24004">Metal Findings</option>
      <option value="302">Diamonds (Cat 302)</option>
      <option value="305">Lab-Grown Diamonds</option>
      <option value="321">Colored Stones</option>
      <option value="360">Settings &amp; Mountings</option>
      <option value="361">Chains</option>
    </select>
    <div id="stl-metal-wrap" style="display:none">
      <select id="stl-metal" class="stl-select stl-metal-select">
        <option value="">Any Metal</option>
        <option value="14KY">14K Yellow</option>
        <option value="14KW">14K White</option>
        <option value="14KR">14K Rose</option>
        <option value="18KY">18K Yellow</option>
        <option value="18KW">18K White</option>
        <option value="PLAT">Platinum</option>
        <option value="STER">Sterling Silver</option>
      </select>
    </div>
    <!-- Gem filters — shown for diamond/stone categories -->
    <div id="stl-gem-wrap" style="display:none;gap:8px">
      <select id="stl-shape" class="stl-select">
        <option value="">Any Shape</option>
        <option value="RD">Round</option>
        <option value="OV">Oval</option>
        <option value="PS">Pear</option>
        <option value="CU">Cushion</option>
        <option value="PC">Princess</option>
        <option value="MQ">Marquise</option>
        <option value="EM">Emerald Cut</option>
        <option value="AS">Asscher</option>
        <option value="RA">Radiant</option>
        <option value="HT">Heart</option>
        <option value="TR">Trillion</option>
      </select>
      <select id="stl-stone-type" class="stl-select" style="display:none">
        <option value="">Any Stone</option>
        <option value="AMETHYST">Amethyst</option>
        <option value="AQUAMARINE">Aquamarine</option>
        <option value="CITRINE">Citrine</option>
        <option value="EMERALD">Emerald</option>
        <option value="GARNET">Garnet</option>
        <option value="MORGANITE">Morganite</option>
        <option value="OPAL">Opal</option>
        <option value="PERIDOT">Peridot</option>
        <option value="RUBY">Ruby</option>
        <option value="SAPPHIRE">Sapphire</option>
        <option value="SPINEL">Spinel</option>
        <option value="TANZANITE">Tanzanite</option>
        <option value="TOPAZ">Topaz</option>
        <option value="TOURMALINE">Tourmaline</option>
        <option value="ALEXANDRITE">Alexandrite</option>
        <option value="MOISSANITE">Moissanite</option>
      </select>
    </div>
  </div>

  <div class="stl-tabs">
    <button class="stl-tab active" onclick="StullerSearch.tab('sku',this)">SKU Lookup</button>
    <button class="stl-tab"       onclick="StullerSearch.tab('browse',this)">Browse</button>
  </div>

  <!-- SKU pane -->
  <div id="stl-pane-sku" class="stl-pane">
    <div class="stl-search-row">
      <input id="stl-sku-input" class="stl-input" type="text"
        placeholder="Enter Stuller item # (e.g. 26677)"
        onkeydown="if(event.key==='Enter')StullerSearch.lookupSku()">
      <button class="btn btn-gold btn-sm" onclick="StullerSearch.lookupSku()">Look Up</button>
    </div>
    <div id="stl-sku-result" class="stl-result-area"></div>
  </div>

  <!-- Browse pane -->
  <div id="stl-pane-browse" class="stl-pane" style="display:none">
    <div class="stl-search-row">
      <button class="btn btn-gold btn-sm" onclick="StullerSearch.browse()">Search</button>
      <span id="stl-browse-hint" style="font-size:12px;color:var(--text3)">Select a category above, then click Search.</span>
    </div>
    <div id="stl-browse-result" class="stl-result-area"></div>
  </div>
</div>`;
    document.body.appendChild(bg);
  }

  // ── Public: open / close / switch tab ───────
  function open(rowId) {
    _rowId = rowId;
    _inject();
    document.getElementById('stl-bg').style.display = 'flex';
    setTimeout(() => document.getElementById('stl-sku-input')?.focus(), 50);
  }

  function close() {
    const bg = document.getElementById('stl-bg');
    if (bg) bg.style.display = 'none';
    _rowId = null;
  }

  function tab(name, btn) {
    document.querySelectorAll('.stl-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('stl-pane-sku').style.display    = name === 'sku'    ? '' : 'none';
    document.getElementById('stl-pane-browse').style.display  = name === 'browse' ? '' : 'none';
    // Auto-run browse if a category is already selected
    if (name === 'browse' && document.getElementById('stl-cat')?.value) {
      browse();
    }
  }

  // Category sets for conditional filter display
  const METAL_CATS  = new Set(['4', '24004', '360', '361']);
  const GEM_CATS    = new Set(['302', '305', '321']); // Diamonds, Lab-Grown, Colored Stones
  const STONE_CATS  = new Set(['321']);               // Colored Stones only → show stone type

  // When category changes: show/hide metal or gem selectors, auto-search if on Browse tab
  function onCatChange() {
    const catId     = (document.getElementById('stl-cat')?.value || '');
    const metalWrap = document.getElementById('stl-metal-wrap');
    const gemWrap   = document.getElementById('stl-gem-wrap');
    const stoneType = document.getElementById('stl-stone-type');

    if (metalWrap) {
      const show = !catId || METAL_CATS.has(catId);
      metalWrap.style.display = show ? '' : 'none';
      if (!show) document.getElementById('stl-metal').value = '';
    }
    if (gemWrap) {
      const showGem = GEM_CATS.has(catId);
      gemWrap.style.display = showGem ? 'flex' : 'none';
      if (!showGem) {
        document.getElementById('stl-shape').value = '';
        if (stoneType) { stoneType.value = ''; }
      }
    }
    if (stoneType) {
      const showType = STONE_CATS.has(catId);
      stoneType.style.display = showType ? '' : 'none';
      if (!showType) stoneType.value = '';
    }

    const browsePane = document.getElementById('stl-pane-browse');
    if (browsePane && browsePane.style.display !== 'none') {
      browse();
    }
  }

  // ── SKU lookup — SKU alone, no category/metal filters (they confuse the API) ──
  async function lookupSku() {
    const sku = (document.getElementById('stl-sku-input')?.value || '').trim();
    const el  = document.getElementById('stl-sku-result');
    if (!sku) return;

    el.innerHTML = '<div class="stl-loading">Looking up…</div>';

    const body = { Include: ['All'], Skus: [sku] };

    try {
      const resp = await fetch('/api/stuller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        el.innerHTML = `<div class="stl-error">API error (HTTP ${resp.status}). Try again in a moment.<br><small style="opacity:.6">${_esc(text.slice(0,120))}</small></div>`;
        return;
      }
      if (!resp.ok || data.error) {
        el.innerHTML = `<div class="stl-error">${_esc(data.error || 'Lookup failed')} (HTTP ${resp.status})</div>`;
        return;
      }
      const products = data.Products || data.products || (Array.isArray(data) ? data : (data ? [data] : []));
      if (!products.length) {
        el.innerHTML = '<div class="stl-error">No product found for that SKU. Check the item number and try again.</div>';
        return;
      }
      el.innerHTML = '<div class="stl-cards">' + products.map(_card).join('') + '</div>';
    } catch (err) {
      el.innerHTML = `<div class="stl-error">Network error: ${_esc(err.message)}</div>`;
    }
  }

  // ── Category browse ─────────────────────────
  async function browse() {
    const catId     = (document.getElementById('stl-cat')?.value || '').trim();
    const metal     = (document.getElementById('stl-metal')?.value || '').trim();
    const shape     = (document.getElementById('stl-shape')?.value || '').trim();
    const stoneType = (document.getElementById('stl-stone-type')?.value || '').trim();
    const el        = document.getElementById('stl-browse-result');
    const hint      = document.getElementById('stl-browse-hint');

    if (!catId) {
      if (hint) hint.textContent = 'Select a category above, then click Search.';
      el.innerHTML = '';
      return;
    }
    if (hint) hint.textContent = '';
    el.innerHTML = '<div class="stl-loading">Searching…</div>';

    const advFilters = [];
    if (metal)     advFilters.push({ Type: 'MetalQuality', Values: [{ Value: metal }] });
    if (shape)     advFilters.push({ Type: 'Shape',        Values: [{ Value: shape }] });
    if (stoneType) advFilters.push({ Type: 'StoneType',    Values: [{ Value: stoneType }] });

    const body = {
      Include: ['All'],
      CategoryIds: [catId],
      Series: [],
      Filter: ['Orderable', 'OnPriceList'],
      AdvancedProductFilters: advFilters
    };

    try {
      const resp = await fetch('/api/stuller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        el.innerHTML = `<div class="stl-error">API error (HTTP ${resp.status}). Try again in a moment.<br><small style="opacity:.6">${_esc(text.slice(0,120))}</small></div>`;
        return;
      }
      if (!resp.ok) {
        // Show full Stuller error so we can diagnose filter type names
        const detail = data?.Message || data?.message || data?.error
          || JSON.stringify(data).slice(0, 300);
        el.innerHTML = `<div class="stl-error">HTTP ${resp.status}: ${_esc(detail)}</div>`;
        return;
      }

      const products = data.Products || data.products || (Array.isArray(data) ? data : []);
      if (!products.length) {
        el.innerHTML = '<div class="stl-error">No results. Try a different category or remove filters.</div>';
        return;
      }

      const shown = products.slice(0, 50);
      el.innerHTML = `
        <div class="stl-count">${products.length} result${products.length !== 1 ? 's' : ''}${products.length > 50 ? ' — showing first 50' : ''}</div>
        <div class="stl-cards">${shown.map(_card).join('')}</div>`;
    } catch (err) {
      el.innerHTML = `<div class="stl-error">Network error: ${_esc(err.message)}</div>`;
    }
  }

  // ── Product card ────────────────────────────
  function _card(p) {
    const sku  = p.Sku || p.sku || p.SKU || '';
    const name = p.ShortDescription || p.Description || p.Name || p.name || 'Unknown';
    // Stuller API returns price in various shapes depending on product type
    const rawPrice = p.Price ?? p.price ?? p.UnitPrice ?? p.ListPrice
                  ?? p.PriceList?.[0]?.Price ?? p.Prices?.[0]?.Amount
                  ?? p.BasePrice ?? null;
    const price    = rawPrice != null ? parseFloat(rawPrice) : NaN;
    const priceStr = !isNaN(price) && price > 0 ? '$' + price.toFixed(2) : 'Price N/A';

    return `<div class="stl-card"
      data-sku="${_esc(sku)}"
      data-name="${_esc(name)}"
      data-price="${!isNaN(price) ? price : 0}">
      <div class="stl-card-body">
        <div class="stl-card-sku">${_esc(sku) || '—'}</div>
        <div class="stl-card-name">${_esc(name)}</div>
      </div>
      <div class="stl-card-footer">
        <span class="stl-card-price">${priceStr}</span>
        <button class="btn btn-gold btn-sm stl-add-btn">Add to Row</button>
      </div>
    </div>`;
  }

  // ── Event delegation for Add to Row ─────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('.stl-add-btn');
    if (!btn) return;
    const card = btn.closest('.stl-card');
    if (!card || !_rowId) return;
    _fillRow(card.dataset.sku, card.dataset.name, parseFloat(card.dataset.price) || 0);
  });

  function _fillRow(sku, name, price) {
    const row = document.getElementById(_rowId);
    if (!row) return;
    const inputs = row.querySelectorAll('input');
    const label  = name + (sku ? ' (' + sku + ')' : '');
    if (inputs[0]) { inputs[0].value = label; inputs[0].dispatchEvent(new Event('input')); }
    if (inputs[1]) { inputs[1].value = price > 0 ? price : ''; inputs[1].dispatchEvent(new Event('input')); }
    close();
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { open, close, tab, lookupSku, browse, onCatChange };
})();
