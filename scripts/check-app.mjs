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

// Read from index.html rather than listed here: the check covers exactly what
// the page compiles, so a new screen cannot be added to the app and quietly
// left out of the check. The old hand-kept list had to be remembered.
const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const babelTags = [...html.matchAll(/<script type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/g)];
const FILES = babelTags.map((m) => m[1].match(/src="([^"]+)"/)?.[1]).filter(Boolean).map((f) => `app/${f}`);

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

// index.html carries its own JSX inline. Only the blocks WITHOUT a src have a
// body -- the others were being "checked" as empty strings, which always pass.
let i = 0;
for (const m of babelTags) if (!/src="/.test(m[1])) check(m[2], `app/index.html inline block ${++i}`);

console.log(bad ? `\n${bad} file(s) will not run in a browser` : "\nall JSX compiles");
process.exit(bad ? 1 : 0);
