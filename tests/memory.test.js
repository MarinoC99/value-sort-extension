const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// content.js on a blank page (so start() finds no results and does nothing),
// with an in-memory chrome.storage that records writes.
function load(url, stored = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", { url, runScripts: "outside-only" });
  const w = dom.window;
  const store = { ...stored };
  const writes = [];
  const pick = (keys) =>
    Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  w.chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(pick(keys)),
        set: (obj) => {
          writes.push(obj);
          Object.assign(store, structuredClone(obj));
        },
      },
    },
  };
  let clock = 1000;
  w.Date.now = () => clock++;
  for (const f of ["units.js", "content.js"]) {
    w.eval(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
  }
  const close = () => {
    w.clearInterval(w.__avsPoll);
    w.close();
  };
  return { m: w.__avsInternals.memory, store, writes, close };
}

test("the key is the hostname plus the search term, lowercased and collapsed", () => {
  const { m, close } = load("https://www.amazon.co.uk/s?k=Hand++SOAP%20%20Refill&ref=nb");
  assert.equal(m.searchKey(), "www.amazon.co.uk|hand soap refill");
  close();
  const off = load("https://www.amazon.com/dp/B000");
  assert.equal(off.m.searchKey(), null);
  off.close();
});

test("memory saved by an earlier page is loaded before the first apply", () => {
  const { m, close } = load("https://www.amazon.com/s?k=soap", {
    avsBasis: { "www.amazon.com|soap": { basis: "volume", used: 1 } },
  });
  assert.equal(m.entries()["www.amazon.com|soap"].basis, "volume");
  close();
});

test("re-renders refresh last-used once and do not write again", () => {
  const { m, writes, close } = load("https://www.amazon.com/s?k=soap");
  m.rememberBasis("k", "volume");
  m.rememberBasis("k", "volume");
  m.rememberBasis("k", "volume");
  assert.equal(writes.length, 1);
  assert.equal(Object.keys(m.entries()).length, 1);
  m.rememberBasis("k", "count"); // a changed basis is written
  assert.equal(writes.length, 2);
  assert.equal(m.entries().k.basis, "count");
  close();
});

test("landing on list price forgets the search", () => {
  const { m, store, close } = load("https://www.amazon.com/s?k=soap");
  m.rememberBasis("k", "volume");
  m.rememberBasis("k", null);
  assert.equal(m.entries().k, undefined);
  assert.equal(store.avsBasis.k, undefined);
  close();
});

test("memory is capped at 200 searches, least recently used out", () => {
  const { m, store, close } = load("https://www.amazon.com/s?k=soap");
  for (let i = 0; i < 201; i++) m.rememberBasis(`k${i}`, "mass");
  const keys = Object.keys(store.avsBasis);
  assert.equal(keys.length, 200);
  assert.ok(!keys.includes("k0"), "oldest should be evicted");
  assert.ok(keys.includes("k200"));
  close();
});

test("a write keeps entries another tab stored in the meantime", () => {
  const { m, store, close } = load("https://www.amazon.com/s?k=soap");
  store.avsBasis = { other: { basis: "count", used: 5 } }; // written by another tab
  m.rememberBasis("k", "volume");
  assert.deepEqual(Object.keys(store.avsBasis).sort(), ["k", "other"]);
  close();
});
