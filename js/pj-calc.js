(function () {
  const PJ_DATA = [
    { style:'Paperclip',     metal:'SS', name:'Sterling Silver 1.9mm Oval Cable Chain',              item:'617936B', bracelet:35, anklet:45, neck:[50,56,62,68],  belly:[75,80,85,95,100,105,110]    },
    { style:'Paperclip',     metal:'GF', name:'14/20 YGF 1.9mm Oval Cable Chain',                    item:'679289B', bracelet:60, anklet:70, neck:[75,81,87,93],  belly:[100,105,115,120,125,135,140] },
    { style:'Rolo',          metal:'SS', name:'Sterling Silver 1.3mm Drawn Oval Rolo Chain',          item:'616230B', bracelet:35, anklet:45, neck:[50,56,62,68],  belly:[85,90,100,105,110,115,120]  },
    { style:'Rolo',          metal:'GF', name:'14/20 YGF 1.3mm Drawn Oval Rolo Chain',               item:'679538B', bracelet:60, anklet:70, neck:[75,81,87,93],  belly:[110,120,130,135,145,150,160] },
    { style:'Long & Short',  metal:'SS', name:'Sterling Silver 1.6mm Oval Long & Short Chain',        item:'613081B', bracelet:35, anklet:45, neck:[50,56,62,68],  belly:[55,60,65,70,70,75,80]       },
    { style:'Long & Short',  metal:'GF', name:'14/20 YGF 1.7mm Flat Long & Short Chain',             item:'628672B', bracelet:60, anklet:70, neck:[75,81,87,93],  belly:[90,100,105,110,120,125,130]  },
    { style:'Dapped Oval',   metal:'SS', name:'Sterling Silver 2.5mm Dapped Flat Oval Cable Chain',   item:'683164B', bracelet:35, anklet:45, neck:[50,56,62,68],  belly:[90,100,105,110,115,125,130]  },
    { style:'Dapped Oval',   metal:'GF', name:'14/20 YGF 1.9mm Oval Cable Chain',                    item:'643012B', bracelet:60, anklet:70, neck:[75,81,87,93],  belly:[100,105,115,120,125,135,140] },
    { style:'Heart',         metal:'SS', name:'Sterling Silver 3.4mm Flat Heart Link Chain',          item:'617837B', bracelet:40, anklet:50, neck:[55,61,67,73],  belly:[145,155,165,175,185,195,205] },
    { style:'Heart',         metal:'GF', name:'14/20 YGF 3.2mm Heart Link Cable Chain',              item:'643125B', bracelet:65, anklet:75, neck:[80,86,92,98],  belly:[165,175,185,195,210,220,230] },
    { style:'Tube Bead',     metal:'SS', name:'Sterling Silver 1.7mm Cable Chain with Tube Beads',    item:'615831B', bracelet:40, anklet:50, neck:[55,61,67,73],  belly:[110,120,130,135,145,150,160] },
    { style:'Tube Bead',     metal:'GF', name:'14/20 YGF 1.7mm Cable Chain with Tube Beads',         item:'678880B', bracelet:65, anklet:75, neck:[80,86,92,98],  belly:[190,200,215,230,240,255,265] },
    { style:'Figaro',        metal:'SS', name:'Sterling Silver 2.2mm Diamond-Cut Figaro Chain',       item:'632379B', bracelet:40, anklet:50, neck:[55,61,67,73],  belly:[140,150,155,165,175,185,195] },
    { style:'Figaro',        metal:'GF', name:'14/20 YGF 2.2mm Figaro Chain',                        item:'643030B', bracelet:65, anklet:75, neck:[80,86,92,98],  belly:[230,245,260,275,295,310,325] },
    { style:'Dapped Bar',    metal:'SS', name:'Sterling Silver 1.3mm Dapped Bar & Link Chain',        item:'632370B', bracelet:45, anklet:55, neck:[60,66,72,78],  belly:[150,160,170,185,195,205,215] },
    { style:'Dapped Bar',    metal:'GF', name:'14/20 YGF 1.4mm Dapped Bar & Link Chain',             item:'678682B', bracelet:70, anklet:80, neck:[85,91,97,103], belly:[235,255,270,290,305,320,340] },
    { style:'Enameled Bead', metal:'GF', name:'14/20 YGF 1.65mm Cable Chain w/ Blue Enamel Beads',   item:'656431B', bracelet:65, anklet:75, neck:[80,86,92,98],  belly:[210,225,240,255,270,285,300] },
  ];

  const PJ_STYLES = {
    SS: ['Paperclip','Rolo','Long & Short','Dapped Oval','Heart','Tube Bead','Figaro','Dapped Bar'],
    GF: ['Paperclip','Rolo','Long & Short','Dapped Oval','Heart','Tube Bead','Figaro','Dapped Bar','Enameled Bead']
  };
  const PJ_NECK  = [14, 16, 18, 20];
  const PJ_BELLY = [28, 30, 32, 34, 36, 38, 40];

  let pjS = { metal: null, style: null, piece: null, size: null };

  function pjScrollTo(id) {
    const el = document.getElementById(id);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }

  function pjPickMetal(m) { pjS = { metal: m, style: null, piece: null, size: null }; pjRender(); pjScrollTo('pjStyleStep'); }
  function pjPickStyle(s) { pjS.style = s; pjS.piece = null; pjS.size = null; pjRender(); pjScrollTo('pjPieceStep'); }
  function pjPickPiece(p) {
    pjS.piece = p;
    pjS.size = (p === 'bracelet' || p === 'anklet' || p === 'hand') ? p : null;
    pjRender();
    pjScrollTo(pjS.size ? 'pjPriceCard' : 'pjSizeStep');
  }
  function pjPickSize(s) { pjS.size = String(s); pjRender(); pjScrollTo('pjPriceCard'); }

  function pjChain() {
    if (!pjS.metal || !pjS.style) return null;
    return PJ_DATA.find(c => c.style === pjS.style && c.metal === pjS.metal) || null;
  }

  function pjPrice() {
    const c = pjChain();
    if (!c || !pjS.size) return null;
    if (pjS.piece === 'bracelet') return c.bracelet;
    if (pjS.piece === 'anklet')   return c.anklet;
    if (pjS.piece === 'hand')     return c.bracelet + (c.metal === 'SS' ? 30 : 60);
    if (pjS.piece === 'necklace') { const i = PJ_NECK.indexOf(+pjS.size);  return i >= 0 ? c.neck[i]  : null; }
    if (pjS.piece === 'belly')    { const i = PJ_BELLY.indexOf(+pjS.size); return i >= 0 ? c.belly[i] : null; }
    return null;
  }

  function pjRender() {
    ['SS','GF'].forEach(m => document.getElementById('pjMetal_'+m).classList.toggle('active', pjS.metal === m));

    const styleEl = document.getElementById('pjStyleStep');
    styleEl.classList.toggle('pj-hidden', !pjS.metal);
    if (pjS.metal) {
      document.getElementById('pjStyleChips').innerHTML = PJ_STYLES[pjS.metal].map(s =>
        `<button class="pj-chip${pjS.style === s ? ' active' : ''}" onclick="pjPickStyle('${s.replace(/'/g,"\\'")}')">${s}</button>`
      ).join('');
    }

    document.getElementById('pjPieceStep').classList.toggle('pj-hidden', !pjS.style);
    ['bracelet','anklet','necklace','belly','hand'].forEach(p => {
      const el = document.getElementById('pjPiece_' + p);
      if (el) el.classList.toggle('active', pjS.piece === p);
    });

    const needsSize = pjS.piece === 'necklace' || pjS.piece === 'belly';
    document.getElementById('pjSizeStep').classList.toggle('pj-hidden', !pjS.piece || !needsSize);
    if (needsSize && pjS.piece) {
      const sizes = pjS.piece === 'necklace' ? PJ_NECK : PJ_BELLY;
      document.getElementById('pjSizeLabel').textContent = pjS.piece === 'necklace' ? '4 — Necklace Length' : '4 — Belly Chain Length';
      document.getElementById('pjSizeChips').innerHTML = sizes.map(s =>
        `<button class="pj-chip${pjS.size === String(s) ? ' active' : ''}" onclick="pjPickSize(${s})">${s}"</button>`
      ).join('');
    }

    const price = pjPrice();
    const priceCard = document.getElementById('pjPriceCard');
    priceCard.classList.toggle('pj-hidden', price === null);
    if (price !== null) {
      const chain = pjChain();
      const metalLabel = pjS.metal === 'SS' ? 'Sterling Silver' : '14/20 Gold-Fill';
      let pieceLabel = '';
      if (pjS.piece === 'bracelet') pieceLabel = 'Bracelet';
      else if (pjS.piece === 'anklet') pieceLabel = 'Anklet';
      else if (pjS.piece === 'hand')     pieceLabel = 'Hand Chain';
      else if (pjS.piece === 'necklace') pieceLabel = pjS.size + '″ Necklace';
      else if (pjS.piece === 'belly')    pieceLabel = pjS.size + '″ Belly Chain';
      document.getElementById('pjPriceLine').textContent   = pjS.style + '  ·  ' + metalLabel + '  ·  ' + pieceLabel;
      document.getElementById('pjPriceAmount').textContent = '$' + price;
      document.getElementById('pjPriceMeta').textContent   = chain ? chain.name + ' · #' + chain.item : '';
    }
  }

  function pjBuildRef() {
    const tbody = document.getElementById('pjRefBody');
    if (!tbody || tbody.children.length > 0) return;
    tbody.innerHTML = PJ_DATA.map(c => {
      const badge = c.metal === 'GF'
        ? '<span class="pj-badge-gf">Gold-Fill</span>'
        : '<span class="pj-badge-ss">Silver</span>';
      const neckCells  = c.neck.map((p, j)  => `<td class="pj-ref-td pj-price-td${j === 0 ? ' pj-sep-l' : ''}">$${p}</td>`).join('');
      const bellyCells = c.belly.map((p, j) => `<td class="pj-ref-td pj-price-td${j === 0 ? ' pj-sep-l' : ''}">$${p}</td>`).join('');
      const trClass = c.metal === 'GF' ? 'pj-ref-tr-gf' : 'pj-ref-tr-ss';
      return `<tr class="${trClass}">
        <td class="pj-ref-td">${c.style}</td>
        <td class="pj-ref-td">${badge}</td>
        <td class="pj-ref-td pj-price-td">$${c.bracelet}</td>
        <td class="pj-ref-td pj-price-td">$${c.anklet}</td>
        ${neckCells}${bellyCells}
      </tr>`;
    }).join('');
  }

  window.pjPickMetal = pjPickMetal;
  window.pjPickStyle = pjPickStyle;
  window.pjPickPiece = pjPickPiece;
  window.pjPickSize  = pjPickSize;
  window.pjBuildRef  = pjBuildRef;
})();

// ═══════════════════ PRINT SETUP ═══════════════════
const PS_KEY = 'workOrderPrintSettings';
const PS_DEFAULTS = {
  jobDescSize: 'small',
  notesSize:   'medium',
  liRows:      4,
  fontSize:    'medium',
  showSizeRow: true,
  // 'classic' = work-order-print.html; 'sketch' = custom-sketch-print.html
  // prototype; 'variants' = bag-layout-variants.html prototype (auto-picks
  // rings/repair/compact). Only affects orders that print with the custom
  // bag layout.
  customLayout: 'classic'
};

function psLoadSettings() {
  try { return Object.assign({}, PS_DEFAULTS, JSON.parse(localStorage.getItem(PS_KEY) || '{}')); }
  catch(e) { return Object.assign({}, PS_DEFAULTS); }
}

function psSelect(groupId, btn) {
  document.querySelectorAll('#' + groupId + ' .ps-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function openPrintSetup() {
  const s = psLoadSettings();
  // Populate button groups
  ['ps-jobdesc','ps-notes','ps-font'].forEach(gid => {
    const key = gid === 'ps-jobdesc' ? 'jobDescSize' : gid === 'ps-notes' ? 'notesSize' : 'fontSize';
    document.querySelectorAll('#' + gid + ' .ps-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.val === s[key]);
    });
  });
  document.getElementById('ps-lirows').value = s.liRows;
  document.getElementById('ps-sizerow').checked = s.showSizeRow;
  document.querySelectorAll('#ps-customlayout .ps-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.val === (s.customLayout || 'classic'));
  });
  document.getElementById('printSetupBg').classList.add('open');
}

function closePrintSetup() {
  document.getElementById('printSetupBg').classList.remove('open');
}

function savePrintSetup() {
  const active = (gid) => {
    const el = document.querySelector('#' + gid + ' .ps-opt.active');
    return el ? el.dataset.val : null;
  };
  const s = {
    jobDescSize: active('ps-jobdesc') || PS_DEFAULTS.jobDescSize,
    notesSize:   active('ps-notes')   || PS_DEFAULTS.notesSize,
    liRows:      parseInt(document.getElementById('ps-lirows').value) || PS_DEFAULTS.liRows,
    fontSize:    active('ps-font')    || PS_DEFAULTS.fontSize,
    showSizeRow: document.getElementById('ps-sizerow').checked,
    customLayout: active('ps-customlayout') || PS_DEFAULTS.customLayout
  };
  localStorage.setItem(PS_KEY, JSON.stringify(s));
  closePrintSetup();
}
