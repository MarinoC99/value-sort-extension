/*
 * Value Sort for Amazon
 *
 * Re-orders the search results already on the page by a score you control:
 * a weighted blend of review quality and price. Nothing is fetched; it reads
 * only what the page has already rendered.
 *
 * Price basis is detected per search. If most results share a unit (ml, g,
 * count), ranking uses price per unit; otherwise it falls back to list price.
 */

(() => {
  "use strict";

  if (window.__avsLoaded) return;
  window.__avsLoaded = true;

  const U = window.AVSUnits;
  if (!U) return;

  const DEFAULTS = {
    weight: 0.5, // 0 = price only, 1 = quality only
    priorMean: 4.3, // what an unknown product is assumed to be worth
    priorStrength: 30, // reviews needed to outvote that assumption
    minReviews: 0,
    hideSponsored: true,
    enabled: true,
    collapsed: false,
  };

  // Share of priced results that must agree on a unit before we rank by it.
  const UNIT_COVERAGE = 0.55;

  // Fewer priced results than this and there is nothing to detect.
  const MIN_PRICED = 4;

  // Hysteresis around UNIT_COVERAGE, so a search near the threshold does not
  // flip basis between loads. A remembered basis is kept down to
  // KEEP_COVERAGE; a different dimension takes over only at UNIT_COVERAGE and
  // SWITCH_MARGIN ahead of it. Outside the band, memory is ignored.
  const KEEP_COVERAGE = 0.45;
  const SWITCH_MARGIN = 0.15;
  const BAND_LOW = 0.3;
  const BAND_HIGH = 0.7;

  // Last basis per search, in chrome.storage.local, least recently used out.
  const MEMORY_KEY = "avsBasis";
  const MEMORY_LIMIT = 200;

  // Unambiguous evidence must be at least this share of the bare-ounce pile
  // before it decides which dimension that pile belongs to.
  const OUNCE_EVIDENCE = 0.25;

  let settings = { ...DEFAULTS };
  let reordering = false;
  let anchors = null;
  let originalOrder = null;
  let currency = "";
  let basisMemory = {};
  const touched = new Set(); // searches whose last-used time this page has refreshed

  const PRICE_POLE = "#5fd3a6";
  const QUALITY_POLE = "#8b9bff";

  /* ---------------------------------------------------------------- utils */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function mixHex(a, b, t) {
    const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = parse(a);
    const [r2, g2, b2] = parse(b);
    const ch = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
    return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`;
  }

  function money(v) {
    if (v == null) return "\u2014";
    const digits = v < 1 ? 3 : v < 10 ? 2 : 2;
    return currency + v.toFixed(digits);
  }

  /* ----------------------------------------------------------- extraction */

  function resultContainer() {
    return (
      document.querySelector("div.s-main-slot.s-result-list") ||
      document.querySelector("div.s-main-slot") ||
      null
    );
  }

  // Skips tiles Amazon renders but hides. The predicate is a seam for the
  // jsdom harness, which has no layout and so cannot satisfy this check.
  const isRendered = (el) => el.offsetParent !== null || el.getClientRects().length;

  function tiles(visible = isRendered) {
    return Array.from(
      document.querySelectorAll('div[data-component-type="s-search-result"]')
    ).filter(visible);
  }

  // Current price. Skips .a-text-price, which is the struck-through list price.
  function readPrice(tile) {
    const nodes = tile.querySelectorAll(".a-price .a-offscreen");
    for (const n of nodes) {
      if (n.closest(".a-text-price")) continue;
      const v = U.parseMoney(n.textContent);
      if (v != null) {
        if (!currency) {
          const sym = (n.textContent.match(/^\s*([^\d\s.,-]{1,3})/) || [])[1];
          if (sym) currency = sym;
        }
        return v;
      }
    }
    const whole = tile.querySelector(".a-price-whole");
    if (whole) {
      const frac = tile.querySelector(".a-price-fraction");
      const v = U.parseMoney(
        whole.textContent.replace(/[.,]\s*$/, "") + "." + (frac ? frac.textContent : "0")
      );
      if (v != null) return v;
    }
    return null;
  }

  // The "($0.52/Count)" string Amazon puts beside the price on some tiles.
  function readUnitPrice(tile) {
    const nodes = tile.querySelectorAll(
      ".a-price + span, .a-size-base.a-color-secondary, .a-color-secondary, .a-size-mini"
    );
    for (const n of nodes) {
      const text = n.textContent || "";
      if (!text.includes("/")) continue;
      if (/out of 5/i.test(text)) continue;
      const r = U.parseUnitPrice(text);
      if (r) return r;
    }
    return null;
  }

  function readRating(tile) {
    const labelled = tile.querySelector('[aria-label*="out of 5"]');
    if (labelled) {
      const m = labelled.getAttribute("aria-label").match(/([\d.,]+)\s*out of\s*5/i);
      if (m) return parseFloat(m[1].replace(",", "."));
    }
    const alt = tile.querySelector("i.a-icon-star-small .a-icon-alt, i.a-icon-star .a-icon-alt");
    if (alt) {
      const m = alt.textContent.match(/([\d.,]+)\s*out of\s*5/i);
      if (m) return parseFloat(m[1].replace(",", "."));
    }
    const cls = tile.querySelector('[class*="a-star-small-"], [class*="a-star-"]');
    if (cls) {
      const m = cls.className.match(/a-star(?:-small)?-(\d)(?:-(\d))?/);
      if (m) return parseFloat(`${m[1]}.${m[2] || 0}`);
    }
    return null;
  }

  // An aria-label is only a review count if that is all it says: "53 ratings".
  // The substring selectors below also catch titles ("Hydrating Shampoo 1.7 Oz"
  // contains "rating"), whose first number is not a count.
  const COUNT_LABEL = /^\s*\(?[\d.,]+\)?\s*(?:global\s+)?(?:ratings?|reviews?)?\s*$/i;

  function readReviewCount(tile) {
    const cand = tile.querySelectorAll(
      '[aria-label*="rating"], [aria-label*="review"], a[href*="customerReviews"] span, .s-underline-text'
    );
    for (const n of cand) {
      const label = n.getAttribute("aria-label");
      if (label && !COUNT_LABEL.test(label)) continue;
      // Unlabelled text only counts inside the ratings link: .s-underline-text
      // is also on the price link, which would read "$7.60" as 760 reviews.
      if (!label && !n.closest('a[href*="customerReviews"]')) continue;
      const text = label || n.textContent || "";
      if (/out of 5/i.test(text)) continue;
      // "(77.6K)" is abbreviated; stripping the separator would read 776.
      if (/\d\s*[km](?![a-z])/i.test(text)) continue;
      const m = text.replace(/\s/g, "").match(/([\d.,]{1,12})/);
      if (!m) continue;
      const v = parseInt(m[1].replace(/[.,]/g, ""), 10);
      if (Number.isFinite(v) && v >= 0) return v;
    }
    return null;
  }

  function isSponsored(tile) {
    if (tile.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text")) return true;
    const label = tile.querySelector('[aria-label="Sponsored"], .a-color-secondary .a-text-bold');
    return !!(label && /sponsor/i.test(label.textContent || ""));
  }

  function titleOf(tile) {
    const h = tile.querySelector("h2");
    return h ? h.textContent.trim() : "";
  }

  function collect(visible) {
    return tiles(visible).map((el) => ({
      el,
      title: titleOf(el),
      price: readPrice(el),
      unit: readUnitPrice(el),
      rating: readRating(el),
      reviews: readReviewCount(el),
      sponsored: isSponsored(el),
    }));
  }

  /* --------------------------------------------------------- price basis */

  /*
   * Pick the ranking denominator for this search. Unit price only wins if a
   * clear majority of priced results agree on one dimension — a search mixing
   * litres and counts has no shared axis, so it stays on list price.
   */
  /*
   * Whether bare ounces on this page are mass or volume. Three buckets:
   * unambiguous volume (fl oz, ml, l), unambiguous mass (g, kg, lb), and bare
   * ounces held aside. The pile follows whichever of volume/mass leads on the
   * unambiguous evidence alone, never on the ounces themselves, which would be
   * circular. That evidence must also be at least OUNCE_EVIDENCE of the pile:
   * one canned drink on a coffee page should not turn 46 bags into volume.
   * Otherwise, and on a tie, ounces stay mass.
   */
  function ounceDimension(units) {
    let volume = 0;
    let mass = 0;
    let ounces = 0;
    for (const u of units) {
      if (u.ambiguous) ounces++;
      else if (u.dim === "volume") volume++;
      else if (u.dim === "mass") mass++;
    }
    return volume > mass && volume >= OUNCE_EVIDENCE * ounces ? "volume" : "mass";
  }

  function detectBasis(items, remembered) {
    const priced = items.filter((p) => p.price != null);
    if (priced.length < MIN_PRICED) return null;

    // Resolve bare ounces before tallying. This rewrites p.unit in place so
    // effectivePrice sees the same reading the tally used; items come fresh
    // from collect() on every apply, and re-resolving is idempotent.
    const units = priced.filter((p) => p.unit).map((p) => p.unit);
    if (ounceDimension(units) === "volume") {
      for (const p of items) if (p.unit && p.unit.ambiguous) p.unit = U.ounceAsVolume(p.unit);
    }

    const tally = {};
    for (const p of priced) {
      if (p.unit) tally[p.unit.dim] = (tally[p.unit.dim] || 0) + 1;
    }
    const dims = Object.keys(tally);
    if (!dims.length) return null;

    const best = dims.reduce((a, b) => (tally[b] > tally[a] ? b : a));
    const coverage = tally[best] / priced.length;
    const fresh = coverage >= UNIT_COVERAGE ? best : null;

    // Clear pages decide on their own signal, so one bad early reading cannot
    // lock a search in. With the current thresholds this agrees with the rules
    // below anyway; it holds the line if those numbers change.
    if (!remembered || coverage < BAND_LOW || coverage > BAND_HIGH) return fresh;

    const kept = (tally[remembered] || 0) / priced.length;
    if (best !== remembered && coverage >= UNIT_COVERAGE && coverage - kept >= SWITCH_MARGIN) {
      return best;
    }
    // A different dimension that is not far enough ahead does not take over,
    // even once the remembered one has fallen below KEEP_COVERAGE.
    return kept >= KEEP_COVERAGE ? remembered : null;
  }

  /* --------------------------------------------------------- basis memory */

  // "www.amazon.com|hand soap" for /s?k=Hand+Soap. Null off a search page.
  function searchKey() {
    const term = new URLSearchParams(location.search).get("k");
    const norm = term ? term.toLowerCase().replace(/\s+/g, " ").trim() : "";
    return norm ? `${location.hostname}|${norm}` : null;
  }

  function pruneMemory(map) {
    const keys = Object.keys(map);
    if (keys.length <= MEMORY_LIMIT) return;
    keys
      .sort((a, b) => map[a].used - map[b].used)
      .slice(0, keys.length - MEMORY_LIMIT)
      .forEach((k) => delete map[k]);
  }

  // Applies a change to the in-page copy, then to a fresh read of storage, so
  // a write from this tab does not drop entries another tab added meanwhile.
  function persistMemory(change) {
    change(basisMemory);
    try {
      chrome.storage.local.get(MEMORY_KEY, (res) => {
        const stored = (res && res[MEMORY_KEY]) || {};
        change(stored);
        chrome.storage.local.set({ [MEMORY_KEY]: stored });
      });
    } catch (e) {
      /* storage unavailable; memory holds for this page only */
    }
  }

  /*
   * Only a real basis is stored. Landing on list price forgets the search,
   * which is the same as remembering list price: leaving it takes
   * UNIT_COVERAGE either way.
   */
  function rememberBasis(key, basis) {
    if (!key) return;
    const prev = basisMemory[key];
    if (!basis) {
      if (prev) persistMemory((m) => delete m[key]);
      return;
    }
    // Re-renders call this repeatedly: refresh last-used once per page, and
    // write again only when the basis changes.
    if (prev && prev.basis === basis && touched.has(key)) return;
    touched.add(key);
    const entry = { basis, used: Date.now() };
    persistMemory((m) => {
      m[key] = entry;
      pruneMemory(m);
    });
  }

  /*
   * Price per canonical base unit. Uses Amazon's own figure where present,
   * otherwise derives it from the title — but only accepting units in the
   * detected dimension, which is what stops "32 inch monitor" being read as
   * a size on a volume search.
   */
  function effectivePrice(p, basis) {
    if (!basis) return p.price;
    if (p.unit && p.unit.dim === basis) return p.unit.perBase;
    if (p.price == null) return null;
    const qty = U.parseTitleQuantity(p.title, basis);
    return qty && qty > 0 ? p.price / qty : null;
  }

  /* -------------------------------------------------------------- scoring */

  // Shrink the average toward a prior so a 4.9 from 6 reviews can't outrank a
  // 4.4 from 8,000.
  function adjustedRating(p) {
    const { priorMean: C, priorStrength: m } = settings;
    if (p.rating == null) return C * 0.92;
    const v = p.reviews == null ? 0 : p.reviews;
    return (v * p.rating + m * C) / (v + m);
  }

  function normalizer(values) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) return () => 0.5;
    return (x) => (x - lo) / (hi - lo);
  }

  function score(items, basis) {
    const scored = items.map((p) => ({ ...p, adj: adjustedRating(p), eff: effectivePrice(p, basis) }));
    const usable = scored.filter((p) => p.eff != null && p.eff > 0);
    if (!usable.length) return scored.map((p) => ({ ...p, value: null }));

    const w = settings.weight;
    const qNorm = normalizer(usable.map((p) => p.adj));
    // Log price: the gap from $10 to $20 counts the same as $200 to $400.
    const pNorm = normalizer(usable.map((p) => Math.log(p.eff)));

    return scored.map((p) => {
      if (p.eff == null || p.eff <= 0) return { ...p, value: null };
      const quality = qNorm(p.adj);
      const cheapness = 1 - pNorm(Math.log(p.eff));
      return { ...p, value: w * quality + (1 - w) * cheapness };
    });
  }

  /* --------------------------------------------------------------- render */

  function badgeFor(p, rank, basis) {
    const tint = mixHex(PRICE_POLE, QUALITY_POLE, settings.weight);
    const el = document.createElement("div");
    el.className = "avs-badge";
    el.style.setProperty("--avs-badge-tint", tint);

    const rankEl = document.createElement("span");
    rankEl.className = "avs-rank";
    rankEl.textContent = `#${rank}`;

    const sep = document.createElement("span");
    sep.className = "avs-sep";
    sep.textContent = "\u00b7";

    const scoreEl = document.createElement("span");
    scoreEl.textContent = `${Math.round(p.value * 100)}`;

    const detail = document.createElement("span");
    detail.className = "avs-detail";
    const n = p.reviews == null ? "no reviews" : `${p.reviews.toLocaleString()} reviews`;
    if (basis) {
      const d = U.DIMENSIONS[basis];
      const shown = money(p.eff * d.mult);
      const derived = !(p.unit && p.unit.dim === basis);
      detail.textContent = `${shown}/${d.label}${derived ? " est" : ""} \u00b7 ${p.adj.toFixed(2)} from ${n}`;
    } else {
      detail.textContent = `${p.adj.toFixed(2)} from ${n}`;
    }

    el.append(rankEl, sep, scoreEl, detail);
    el.title = basis
      ? "Value score 0\u2013100 at your current ratio. \u201cest\u201d means the unit price was " +
        "worked out from the title because Amazon did not publish one."
      : "Value score 0\u2013100 at your current ratio.";
    return el;
  }

  function clearBadges() {
    document.querySelectorAll(".avs-badge").forEach((b) => b.remove());
    document.querySelectorAll(".avs-dim").forEach((d) => d.classList.remove("avs-dim"));
  }

  function captureOrder() {
    if (anchors) return;
    const list = tiles();
    if (!list.length) return;
    originalOrder = list.slice();
    anchors = list.map((el) => {
      const c = document.createComment("avs");
      el.parentNode.insertBefore(c, el);
      return c;
    });
  }

  function placeInto(ordered) {
    if (!anchors || ordered.length !== anchors.length) return;
    reordering = true;
    ordered.forEach((el) => el.remove());
    ordered.forEach((el, i) => {
      const a = anchors[i];
      if (a && a.parentNode) a.parentNode.insertBefore(el, a);
    });
    reordering = false;
  }

  function setStatus(text, tone) {
    const el = document.getElementById("avs-status");
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone || "";
  }

  function apply() {
    if (!resultContainer()) {
      setStatus("No search results on this page.");
      return;
    }

    captureOrder();
    clearBadges();

    if (!settings.enabled) {
      if (originalOrder) placeInto(originalOrder);
      setStatus("Showing Amazon's original order.");
      return;
    }

    const raw = collect();
    const key = searchKey();
    const basis = detectBasis(raw, key && basisMemory[key] ? basisMemory[key].basis : null);
    // A page with too few prices says nothing about the search; don't let a
    // half-rendered page wipe what an earlier load learned.
    if (basis || raw.filter((p) => p.price != null).length >= MIN_PRICED) rememberBasis(key, basis);
    const items = score(raw, basis);
    const total = items.length;

    const keep = [];
    const aside = [];
    for (const p of items) {
      const tooFew = settings.minReviews > 0 && (p.reviews ?? 0) < settings.minReviews;
      const drop = (settings.hideSponsored && p.sponsored) || tooFew || p.value == null;
      if (drop) {
        p.el.classList.add("avs-dim");
        aside.push(p);
      } else {
        keep.push(p);
      }
    }

    keep.sort((a, b) => b.value - a.value);
    keep.forEach((p, i) => {
      const anchor =
        p.el.querySelector("h2") || p.el.querySelector(".a-price") || p.el.firstElementChild;
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(badgeFor(p, i + 1, basis), anchor);
      }
    });

    placeInto([...keep, ...aside].map((p) => p.el));

    // Say which denominator was chosen. With no control over it, the user
    // needs to see the guess to know whether to trust the order.
    if (basis) {
      const d = U.DIMENSIONS[basis];
      const derived = keep.filter((p) => !(p.unit && p.unit.dim === basis)).length;
      setStatus(
        `Ranking by price per ${d.label} \u00b7 ${keep.length} of ${total} results` +
          (derived ? ` \u00b7 ${derived} estimated from titles` : "")
      );
    } else {
      const unpriced = items.filter((p) => p.price == null).length;
      if (unpriced > total / 2) {
        setStatus("Couldn't read prices for most results \u2014 Amazon may have changed its markup.", "warn");
      } else {
        setStatus(`Ranking by list price \u00b7 ${keep.length} of ${total} results \u00b7 no shared unit`);
      }
    }
  }

  const applySoon = debounce(apply, 180);

  /* ---------------------------------------------------------------- panel */

  function buildPanel() {
    if (document.getElementById("avs-panel")) return;

    const tab = document.createElement("div");
    tab.id = "avs-tab";
    tab.setAttribute("role", "button");
    tab.setAttribute("tabindex", "0");
    tab.innerHTML = '<span class="avs-dot"></span><span>Value sort</span>';

    const panel = document.createElement("div");
    panel.id = "avs-panel";
    panel.innerHTML = `
      <div class="avs-head">
        <span class="avs-title">Value sort</span>
        <button class="avs-collapse" id="avs-collapse" aria-label="Hide panel">\u2212</button>
      </div>
      <div class="avs-ratio">
        <span class="avs-q" id="avs-q">50</span>
        <span class="avs-slash">/</span>
        <span class="avs-p" id="avs-p">50</span>
      </div>
      <div class="avs-ratio-legend"><span>quality</span><span>price</span></div>
      <input class="avs-slider" id="avs-weight" type="range" min="0" max="100" step="1"
             aria-label="Quality against price" />
      <div class="avs-row">
        <label for="avs-enabled">Re-sort results</label>
        <input type="checkbox" id="avs-enabled" />
      </div>
      <div class="avs-row">
        <label for="avs-minrev">Hide under</label>
        <input type="number" id="avs-minrev" min="0" step="10" aria-label="Minimum reviews" />
      </div>
      <div class="avs-row">
        <label for="avs-sponsored">Hide sponsored</label>
        <input type="checkbox" id="avs-sponsored" />
      </div>
      <div class="avs-row">
        <label for="avs-strength" title="Reviews needed before a product's own average outweighs the baseline">Trust after</label>
        <input type="number" id="avs-strength" min="1" max="500" step="5" aria-label="Prior strength in reviews" />
      </div>
      <div class="avs-status" id="avs-status"></div>
    `;

    document.body.append(tab, panel);

    const $ = (id) => document.getElementById(id);
    const weight = $("avs-weight");

    function paint() {
      const q = Math.round(settings.weight * 100);
      $("avs-q").textContent = q;
      $("avs-p").textContent = 100 - q;
      const blend = mixHex(PRICE_POLE, QUALITY_POLE, settings.weight);
      panel.style.setProperty("--avs-blend", blend);
      tab.style.setProperty("--avs-blend", blend);
      panel.dataset.visible = settings.collapsed ? "0" : "1";
      tab.dataset.visible = settings.collapsed ? "1" : "0";
    }

    function sync() {
      weight.value = String(Math.round(settings.weight * 100));
      $("avs-enabled").checked = settings.enabled;
      $("avs-sponsored").checked = settings.hideSponsored;
      $("avs-minrev").value = String(settings.minReviews);
      $("avs-strength").value = String(settings.priorStrength);
      paint();
    }

    function save() {
      try {
        chrome.storage.local.set({ avs: settings });
      } catch (e) {
        /* storage unavailable; settings hold for this page only */
      }
    }

    weight.addEventListener("input", () => {
      settings.weight = clamp(Number(weight.value) / 100, 0, 1);
      paint();
      applySoon();
    });
    weight.addEventListener("change", save);

    $("avs-enabled").addEventListener("change", (e) => {
      settings.enabled = e.target.checked;
      save();
      apply();
    });
    $("avs-sponsored").addEventListener("change", (e) => {
      settings.hideSponsored = e.target.checked;
      save();
      apply();
    });
    $("avs-minrev").addEventListener("change", (e) => {
      settings.minReviews = clamp(parseInt(e.target.value, 10) || 0, 0, 1e6);
      e.target.value = String(settings.minReviews);
      save();
      apply();
    });
    $("avs-strength").addEventListener("change", (e) => {
      settings.priorStrength = clamp(parseInt(e.target.value, 10) || 30, 1, 500);
      e.target.value = String(settings.priorStrength);
      save();
      apply();
    });

    $("avs-collapse").addEventListener("click", () => {
      settings.collapsed = true;
      save();
      paint();
    });
    const open = () => {
      settings.collapsed = false;
      save();
      paint();
    };
    tab.addEventListener("click", open);
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    sync();
  }

  /* ----------------------------------------------------------------- boot */

  function watch() {
    const container = resultContainer();
    if (!container) return;
    const obs = new MutationObserver(() => {
      if (reordering) return;
      anchors = null;
      originalOrder = null;
      applySoon();
    });
    obs.observe(container, { childList: true });
  }

  function start() {
    if (!resultContainer()) return;
    currency = "";
    buildPanel();
    apply();
    watch();
  }

  try {
    // Basis memory loads with the settings, so it is in place before the
    // first apply(): detectBasis is synchronous.
    chrome.storage.local.get(["avs", MEMORY_KEY], (res) => {
      if (res && res.avs) settings = { ...DEFAULTS, ...res.avs };
      if (res && res[MEMORY_KEY]) basisMemory = res[MEMORY_KEY];
      start();
    });
  } catch (e) {
    start();
  }

  // Exposed for the test harness; harmless in the browser.
  window.__avsInternals = {
    collect,
    detectBasis,
    effectivePrice,
    score,
    setSettings: (s) => Object.assign(settings, s),
    memory: { searchKey, rememberBasis, entries: () => basisMemory },
  };

  // Amazon navigates without full reloads on some flows.
  let lastHref = location.href;
  window.__avsPoll = setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    anchors = null;
    originalOrder = null;
    setTimeout(start, 400);
  }, 700);
})();
