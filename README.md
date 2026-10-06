# Value Sort for Amazon

Re-orders the search results already on the page by a score you control: a
weighted blend of review quality and price. Nothing is fetched or sent
anywhere — it reads only what the page has already rendered.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this folder
4. Run any Amazon search — the panel appears on the right

Works in Chrome, Edge, Brave, Arc, and any other Chromium browser. The `−`
button collapses it to a tab on the screen edge.

## The score

Each result gets a 0–100 value score:

```
score = w · quality + (1 − w) · cheapness
```

where `w` is the slider — `100 / 0` is quality only, `0 / 100` is price only.

### Quality

Not the raw star average. A 4.9 from six reviews is mostly noise, so the
average is shrunk toward a baseline:

```
adjusted = (reviews · stars + strength · baseline) / (reviews + strength)
```

The baseline is 4.3, roughly the Amazon-wide average — star ratings there are
badly left-skewed, so 4.3 is unremarkable rather than good. `strength` is fixed
at 30: the review count at which a product's own average and the baseline carry
equal weight. A 4.9 from 6 reviews adjusts to 4.40, exactly level with a 4.4
from 8,200. It used to be a panel setting ("Trust after"), but it overlapped
with *Min. review count* in a way that was hard to explain, so it was removed.

### Price

The denominator is chosen per search, automatically. There is no control for
it — the panel reports which basis it picked so you can see the guess.

1. Every result's unit price is read from the tile (`($0.52/Count)`,
   `(£1.20/100 g)`) and converted to a canonical dimension — mass to grams,
   volume to millilitres, count to items, plus length and area.
2. If one dimension covers at least **55%** of priced results, ranking uses
   price per unit in that dimension. Otherwise it uses list price. Once a
   search has used a unit basis, that is remembered (see *Basis memory*).
3. Within a unit-price search, results Amazon didn't publish a figure for get
   one derived from the title — but only accepting units in the detected
   dimension. That guard is what stops a "32 inch monitor" being read as a
   size on a volume search. Derived figures are marked `est` on the badge.

A search mixing litres and counts has no shared axis, so it stays on list
price rather than ranking across dimensions.

Title parsing handles the multiplier case: "2 Pack of 32 fl oz" is 64 fl oz,
not 32 and not 1,024. "Pack of 12 Rolls" is 12, not 144.

**Bare ounces.** Amazon writes "/Ounce" for both liquids and solids. Ounces
are held aside while the page is tallied, then go to volume only if
unambiguous volume (fl oz, ml, l) outnumbers unambiguous mass (g, kg, lb)
*and* amounts to at least 25% as many tiles as the ounce pile. Otherwise they
stay mass. The 25% floor is there so that a small unambiguous minority can't
reclassify a much larger ambiguous pile. On a saved coffee search, one canned
drink in fl oz would otherwise have turned 46 bags of ground coffee into
volume. In titles, a bare "oz" follows the dimension being searched: "Travel
Size 2 oz" is fluid ounces on a volume search.

The more accurate approach is to classify each ounce tile from its own title
("fl oz" versus "oz"). That makes the price basis a per-tile decision rather
than a per-search one, and would need its own pass and its own tests.

**Soft units.** Laundry detergent is priced per load ("$0.18/medium load"),
so a detergent search ranks by count. That is arguably the right unit, but a
load is defined by the seller, not by physics: a medium load and a large load
are different amounts, and nothing on the tile says by how much. Load-like
units rank as plain counts, so comparisons across them are approximate.

**Basis memory.** A search sitting near 55% could flip basis from one load to
the next, so the last unit basis is remembered per search term and site:

- Remembered: kept until its coverage drops below **45%**.
- Switching to another dimension needs **55%** and a **15-point** lead over the
  remembered one.
- Below 30% or above 70% coverage the page decides on its own and memory is
  ignored, so one odd early reading can't stick to a search. With the numbers
  above this never changes the outcome; it holds if those numbers are changed.
- A search that lands on list price is forgotten rather than stored, which has
  the same effect, since leaving list price takes 55% either way.

The memory lives in the browser's extension storage (`chrome.storage.local`),
holds the last 200 searches, and never leaves the machine.

Either way the price term uses a log scale, so the gap from $10 to $20 counts
the same as $200 to $400. On a linear scale one expensive outlier flattens
every cheap option into near-identical scores.

Both terms are normalized across the results currently on screen, so scores are
relative to what you're looking at — the same product scores differently under
a different search.

## Settings

| Control | What it does |
| --- | --- |
| Quality / price | The weighting. This is the whole point. |
| Re-sort results | Off restores Amazon's original order. |
| Min. review count | Dims and pushes down results with fewer reviews than this. 0 turns it off. Blunter than the shrinkage and useful alongside it. |
| Hide sponsored | Dims ads. On by default. |

Hidden results are dimmed and pushed down rather than removed, so you can still
see what was set aside.

## Known limits

- **It only sees the current page.** Amazon paginates at ~60 results; this
  ranks what's loaded, not the whole result set.
- **Unit detection is a guess with no override.** When a search sits near the
  55% threshold it can pick a basis you wouldn't have, and basis memory then
  keeps that choice for the search. The status line always says which one it
  chose and how many figures were estimated.
- **Title-derived unit prices are the weakest link.** Titles are written by
  sellers, not validated. The dimension guard removes most garbage but not all;
  anything marked `est` is worth a glance before trusting. It is also the
  least-proven code here: none of the live-checked searches (coffee, hand soap,
  monitors) showed an `est` badge. Checked against Amazon's own unit price on
  the saved pages, the title estimate agrees on 77% of tiles where it finds a
  quantity (135 of 175) and finds none on another 35. Most misses
  under-count multi-packs ("22.6 Oz. Canister (Pack of 6)" read as one
  canister, "3 Oz Ea" sets, "6x12oz"), which makes the product look up to 12×
  dearer and pushes it down. On count searches, "50 Fl Oz (Pack of 2)" reads
  as 2 loads, so the estimate is 30–100× off.
- **The result count is a snapshot.** "39 of 60 results" counts the tiles
  rendered at the last pass. Amazon lazy-loads, so a page can briefly show
  "39 of 48" and then settle at "39 of 60" once the rest render, which may need
  a scroll. The ranking re-runs as tiles arrive.
- **Selectors drift.** Amazon changes its markup regularly. If the panel says
  it can't read prices, the selectors in `content.js` need updating.
- **Prices are the tile price** — not inclusive of coupons shown only at
  checkout, and subscribe-and-save figures may differ.
- Star ratings can be manipulated. Shrinking toward a baseline helps against
  thin counts, not against thousands of bought reviews.

## Tests

```
npm test               # unit, scoring and extraction tests
npm run fixtures       # per-field hit rates against saved Amazon pages
npm run fixtures -- -v # the same, tile by tile
```

`tests/units.test.js` covers unit-price parsing, title quantity extraction and
the dimension guard. `tests/scoring.test.js` covers basis detection, the title
fallback, shrinkage behaviour and the slider. `tests/extraction.test.js` runs
the extractors against small synthetic tiles in jsdom.

`tests/harness.js` loads each page saved in `fixtures/` and checks every field
two ways: what the extractor returned, against an independent read of the same
tile. A field only counts as a hit when the two agree. Counting "something was
returned" is not enough: it once scored unit prices at 100% while nearly every
value was off by a factor of 10 to 1000.

It also scores the title-estimate path. Where the extension really uses it
there is no published unit price to compare against, so the harness runs it on
tiles that do publish one and compares with Amazon's figure. That measures the
method where the answer is known. Amazon's figure is occasionally the wrong one
itself (a 4-pack priced as one bottle), so a few "wrong" results are Amazon's.

To add a fixture, open the search in an Incognito window (no extensions, not
signed in), scroll to the bottom of the page and back, and save it with
**Webpage, Complete** into `fixtures/`.

## Locales

The extension runs on amazon.com, .co.uk, .ca, .com.au, .in and .sg. Only
amazon.com is covered by fixtures. The others are included because they share
the same English labels and all write the currency before the number (`$`,
`£`, `₹`, `S$`), which is the format the parser reads. That makes them
plausible, not tested.

### Re-adding non-English locales

Non-English domains were removed because a locale where ratings silently read
as missing is worse than one that is not matched: every product falls back to
the same baseline and the quality half of the slider stops doing anything. A
saved amazon.de page read 0 of 58 ratings. Three known blockers:

1. **`readRating()` only matches English labels.** It looks for "out of 5";
   German reads "4,8 von 5 Sternen".
2. **`readReviewCount()` falls back on English labels.** The primary path keys
   on aria-labels containing "rating" or "review" ("53 ratings"); elsewhere it
   only works by reading the visible "(53)", which is luck, not design.
3. **`parseUnitPrice()` cannot read the currency after the number.** It reads
   "($0.22/Count)" but not "(0,22 €/Stück)", the normal form on every euro
   site. Local unit words such as "Stück" are also missing from the vocabulary.

Each needs a fixture from the locale being added before it can be verified.

## Files

| File | What's in it |
| --- | --- |
| `units.js` | Unit vocabulary, conversion factors, unit-price and title parsing. Pure functions, no DOM. |
| `content.js` | Extraction from the page, basis detection, scoring, re-ordering, the panel. |
| `panel.css` | Panel and badge styling. |
| `tests/` | Unit, scoring and extraction tests, plus the fixture harness. |
| `fixtures/` | Saved Amazon search pages the harness reads. Git-ignored: they are Amazon's content and stay local. |
| `icons/` | Extension icons, 16–128 px. |
| `tools/package.js` | `npm run package`: builds the store zip in `dist/` from exactly the files `manifest.json` loads. |
| `store/` | Chrome Web Store listing copy, privacy-form answers and privacy policy text. |
| `LICENSE` | MIT. |

The scoring lives in `adjustedRating()` and `score()` in `content.js`. To use a
ratio form instead of a weighted sum — `quality^α / price^β`, which penalizes
price multiplicatively rather than additively — replace the return in `score()`
with a log-space version:

```js
return { ...p, value: w * Math.log(p.adj) - (1 - w) * Math.log(p.eff) };
```

then normalize to 0–1 for display. It behaves more aggressively at the price
end. To change how readily unit mode engages, adjust `UNIT_COVERAGE`.
