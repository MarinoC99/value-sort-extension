const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// Synthetic tiles, no fixtures: each case is the smallest markup that shows
// one extraction behaviour.
function extract(tileHtml) {
  const dom = new JSDOM(
    `<div class="s-main-slot"><div data-component-type="s-search-result">${tileHtml}</div></div>`,
    { url: "https://www.amazon.com/s?k=test", runScripts: "outside-only" }
  );
  const w = dom.window;
  w.chrome = { storage: { local: { get() {}, set() {} } } };
  for (const f of ["units.js", "content.js"]) {
    w.eval(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
  }
  try {
    return w.__avsInternals.collect(() => true)[0];
  } finally {
    w.clearInterval(w.__avsPoll);
    w.close();
  }
}

test("a title containing 'rating' is not read as a review count", () => {
  const p = extract('<h2 aria-label="Hydrating Shampoo 1.7 Oz"><span>Hydrating Shampoo 1.7 Oz</span></h2>');
  assert.equal(p.reviews, null);
});

test("a price link is not read as a review count", () => {
  const p = extract(
    "<h2><span>Shampoo</span></h2>" +
      '<a class="s-underline-text" href="/dp/X"><span class="a-price"><span class="a-offscreen">$7.60</span></span></a>'
  );
  assert.equal(p.reviews, null);
});

test("an abbreviated count is not read with its separator stripped", () => {
  // Inside the ratings link, so the K suffix is the only reason to reject it.
  const p = extract(
    "<h2><span>Coffee Pods</span></h2>" +
      '<a href="/dp/X#customerReviews"><span class="s-underline-text">(77.6K)</span></a>'
  );
  assert.notEqual(p.reviews, 776);
  assert.equal(p.reviews, null);
});

test("a count-only aria-label is still read as the review count", () => {
  const p = extract(
    '<h2 aria-label="Hydrating Shampoo 1.7 Oz"><span>Hydrating Shampoo 1.7 Oz</span></h2>' +
      '<a aria-label="53 ratings" href="#customerReviews"><span aria-hidden="true">(53)</span></a>'
  );
  assert.equal(p.reviews, 53);
});
