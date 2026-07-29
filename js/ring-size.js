// ══════════════════════════════════════════════════════════════
// Ring size display normalization — shared by every work order bag
// template (work-order-print.html, custom-sketch-print.html,
// bag-layout-variants.html, resize-bag-print.html, ring-boxes-print.html).
//
// House rule: ring sizes ALWAYS print as decimals on a bag. Never "6 1/2",
// never "6½" — always "6.5".
//
// Why: the bench reads sizes off paper at a glance, often upside-down in a
// bag. A vulgar fraction like ½ can be misread as a stray mark or lost to a
// scanner/fax, and "6 1/2" wraps as "6" + "1/2" across a line break, which
// reads as two different sizes. A decimal cannot break apart or be halfway
// dropped. Ring size is the one field where being off by one means starting
// over, so it gets a single unambiguous printed form.
//
// Intake stores sizes as FREE TEXT (js/intake.js, js/ring-fields.js), so
// anything the person at the counter typed can arrive here: "6 1/2", "6½",
// "6-1/2", "6 ½", "7.25", "6". This normalizes the display only — nothing
// is written back to the order.
//
// Loaded by every bag template alongside js/qrcode-lib.js. A NEW bag
// template must include it too, and route any size through
// stsRingSizeDec() before printing it.
// ══════════════════════════════════════════════════════════════

(function (root) {
  // Unicode vulgar fractions people actually type or paste into intake.
  const VULGAR = {
    '½': 0.5,    // ½
    '¼': 0.25,   // ¼
    '¾': 0.75,   // ¾
    '⅓': 1 / 3,  // ⅓
    '⅔': 2 / 3,  // ⅔
    '⅛': 0.125,  // ⅛
    '⅜': 0.375,  // ⅜
    '⅝': 0.625,  // ⅝
    '⅞': 0.875,  // ⅞
  };
  const VULGAR_RE = new RegExp('[' + Object.keys(VULGAR).join('') + ']', 'g');

  // At most 3 decimals (an eighth is 0.125 — finer than that isn't a real
  // ring size), with trailing zeros stripped so 6.50 prints as 6.5 and a
  // whole size stays "7" rather than becoming "7.000".
  function trim(n) {
    return String(parseFloat(n.toFixed(3)));
  }

  // Convert one size token to decimal. Returns null when the text isn't a
  // size we recognise, so the caller can pass the original through untouched
  // rather than printing a mangled guess on a bench document.
  function one(tok) {
    let s = String(tok).trim();
    if (!s) return null;

    // "6½" / "6 ½" → "6 1/2" so the mixed-number branch below handles it.
    s = s.replace(VULGAR_RE, m => ' ' + vulgarToText(m)).trim();

    // whole + fraction: "6 1/2", "6-1/2", "6 1 / 2"
    let m = /^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) {
      const d = parseInt(m[3], 10);
      if (!d) return null;
      return trim(parseInt(m[1], 10) + parseInt(m[2], 10) / d);
    }

    // bare fraction: "1/2"
    m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
    if (m) {
      const d = parseInt(m[2], 10);
      if (!d) return null;
      return trim(parseInt(m[1], 10) / d);
    }

    // already decimal or whole: "6.5", "6.50", "7"
    m = /^(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return trim(parseFloat(m[1]));

    return null;
  }

  function vulgarToText(ch) {
    switch (ch) {
      case '½': return '1/2';
      case '¼': return '1/4';
      case '¾': return '3/4';
      case '⅓': return '1/3';
      case '⅔': return '2/3';
      case '⅛': return '1/8';
      case '⅜': return '3/8';
      case '⅝': return '5/8';
      case '⅞': return '7/8';
      default: return ch;
    }
  }

  /**
   * Normalize a ring size for printing. Always returns a string.
   *
   *   "6 1/2"  → "6.5"      "6½"   → "6.5"     "6-1/2" → "6.5"
   *   "6.50"   → "6.5"      "7"    → "7"       "4 3/4" → "4.75"
   *
   * Text that isn't purely a size is passed through with any size-looking
   * part converted in place, so "6 1/2 (wide band)" prints as
   * "6.5 (wide band)" and a genuine note like "see order" is left alone.
   * Ranges keep their separator: "6-7" stays "6-7" (no slash → not a
   * fraction), "6 1/2 - 7" → "6.5 - 7".
   */
  function stsRingSizeDec(v) {
    if (v == null) return '';
    const raw = String(v).trim();
    if (!raw) return '';

    // Whole string is a single size — the overwhelmingly common case.
    const whole = one(raw);
    if (whole !== null) return whole;

    // Otherwise convert size-shaped runs in place and leave the rest of the
    // text (band notes, ranges, "approx") exactly as written.
    let out = raw.replace(VULGAR_RE, m => ' ' + vulgarToText(m));
    // mixed numbers first, so "6 1/2" isn't eaten by the bare-fraction rule
    out = out.replace(/(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)/g, (t, w, n, d) => {
      const den = parseInt(d, 10);
      return den ? trim(parseInt(w, 10) + parseInt(n, 10) / den) : t;
    });
    out = out.replace(/(?:^|(?<![\d.\/]))(\d+)\s*\/\s*(\d+)(?![\d.])/g, (t, n, d) => {
      const den = parseInt(d, 10);
      return den ? trim(parseInt(n, 10) / den) : t;
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  root.stsRingSizeDec = stsRingSizeDec;
})(typeof window !== 'undefined' ? window : globalThis);
