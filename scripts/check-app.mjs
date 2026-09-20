// check-app.mjs — compile every .jsx the way the browser will.
//
//   node scripts/check-app.mjs
//
// The app has no build step, so nothing catches a syntax error until a browser
// tries to run it -- and the failure is a blank page with the reason buried in
// the console. This runs the same Babel the page loads, against the same files,
// and exits non-zero if any of them will not compile.
//
// `node --check` is not enough: it does not understand JSX, and the inline
// scripts in index.html are not files it can be pointed at.

import { readFileSync } from "node:fs";

const BABEL = "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js";
const FILES = ["app/admin.jsx", "app/home.jsx", "app/roll.jsx", "app/browse.jsx", "app/cover-art.jsx"];

let Babel;
try {
  const src = await (await fetch(BABEL)).text();
  const mod = { exports: {} };
  new Function("module", "exports", "window", "self", src)(mod, mod.exports, {}, {});
  Babel = mod.exports.transform ? mod.exports : globalThis.Babel;
} catch (e) {
  console.error(`Could not load Babel (${e.message}). Offline?`);
  process.exit(2);
}

let bad = 0;
const check = (code, name) => {
  try {
    Babel.transform(code, { presets: ["react"], filename: name });
    console.log(`  ok      ${name}`);
  } catch (e) {
    bad++;
    console.log(`  BROKEN  ${name}`);
    console.log(`          ${e.message.split("\n")[0]}`);
  }
};

for (const f of FILES) check(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), f);

// index.html carries its own JSX in <script type="text/babel"> blocks.
const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
let i = 0;
for (const m of html.matchAll(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g)) {
  check(m[1], `app/index.html block ${++i}`);
}

console.log(bad ? `\n${bad} file(s) will not run in a browser` : "\nall JSX compiles");
process.exit(bad ? 1 : 0);
