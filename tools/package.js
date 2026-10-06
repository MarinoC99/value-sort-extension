/*
 * Builds the Chrome Web Store upload: dist/value-sort-extension-<version>.zip.
 *
 * The file list comes from manifest.json itself, so the zip holds exactly what
 * the manifest loads and nothing else (no tests, fixtures or node_modules).
 * Fails if the manifest points at a file that does not exist.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const files = new Set(["manifest.json"]);
for (const cs of manifest.content_scripts || []) {
  for (const f of [...(cs.js || []), ...(cs.css || [])]) files.add(f);
}
for (const f of Object.values(manifest.icons || {})) files.add(f);

const missing = [...files].filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error(`manifest.json references missing files: ${missing.join(", ")}`);
  process.exit(1);
}

const out = path.join("dist", `value-sort-extension-${manifest.version}.zip`);
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.rmSync(path.join(ROOT, out), { force: true });
execFileSync("zip", ["-X", "-q", out, ...[...files].sort()], { cwd: ROOT, stdio: "inherit" });

console.log(`${out}`);
for (const f of [...files].sort()) console.log(`  ${f}`);
