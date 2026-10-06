const test = require("node:test");
const assert = require("node:assert");

global.window = {};
global.location = { href: "https://www.amazon.com/s?k=test" };
global.document = { querySelector: () => null, querySelectorAll: () => [] };

require("../units.js");
require("../content.js");
const U = window.AVSUnits;
const { detectBasis, effectivePrice, score, setSettings } = window.__avsInternals;

const mk = (title, price, unitTxt, rating, reviews) => ({
  el: null,
  title,
  price,
  unit: unitTxt ? U.parseUnitPrice(unitTxt) : null,
  rating,
  reviews,
  sponsored: false,
});

const detergent = () => [
  mk("Tide Liquid Detergent, 2 Pack of 32 fl oz", 24.99, "($0.39/Fl Oz)", 4.7, 21000),
  mk("Persil ProClean 100 fl oz", 18.99, "($0.19/Fl Oz)", 4.6, 9400),
  mk("Arm & Hammer 144 fl oz", 11.97, "($0.08/Fl Oz)", 4.5, 33000),
  mk("Seventh Generation 90 fl oz", 15.49, null, 4.4, 6100),
  mk("Boutique Eco Detergent 25 fl oz", 22.0, null, 4.9, 7),
  mk("All Free Clear 88 fl oz", 13.49, "($0.15/Fl Oz)", 4.6, 15000),
];

const monitors = () => [
  mk("Samsung 32 inch Curved Monitor", 279.99, null, 4.5, 8200),
  mk("LG 27 inch IPS Monitor", 199.99, null, 4.6, 14000),
  mk("Dell 24 inch Monitor", 139.99, null, 4.4, 30000),
  mk("AOC 27 inch Gaming", 179.0, null, 4.3, 5100),
  mk("Obscure 32 inch Monitor", 249.0, null, 4.9, 4),
];

const ranked = (items, basis, w) => {
  setSettings({ weight: w, priorMean: 4.3, priorStrength: 30 });
  return score(items, basis)
    .filter((p) => p.value != null)
    .sort((a, b) => b.value - a.value);
};

test("basis detection picks a shared unit when coverage is high", () => {
  assert.equal(detectBasis(detergent()), "volume");
});

test("basis detection falls back to list price with no shared unit", () => {
  assert.equal(detectBasis(monitors()), null);
});

test("title fallback fills gaps only inside the detected dimension", () => {
  const items = detergent();
  const seventh = items.find((p) => p.title.startsWith("Seventh"));
  // 90 fl oz = 2661.6 ml; 15.49 / 2661.6 = 0.00582 per ml
  assert.ok(Math.abs(effectivePrice(seventh, "volume") - 0.00582) < 0.0002);
  const samsung = monitors()[0];
  assert.equal(effectivePrice(samsung, "volume"), null);
});

test("shrinkage stops a thin 4.9 from topping a quality-weighted sort", () => {
  const top = ranked(detergent(), "volume", 0.75)[0];
  assert.notEqual(top.title, "Boutique Eco Detergent 25 fl oz");
  const boutique = ranked(detergent(), "volume", 0.75).find((p) =>
    p.title.startsWith("Boutique")
  );
  assert.ok(boutique.adj < 4.45, `adjusted ${boutique.adj}`);
});

test("the slider actually moves the order", () => {
  const cheap = ranked(detergent(), "volume", 0.0)[0].title;
  const good = ranked(detergent(), "volume", 1.0)[0].title;
  assert.notEqual(cheap, good);
  assert.ok(cheap.includes("Arm & Hammer"));
});

test("scores stay inside 0-1", () => {
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    for (const p of ranked(detergent(), "volume", w)) {
      assert.ok(p.value >= -1e-9 && p.value <= 1 + 1e-9, `${p.value}`);
    }
  }
});

// n identical tiles carrying one unit-price string.
const tiles = (n, unitTxt) =>
  Array.from({ length: n }, (_, i) => mk(`${unitTxt} ${i}`, 10, unitTxt, 4.5, 100));
const FL_OZ = "($0.30/Fl Oz)";
const LB = "($4.00/lb)";
const OZ = "($0.33/Ounce)";

test("bare ounces follow volume when volume leads on unambiguous evidence", () => {
  // Counting ounces as mass, as before, would give mass 5 vs volume 3.
  const items = [...tiles(3, FL_OZ), ...tiles(1, LB), ...tiles(4, OZ)];
  assert.equal(detectBasis(items), "volume");
  const oz = items.find((p) => p.title.startsWith(OZ));
  assert.equal(oz.unit.dim, "volume");
  assert.ok(Math.abs(oz.unit.perBase - 0.33 / 29.5735) < 1e-9, `${oz.unit.perBase}`);
});

test("bare ounces stay mass when mass leads on unambiguous evidence", () => {
  assert.equal(detectBasis([...tiles(1, FL_OZ), ...tiles(3, LB), ...tiles(4, OZ)]), "mass");
});

test("bare ounces stay mass with no unambiguous evidence either way", () => {
  assert.equal(detectBasis(tiles(6, OZ)), "mass");
});

test("ounces never vote for where ounces go", () => {
  // Mass leads 3-2 unambiguously. Letting the 5 ounces count toward volume
  // first would make volume lead 7-3 and pull them along.
  assert.equal(detectBasis([...tiles(2, FL_OZ), ...tiles(3, LB), ...tiles(5, OZ)]), "mass");
});

test("a tie on unambiguous evidence leaves ounces in mass", () => {
  assert.equal(detectBasis([...tiles(2, FL_OZ), ...tiles(2, LB), ...tiles(2, OZ)]), "mass");
});

test("a small unambiguous minority cannot reclassify a large ounce pile", () => {
  // The coffee page: one canned drink against 46 bags.
  assert.equal(detectBasis([...tiles(1, FL_OZ), ...tiles(46, OZ)]), "mass");
  // An absolute floor of 3 would pass this one; the 25% proportion does not.
  assert.equal(detectBasis([...tiles(3, FL_OZ), ...tiles(46, OZ)]), "mass");
  // At a quarter of the pile, the evidence is enough.
  assert.equal(detectBasis([...tiles(12, FL_OZ), ...tiles(46, OZ)]), "volume");
});

// A page of `total` priced tiles: `vol` in fl oz, `cnt` by count, rest unpriced per unit.
const page = (total, vol, cnt = 0) => [
  ...tiles(vol, FL_OZ),
  ...tiles(cnt, "($0.20/Count)"),
  ...tiles(total - vol - cnt, null),
];

test("with no memory, unit mode engages at 55% as before", () => {
  assert.equal(detectBasis(page(20, 11)), "volume"); // 55%
  assert.equal(detectBasis(page(20, 10)), null); // 50%
});

test("a remembered basis is kept until its coverage drops below 45%", () => {
  assert.equal(detectBasis(page(20, 10), "volume"), "volume"); // 50%
  assert.equal(detectBasis(page(20, 9), "volume"), "volume"); // 45%
  assert.equal(detectBasis(page(25, 11), "volume"), null); // 44%
});

test("switching dimension needs 55% and a 15-point lead over the remembered one", () => {
  assert.equal(detectBasis(page(20, 8, 12), "volume"), "count"); // 60 vs 40
  assert.equal(detectBasis(page(20, 9, 11), "volume"), "volume"); // 55 vs 45: lead too small
  // Lead too small to switch, and the remembered basis is under 45%: neither.
  assert.equal(detectBasis(page(25, 11, 14), "volume"), null); // 56 vs 44
});

test("outside the 30-70% band, memory is ignored", () => {
  assert.equal(detectBasis(page(20, 5, 15), "volume"), "count"); // 75%
  assert.equal(detectBasis(page(20, 5), "volume"), null); // 25%
});

test.after(() => clearInterval(window.__avsPoll));
