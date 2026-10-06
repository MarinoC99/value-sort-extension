const test = require("node:test");
const assert = require("node:assert");

global.window = {};
require("../units.js");
const U = window.AVSUnits;

const close = (a, b, tol = 0.5) =>
  a != null && b != null && Math.abs(a - b) < tol;

test("unit price parses currency, separators and multipliers", () => {
  const cases = [
    ["($0.52/Count)", "count", 0.52],
    ["($12.99/kg)", "mass", 0.01299],
    ["(\u00a31.20/100 g)", "mass", 0.012],
    ["($2.00 / 100 ml)", "volume", 0.02],
    ["($0.33/Ounce)", "mass", 0.011640],
    ["(\u20ac3,50/Liter)", "volume", 0.0035],
    ["($1.25/Sq Ft)", "area", 0.001345],
    ["$0.18 / Item", "count", 0.18],
  ];
  for (const [text, dim, perBase] of cases) {
    const r = U.parseUnitPrice(text);
    assert.ok(r, `no parse for ${text}`);
    assert.equal(r.dim, dim, text);
    assert.ok(close(r.perBase, perBase, perBase * 0.01), `${text}: ${r.perBase}`);
  }
});

test("unit price reads the amount once when the tile repeats it", () => {
  // Real tiles carry a screen-reader copy and a visible copy side by side.
  const r = U.parseUnitPrice("($0.49$0.49/Count)");
  assert.ok(r, "no parse");
  assert.equal(r.dim, "count");
  assert.ok(close(r.perBase, 0.49, 0.001), `${r.perBase}`);
});

test("a bare ounce unit price is mass, flagged ambiguous, with its source kept", () => {
  const r = U.parseUnitPrice("($0.33/Ounce)");
  assert.equal(r.dim, "mass");
  assert.equal(r.ambiguous, true);
  assert.equal(r.money, 0.33);
  assert.equal(r.qty, 1);
  assert.equal(U.parseUnitPrice("($0.26/Fl Oz)").ambiguous, false);
});

test("an ambiguous ounce re-read as volume is recomputed from source", () => {
  const v = U.ounceAsVolume(U.parseUnitPrice("($0.33/Ounce)"));
  assert.equal(v.dim, "volume");
  assert.ok(close(v.perBase, 0.33 / 29.5735, 1e-9), `${v.perBase}`);
  const plain = U.parseUnitPrice("($0.26/Fl Oz)");
  assert.equal(U.ounceAsVolume(plain), plain);
});

test("a bare oz in a title follows the dimension being searched", () => {
  assert.ok(close(U.parseTitleQuantity("Travel Size 2 oz", "volume"), 59.147, 0.01));
  assert.ok(close(U.parseTitleQuantity("Travel Size 2 oz", "mass"), 56.699, 0.01));
  assert.ok(close(U.parseTitleQuantity("Shampoo 1.7 Oz (4 - Pack)", "volume"), 201.1, 0.1));
});

test("vocabulary covers units seen on real tiles", () => {
  // Both from saved amazon.com searches (laundry detergent, coffee).
  const load = U.parseUnitPrice("($0.18/medium loads)");
  assert.equal(load.dim, "count");
  assert.ok(close(load.perBase, 0.18, 0.001));
  assert.equal(U.parseTitleQuantity("Half a Dozen Cans (6 Cans) of Coffee Du Monde", "count"), 6);
});

test("unit price ignores non-unit strings", () => {
  for (const s of ["$24.99", "(4.5 out of 5 stars)", "Free delivery Tue, Mar 4"]) {
    assert.equal(U.parseUnitPrice(s), null, s);
  }
});

test("title quantity multiplies packs without double counting", () => {
  const cases = [
    ["Tide Liquid Detergent, 2 Pack of 32 fl oz", "volume", 1892.7],
    ["AmazonBasics AAA Batteries, 36 Count", "count", 36],
    ["Paper Towels, Pack of 12 Rolls", "count", 12],
    ["Bounty 2 Pack of 6 Rolls", "count", 12],
    ["Organic Coffee Beans 2 lb Bag", "mass", 907.18],
    ["Olive Oil 750ml", "volume", 750],
    ["Sparkling Water 12-Pack 12 fl oz Cans", "volume", 4258.58],
    ["Protein Powder 5lb (80 servings)", "mass", 2267.96],
    ["Dish Soap Pack of 3", "count", 3],
  ];
  for (const [title, dim, want] of cases) {
    const got = U.parseTitleQuantity(title, dim);
    assert.ok(close(got, want), `${title} -> ${got}, want ${want}`);
  }
});

test("dimension guard rejects units outside the detected dimension", () => {
  // The guard that stops "32 inch" being read as a size on a volume search.
  assert.equal(U.parseTitleQuantity("Samsung 32 inch Curved Monitor", "volume"), null);
  assert.equal(U.parseTitleQuantity("Samsung 32 inch Curved Monitor", "count"), null);
  assert.equal(U.parseTitleQuantity("LG 27 inch IPS Monitor", "mass"), null);
});

test("parseMoney handles both decimal conventions", () => {
  assert.ok(close(U.parseMoney("$1,234.56"), 1234.56, 0.01));
  assert.ok(close(U.parseMoney("\u20ac1.234,56"), 1234.56, 0.01));
  assert.ok(close(U.parseMoney("24,99"), 24.99, 0.01));
  assert.equal(U.parseMoney("free"), null);
});
