// ════════════════════════════════════════════
//  QR  —  js/qr.js
//  Minimal dependency-free QR code encoder.
//  Byte mode, error-correction level M, versions 1–10
//  (up to ~210 bytes — plenty for an order deep-link URL).
//
//  API:
//    qrMatrix(text)          -> { size, mods }   mods[row][col] = 0|1
//    qrSvg(text, px, color)  -> SVG markup string (px = rendered width/height,
//                               includes the mandatory 4-module quiet zone)
//
//  Used by work-order-print.html (bag label QR) and anywhere else that
//  needs an offline QR. Loaded standalone — no other js/ file required.
// ════════════════════════════════════════════
(function (global) {
  'use strict';

  // ── GF(256) tables (poly 0x11D) ─────────────
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  // ── Reed-Solomon ecc for one block ──────────
  function rsEcc(data, eccLen) {
    // generator poly = Π (x - α^i), i = 0..eccLen-1
    let gen = [1];
    for (let i = 0; i < eccLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gmul(gen[j], EXP[i]);
        next[j + 1] ^= gen[j];
      }
      gen = next;
    }
    // gen is little-endian (gen[0] = lowest degree) — flip to big-endian
    gen.reverse();
    const res = data.concat(new Array(eccLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const f = res[i];
      if (!f) continue;
      for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], f);
    }
    return res.slice(data.length);
  }

  // ── Version tables (ECC level M only) ───────
  // RS block structure per version: array of [dataCodewords, count]
  const RS_M = {
    1:  [[16, 1]],           2:  [[28, 1]],           3:  [[44, 1]],
    4:  [[32, 2]],           5:  [[43, 2]],           6:  [[27, 4]],
    7:  [[31, 4]],           8:  [[38, 2], [39, 2]],  9:  [[36, 3], [37, 2]],
    10: [[43, 4], [44, 1]],
  };
  const ECC_PER_BLOCK_M = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22, 9: 22, 10: 26 };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function dataCapacity(v) {
    return RS_M[v].reduce((s, [dc, n]) => s + dc * n, 0);
  }

  // ── Encode text -> final codeword sequence ──
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    // Fallback UTF-8
    const out = [];
    const enc = unescape(encodeURIComponent(text));
    for (let i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }

  function buildCodewords(bytes, version) {
    const capacity = dataCapacity(version);
    const lenBits = version <= 9 ? 8 : 16;
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);            // byte mode
    push(bytes.length, lenBits);
    bytes.forEach(b => push(b, 8));
    // terminator (up to 4 zero bits), pad to byte
    push(0, Math.min(4, capacity * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (let p = 0xEC; data.length < capacity;) {
      data.push(p); p = p === 0xEC ? 0x11 : 0xEC;
    }

    // Split into RS blocks, compute ecc, interleave
    const blocks = [], eccs = [];
    let off = 0;
    RS_M[version].forEach(([dc, n]) => {
      for (let i = 0; i < n; i++) {
        const chunk = data.slice(off, off + dc);
        off += dc;
        blocks.push(chunk);
        eccs.push(rsEcc(chunk, ECC_PER_BLOCK_M[version]));
      }
    });
    const out = [];
    const maxDc = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxDc; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < ECC_PER_BLOCK_M[version]; i++) eccs.forEach(e => out.push(e[i]));
    return out;
  }

  // ── Matrix construction ─────────────────────
  function makeMatrix(version, codewords, maskPattern) {
    const size = version * 4 + 17;
    // null = unset (data region), true/false = function pattern
    const m = Array.from({ length: size }, () => new Array(size).fill(null));

    function finder(row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r < 0 || row + r >= size) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c < 0 || col + c >= size) continue;
          const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                     (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                     (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          m[row + r][col + c] = on;
        }
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    // Alignment patterns
    const pos = ALIGN[version];
    for (const r of pos) for (const c of pos) {
      if (m[r][c] !== null) continue; // overlaps a finder
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (m[i][6] === null) m[i][6] = i % 2 === 0;
      if (m[6][i] === null) m[6][i] = i % 2 === 0;
    }

    // Format info (ECC M = 00) + fixed dark module
    const fmt = bchFormat((0b00 << 3) | maskPattern);
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >> i) & 1) === 1;
      // vertical copy (around top-left finder)
      if (i < 6) m[i][8] = bit;
      else if (i < 8) m[i + 1][8] = bit;
      else m[size - 15 + i][8] = bit;
      // horizontal copy
      if (i < 8) m[8][size - i - 1] = bit;
      else if (i < 9) m[8][15 - i] = bit;
      else m[8][14 - i] = bit;
    }
    m[size - 8][8] = true;

    // Version info (v7+)
    if (version >= 7) {
      const vi = bchVersion(version);
      for (let i = 0; i < 18; i++) {
        const bit = ((vi >> i) & 1) === 1;
        m[Math.floor(i / 3)][(i % 3) + size - 11] = bit;
        m[(i % 3) + size - 11][Math.floor(i / 3)] = bit;
      }
    }

    // Data placement (zigzag) with mask
    const maskFn = MASKS[maskPattern];
    let byteIdx = 0, bitIdx = 7, row = size - 1, inc = -1;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          if (m[row][col - c] !== null) continue;
          let dark = false;
          if (byteIdx < codewords.length) dark = ((codewords[byteIdx] >> bitIdx) & 1) === 1;
          if (maskFn(row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          if (--bitIdx === -1) { byteIdx++; bitIdx = 7; }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
    return m;
  }

  const MASKS = [
    (i, j) => (i + j) % 2 === 0,
    (i, j) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
    (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
    (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0,
  ];

  function bchDigit(d) { let n = 0; while (d) { n++; d >>>= 1; } return n; }
  function bchRem(data, gen) {
    let d = data;
    const gDig = bchDigit(gen);
    while (bchDigit(d) >= gDig) d ^= gen << (bchDigit(d) - gDig);
    return d;
  }
  function bchFormat(data) { return ((data << 10) | bchRem(data << 10, 0x537)) ^ 0x5412; }
  function bchVersion(v) { return (v << 12) | bchRem(v << 12, 0x1F25); }

  // ── Mask penalty (ISO 18004 rules N1-N4) ────
  function penalty(m) {
    const size = m.length;
    let score = 0;
    // N1: runs of same color >= 5 (rows + cols)
    for (let dir = 0; dir < 2; dir++) {
      for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          const cur = dir ? m[j][i] : m[i][j];
          const prev = dir ? m[j - 1][i] : m[i][j - 1];
          if (cur === prev) { run++; if (j === size - 1 && run >= 5) score += run - 2; }
          else { if (run >= 5) score += run - 2; run = 1; }
        }
      }
    }
    // N2: 2x2 blocks
    for (let i = 0; i < size - 1; i++) for (let j = 0; j < size - 1; j++) {
      const v = m[i][j];
      if (m[i][j + 1] === v && m[i + 1][j] === v && m[i + 1][j + 1] === v) score += 3;
    }
    // N3: 1:1:3:1:1 finder-like pattern with 4 light on either side
    const pat = [1, 0, 1, 1, 1, 0, 1];
    const check = (get, i) => {
      for (let k = 0; k < 7; k++) if (!!get(i + k) !== !!pat[k]) return false;
      return true;
    };
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - 6; j++) {
        const rowGet = x => m[i][x], colGet = x => m[x][i];
        for (const get of [rowGet, colGet]) {
          if (!check(get, j)) continue;
          const before = j >= 4 && [1, 2, 3, 4].every(k => !get(j - k));
          const after = j + 10 < size && [7, 8, 9, 10].every(k => !get(j + k));
          if (before || after) score += 40;
        }
      }
    }
    // N4: dark ratio
    let dark = 0;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) if (m[i][j]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  // ── Public API ──────────────────────────────
  function qrMatrix(text) {
    const bytes = toBytes(text);
    const lenBitsFor = v => (v <= 9 ? 8 : 16);
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      if (4 + lenBitsFor(v) + bytes.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
    }
    if (!version) throw new Error('qr.js: text too long (' + bytes.length + ' bytes, max ~213)');
    const codewords = buildCodewords(bytes, version);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = makeMatrix(version, codewords, mask);
      const s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return { size: best.length, mods: best };
  }

  function qrSvg(text, px, color) {
    const { size, mods } = qrMatrix(text);
    const quiet = 4, total = size + quiet * 2;
    px = px || 96;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (mods[r][c]) path += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/>' +
      '<path d="' + path + '" fill="' + (color || '#000') + '"/></svg>';
  }

  global.qrMatrix = qrMatrix;
  global.qrSvg = qrSvg;
  if (typeof module !== 'undefined' && module.exports) module.exports = { qrMatrix, qrSvg };
})(typeof window !== 'undefined' ? window : globalThis);
