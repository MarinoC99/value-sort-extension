/*
 * Fixture harness: loads each saved Amazon results page in jsdom, runs the
 * extension's extraction, and reports per-field hit rates.
 *
 *   npm run fixtures            # summary table
 *   npm run fixtures -- -v      # plus every tile's extracted fields
 *
 * "on tile" counts tiles where an independent reference read finds the field.
 * "correct" means the extractor returned the same value; "wrong" means it
 * returned a different one; "extra" means it returned a value the reference
 * could not find. Hit rate is correct / on tile.
 */

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const SRC = ["units.js", "content.js"].map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"));
const verbose = process.argv.includes("-v");

function load(file) {
  const html = fs.readFileSync(path.join(FIXTURES, file), "utf8");
  const host = /amazon\.de/i.test(file) ? "www.amazon.de" : "www.amazon.com";
  // Amazon's inline CSS uses nesting, which jsdom's parser rejects. Harmless
  // here, so swallow jsdom's own errors and forward everything else.
  const virtualConsole = new VirtualConsole();
  virtualConsole.sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(html, {
    url: `https://${host}/s?k=fixture`,
    runScripts: "outside-only",
    virtualConsole,
  });
  const w = dom.window;
  // A storage stub whose callback never fires keeps content.js from running
  // start(), so the page is not re-ordered or badged under the harness.
  w.chrome = { storage: { local: { get() {}, set() {} } } };
  for (const src of SRC) w.eval(src);
  return { dom, w };
}

/*
 * Independent references. Each reads the same field from a different part of
 * the tile than the extractor does, so agreement means the value is right,
 * not just that something was returned. Screen-reader duplicates
 * (aria-hidden) are stripped first, which is what a human sees.
 */
function visibleText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('[aria-hidden="true"], script, style').forEach((n) => n.remove());
  return c.textContent.replace(/\s+/g, " ").trim();
}

const MONEY = /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|USD|EUR))/;

function refs(el, U) {
  const out = {};
  const recipe = el.querySelector('[data-cy="price-recipe"]') || el;
  const priceText = visibleText(recipe)
    .replace(/\([^()]*\)/g, " ") // unit price
    .replace(/(Typical|List|UVP|Was|Vorher)\s*:?\s*\S+/gi, " "); // reference prices
  const pm = priceText.match(MONEY);
  out.price = pm ? U.parseMoney(pm[0]) : null;

  out.rating = null;
  for (const n of el.querySelectorAll("[aria-label], .a-icon-alt")) {
    const t = n.getAttribute("aria-label") || n.textContent || "";
    const m = t.match(/(\d[.,]\d)\s*(?:out of|von)\s*5/i);
    if (m) {
      out.rating = parseFloat(m[1].replace(",", "."));
      break;
    }
  }

  out.reviews = null;
  for (const n of el.querySelectorAll("[aria-label]")) {
    const m = n.getAttribute("aria-label").match(/^\s*([\d.,]+)\s+(ratings?|reviews?|Bewertungen|Sternebewertungen)\b/i);
    if (m) {
      out.reviews = parseInt(m[1].replace(/[.,]/g, ""), 10);
      break;
    }
  }

  const text = visibleText(el);
  const um = text.match(/\(([^()]*\d[^()]*\/[^()]{1,30})\)/);
  out.unitRaw = um ? um[1] : null;
  out.unit = um ? U.parseUnitPrice(`(${um[1]})`) : null;

  // No leading \b: the label often runs straight on from a badge ("MonitorsSponsored").
  out.sponsored = /(Sponsored|Gesponsert)\b/.test(text);
  return out;
}

const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
const AGREE = {
  price: (f, r) => close(f, r, 0.001),
  rating: (f, r) => f === r,
  reviews: (f, r) => f === r,
  unit: (f, r) => f.dim === r.dim && close(f.perBase, r.perBase, 0.01),
  sponsored: (f, r) => f === r,
};

const FIELDS = ["price", "rating", "reviews", "unit", "sponsored"];
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const has = (f, v) => (f === "sponsored" ? v === true : v != null);

/*
 * Title-derived unit prices. Where the extension actually uses them, the tile
 * has no published unit price, so there is nothing on the tile to check them
 * against. Instead, run the same title path on tiles that do publish one in
 * the basis dimension and score it against Amazon's figure. That measures
 * the method where the truth is known; tiles where it really fires are
 * counted separately and listed under -v for eyeballing.
 */
function checkTitles(priced, basis, U) {
  const out = { checked: 0, correct: 0, wrong: [], noQty: 0, fires: [] };
  for (const p of priced) {
    const qty = U.parseTitleQuantity(p.title, basis);
    if (!(p.unit && p.unit.dim === basis)) {
      out.fires.push({ title: p.title, est: qty ? p.price / qty : null });
      continue;
    }
    out.checked++;
    if (!qty) {
      out.noQty++;
      continue;
    }
    // Amazon rounds its figure to the cent per stated unit, so allow half a
    // cent of that plus 2%.
    const est = p.price / qty;
    const tol = 0.02 + 0.005 / p.unit.money;
    if (Math.abs(est - p.unit.perBase) <= tol * p.unit.perBase) out.correct++;
    else out.wrong.push({ title: p.title, ratio: est / p.unit.perBase });
  }
  return out;
}

function report(file) {
  const { dom, w } = load(file);
  const I = w.__avsInternals;
  try {
    const items = I.collect(() => true);
    const rows = items.map((p) => ({ p, ref: refs(p.el, w.AVSUnits) }));

    const stats = {};
    for (const f of FIELDS) {
      const s = { ref: 0, correct: 0, wrong: 0, missed: 0, extra: 0 };
      for (const { p, ref } of rows) {
        const got = has(f, p[f]);
        const want = has(f, ref[f]);
        if (want) s.ref++;
        if (got && want) AGREE[f](p[f], ref[f]) ? s.correct++ : s.wrong++;
        else if (want) s.missed++;
        else if (got) s.extra++;
      }
      stats[f] = s;
    }

    // Unit strings on the tile that the vocabulary cannot read (input to step 5).
    const unparsed = [...new Set(rows.filter((r) => r.ref.unitRaw && !r.ref.unit).map((r) => r.ref.unitRaw))];

    // After the field checks: detectBasis resolves bare ounces in place, so
    // coverage below is what the ranking actually used.
    const basis = I.detectBasis(items);
    const priced = items.filter((p) => p.price != null);
    const bare = priced.filter((p) => p.unit && p.unit.ambiguous);
    const ounces = bare.length ? `${bare.length} bare-ounce tiles read as ${bare[0].unit.dim}` : "";
    const tally = {};
    for (const p of priced) if (p.unit) tally[p.unit.dim] = (tally[p.unit.dim] || 0) + 1;
    const coverage = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${d} ${pct(n, priced.length)}`)
      .join(", ");

    const title = basis ? checkTitles(priced, basis, w.AVSUnits) : null;
    const missing = I.missingPrices(items);

    return { file, n: items.length, priced: priced.length, stats, unparsed, basis, coverage, ounces, title, missing, rows };
  } finally {
    w.clearInterval(w.__avsPoll);
    dom.window.close();
  }
}

const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".html")).sort();
if (!files.length) {
  console.error("No fixtures in ./fixtures");
  process.exit(1);
}

const fmtUnit = (u) => (u ? `${u.dim}:${u.perBase.toPrecision(3)}` : "-");

for (const file of files) {
  const r = report(file);
  console.log(`\n${file}  (${r.n} tiles, ${r.priced} priced)`);
  console.log("  field       on tile  correct  hit rate  wrong  missed  extra");
  for (const f of FIELDS) {
    const s = r.stats[f];
    console.log(
      `  ${f.padEnd(10)}  ${String(s.ref).padStart(7)}  ${String(s.correct).padStart(7)}  ` +
        `${pct(s.correct, s.ref).padStart(8)}  ${String(s.wrong).padStart(5)}  ${String(s.missed).padStart(6)}  ${String(s.extra).padStart(5)}`
    );
  }
  console.log(
    `  unit coverage of priced: ${r.coverage || "none"}  ->  basis: ${r.basis || "list price"}` +
      (r.ounces ? `  (${r.ounces})` : "")
  );
  if (r.missing) console.log(`  most results unpriced: ${r.missing === "hidden" ? "no price shown on the tile (hidden by Amazon)" : "price shown but unreadable"}`);
  if (r.unparsed.length) console.log(`  unit strings not in vocabulary: ${r.unparsed.map((u) => JSON.stringify(u)).join(", ")}`);
  if (r.title) {
    const t = r.title;
    const withQty = t.checked - t.noQty;
    console.log(
      `  title estimate vs Amazon's unit price: ${t.checked} checkable, ${t.correct} correct ` +
        `(${pct(t.correct, withQty)} of those with a title quantity), ${t.wrong.length} wrong, ${t.noQty} no quantity`
    );
    console.log(`  title estimate actually used: ${t.fires.filter((f) => f.est != null).length} tiles (unchecked)`);
    if (verbose) {
      for (const x of t.wrong) console.log(`    wrong x${x.ratio.toPrecision(3)}  ${x.title.slice(0, 90)}`);
      for (const x of t.fires) if (x.est != null) console.log(`    used (unchecked)  ${x.title.slice(0, 90)}`);
    }
  }

  if (verbose) {
    console.log("    extracted (price rating reviews unit S) | reference where different | title");
    for (const { p, ref } of r.rows) {
      const diff = FIELDS.filter((f) => {
        const got = has(f, p[f]);
        const want = has(f, ref[f]);
        return got !== want || (got && !AGREE[f](p[f], ref[f]));
      }).map((f) => `${f}=${f === "unit" ? fmtUnit(ref.unit) + (ref.unitRaw ? ` "${ref.unitRaw}"` : "") : ref[f]}`);
      console.log(
        `    ${String(p.price ?? "-").padStart(8)}  ${String(p.rating ?? "-").padStart(3)}  ` +
          `${String(p.reviews ?? "-").padStart(7)}  ${fmtUnit(p.unit).padEnd(16)} ${p.sponsored ? "S" : " "}  ` +
          `${diff.length ? "| " + diff.join(" ") + " " : ""}| ${p.title.slice(0, 50)}`
      );
    }
  }
}
