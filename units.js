/*
 * Unit parsing and normalization.
 *
 * Exposes window.AVSUnits for content.js. Everything here is pure: given a
 * string, return a canonical quantity, or null. No DOM, no state.
 */

(() => {
  "use strict";

  // Canonical base per dimension, and how to display it.
  const DIMENSIONS = {
    mass: { mult: 100, label: "100 g" },
    volume: { mult: 100, label: "100 ml" },
    count: { mult: 1, label: "item" },
    length: { mult: 100, label: "m" },
    area: { mult: 10000, label: "m\u00b2" },
  };

  // Longest keys first so "fl oz" wins over "oz" and "sq ft" over "ft".
  const UNITS = [
    // volume
    ["fluid ounce", "volume", 29.5735],
    ["fluid oz", "volume", 29.5735],
    ["fl ounce", "volume", 29.5735],
    ["fl oz", "volume", 29.5735],
    ["floz", "volume", 29.5735],
    ["milliliter", "volume", 1],
    ["millilitre", "volume", 1],
    ["centiliter", "volume", 10],
    ["gallon", "volume", 3785.41],
    ["liter", "volume", 1000],
    ["litre", "volume", 1000],
    ["quart", "volume", 946.353],
    ["pint", "volume", 473.176],
    ["gal", "volume", 3785.41],
    ["ml", "volume", 1],
    ["cl", "volume", 10],
    ["qt", "volume", 946.353],
    ["pt", "volume", 473.176],
    ["l", "volume", 1000],

    // area (before length, so "sq ft" is not read as "ft")
    ["square foot", "area", 929.03],
    ["square feet", "area", 929.03],
    ["square meter", "area", 10000],
    ["square metre", "area", 10000],
    ["square inch", "area", 6.4516],
    ["sq ft", "area", 929.03],
    ["sqft", "area", 929.03],
    ["sq m", "area", 10000],
    ["sqm", "area", 10000],
    ["sq in", "area", 6.4516],

    // mass
    ["kilogram", "mass", 1000],
    ["milligram", "mass", 0.001],
    ["microgram", "mass", 0.000001],
    ["ounce", "mass", 28.3495],
    ["pound", "mass", 453.592],
    ["gram", "mass", 1],
    ["kg", "mass", 1000],
    ["mg", "mass", 0.001],
    ["lbs", "mass", 453.592],
    ["lb", "mass", 453.592],
    ["oz", "mass", 28.3495],
    ["g", "mass", 1],

    // length
    ["centimeter", "length", 1],
    ["millimeter", "length", 0.1],
    ["inch", "length", 2.54],
    ["foot", "length", 30.48],
    ["feet", "length", 30.48],
    ["yard", "length", 91.44],
    ["meter", "length", 100],
    ["metre", "length", 100],
    ["cm", "length", 1],
    ["mm", "length", 0.1],
    ["ft", "length", 30.48],
    ["yd", "length", 91.44],
    ["in", "length", 2.54],
    ["m", "length", 100],

    // count
    ["fluid ounces", "volume", 29.5735],
    ["capsule", "count", 1],
    ["softgel", "count", 1],
    ["tablet", "count", 1],
    ["serving", "count", 1],
    ["diaper", "count", 1],
    ["sheet", "count", 1],
    ["piece", "count", 1],
    ["count", "count", 1],
    ["wipe", "count", 1],
    // Loads are vendor-defined, not physical: a medium load and a large load
    // are different amounts and nothing on the tile says by how much. They
    // rank as plain counts; see "Soft units" in the README.
    ["medium load", "count", 1],
    ["load", "count", 1],
    ["roll", "count", 1],
    ["pair", "count", 1],
    ["item", "count", 1],
    ["pack", "count", 1],
    ["unit", "count", 1],
    ["each", "count", 1],
    ["bag", "count", 1],
    ["can", "count", 1],
    ["pod", "count", 1],
    ["ct", "count", 1],
    ["pk", "count", 1],
    ["pc", "count", 1],
    ["ea", "count", 1],
  ];

  function tidy(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[().]/g, " ")
      .replace(/[^a-z0-9\u00b2\s/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // A bare ounce is mass or volume depending on the product; "fl oz" is not.
  // The longest-first table means these keys only match when no "fl" precedes.
  const BARE_OUNCE = new Set(["oz", "ounce"]);
  const FL_OZ = UNITS.find(([key]) => key === "fl oz")[2];

  /*
   * "100 ml" -> { dim: "volume", qty: 100, n: 100 }   "Count" -> { dim: "count", qty: 1, n: 1 }
   *
   * qty is in the dimension's base unit; n is the stated number of units.
   * A bare ounce reads as mass and is flagged ambiguous, unless `context` is
   * "volume", in which case it reads as fluid ounces. The flag records what
   * the source said, so it stays set on a volume reading.
   */
  function parseUnit(raw, context) {
    let s = tidy(raw);
    if (!s) return null;
    s = s.replace(/s\b/g, (m, i) => (i > 0 ? "" : m)); // crude plural strip
    const lead = s.match(/^([\d.,]+)\s*/);
    let mult = 1;
    if (lead) {
      const v = parseFloat(lead[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > 0) mult = v;
      s = s.slice(lead[0].length);
    }
    s = s.trim();
    for (const [key, dim, factor] of UNITS) {
      if (s === key || s.startsWith(key + " ")) {
        const ambiguous = BARE_OUNCE.has(key);
        if (ambiguous && context === "volume") return { dim: "volume", qty: mult * FL_OZ, n: mult, ambiguous };
        return { dim, qty: mult * factor, n: mult, ambiguous };
      }
    }
    return null;
  }

  // Handles 1,234.56 and 1.234,56 without guessing wrong on 24,99.
  function parseMoney(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/[^\d.,]/g, "");
    if (!s) return null;
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let out;
    if (lastDot === -1 && lastComma === -1) out = s;
    else if (lastComma > lastDot) out = s.replace(/\./g, "").replace(",", ".");
    else out = s.replace(/,/g, "");
    const v = parseFloat(out);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /*
   * Amazon writes the unit price as "($0.52/Count)" or "(£1.20/100 g)" or
   * occasionally "$0.52 / Fl Oz" with no parentheses.
   * Returns { dim, perBase } where perBase is price per 1 g / 1 ml / 1 item.
   *
   * The currency prefix excludes digits: tiles carry the amount twice (a
   * screen-reader copy and a visible one), so the raw text is
   * "($0.49$0.49/Count)", and a prefix that could take digits read "49$0.49".
   */
  const UNIT_PRICE_RE = /[(\[]?\s*([^\d\s(/[]{0,3}\s*[\d.,]+)\s*\/\s*([^)\]\n]{1,24})[)\]]?/g;

  function parseUnitPrice(text) {
    if (!text) return null;
    UNIT_PRICE_RE.lastIndex = 0;
    let m;
    while ((m = UNIT_PRICE_RE.exec(text))) {
      const money = parseMoney(m[1]);
      if (money == null) continue;
      const unit = parseUnit(m[2]);
      if (!unit || !(unit.qty > 0)) continue;
      // money and qty are kept so an ambiguous ounce can be re-read from
      // source (see ounceAsVolume) rather than rescaled by a factor ratio.
      return { dim: unit.dim, perBase: money / unit.qty, money, qty: unit.n, ambiguous: unit.ambiguous };
    }
    return null;
  }

  /*
   * Fallback when Amazon shows no unit price: read the quantity out of the
   * title. Only units in `wantDim` are accepted, which is what stops a
   * "32 inch monitor" being read as a size on a volume search.
   *
   * "2 Pack of 32 fl oz" multiplies to 64 fl oz. A bare "24 Count" on a
   * count search is 24.
   */
  const QTY_RE = /(\d+(?:[.,]\d+)?)\s*-?\s*([a-z\u00b2]+(?:\s+[a-z]+)?)/gi;
  const PACK_WORDS = /^(pack|pk|count|ct|box|case|bundle|set)$/;

  function parseTitleQuantity(title, wantDim) {
    if (!title || !wantDim) return null;
    const text = " " + String(title).toLowerCase().replace(/[()\[\],]/g, " ") + " ";

    let leadPack = null; // "2 Pack ..."  -> a genuine multiplier
    let ofPack = null; // "Pack of 12 ..." -> the 12 usually IS the measure
    let measureQty = null;

    const ofForm = text.match(/\b(?:pack|box|case|set|bundle)\s+of\s+(\d+)/);
    if (ofForm) ofPack = parseFloat(ofForm[1]);

    QTY_RE.lastIndex = 0;
    let m;
    while ((m = QTY_RE.exec(text))) {
      const n = parseFloat(m[1].replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) continue;
      const word = m[2].trim();
      if (PACK_WORDS.test(word.split(" ")[0])) {
        // A number sitting directly before the pack word is a real multiplier,
        // unless it is the tail of "pack of N".
        if (leadPack == null && !(ofPack != null && n === ofPack)) leadPack = n;
        continue;
      }
      const u = parseUnit(word, wantDim);
      if (!u || u.dim !== wantDim) continue;
      if (measureQty == null) measureQty = n * u.qty;
    }

    if (measureQty != null) {
      return measureQty * (leadPack != null && leadPack > 1 ? leadPack : 1);
    }
    if (wantDim === "count") {
      const q = leadPack != null ? leadPack : ofPack;
      return q && q > 0 ? q : null;
    }
    return null;
  }

  // The volume reading of an ambiguous-ounce unit price, recomputed from the
  // tile's own money and quantity.
  function ounceAsVolume(unit) {
    if (!unit || !unit.ambiguous) return unit;
    return { ...unit, dim: "volume", perBase: unit.money / (unit.qty * FL_OZ) };
  }

  window.AVSUnits = {
    DIMENSIONS,
    parseUnit,
    parseMoney,
    parseUnitPrice,
    parseTitleQuantity,
    ounceAsVolume,
  };
})();
