// fill-sql.mjs — write the policy files out with your user id filled in,
// into a directory git ignores.
//
//   set -a && source .env && set +a && node scripts/fill-sql.mjs
//
// The files in db/ keep their PASTE_YOUR_UID_HERE placeholder and stay
// committable. The filled copies land in db/local/, which is gitignored, so
// the id cannot reach the public repo by accident.
//
// Your id is not a secret -- RLS compares it against a signed token, so knowing
// it grants nobody anything -- but there is no reason to publish it either, and
// copying a UUID by hand four times per file is how a policy silently ends up
// applying to nobody.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_KEY, IMC_EMAIL, IMC_PASSWORD } = process.env;
const missing = ["SUPABASE_URL", "SUPABASE_KEY", "IMC_EMAIL", "IMC_PASSWORD"]
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}.`);
  console.error("Try:  set -a && source .env && set +a && node scripts/fill-sql.mjs");
  process.exit(1);
}

// The id is in the token itself, so there is no dashboard lookup to get wrong.
const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: IMC_EMAIL, password: IMC_PASSWORD }),
});
const json = await res.json();
if (!res.ok) {
  console.error(`Sign-in failed: ${json.error_description || json.msg || res.status}`);
  process.exit(1);
}
const uid = JSON.parse(
  Buffer.from(json.access_token.split(".")[1], "base64").toString()
).sub;
if (!/^[0-9a-f-]{36}$/.test(uid)) {
  console.error(`That token carries no usable user id (${uid}).`);
  process.exit(1);
}

const db = new URL("../db/", import.meta.url);
mkdirSync(new URL("local/", db), { recursive: true });

for (const name of ["storage.sql", "public_hardening.sql"]) {
  const src = readFileSync(new URL(name, db), "utf8");
  const count = (src.match(/PASTE_YOUR_UID_HERE/g) || []).length;
  if (!count) { console.log(`  ${name}: no placeholder, skipped`); continue; }
  writeFileSync(new URL(`local/${name}`, db),
    src.replaceAll("PASTE_YOUR_UID_HERE", uid));
  console.log(`  db/local/${name}  — ${count} placeholder${count > 1 ? "s" : ""} filled`);
}

console.log(`\nSigned in as ${IMC_EMAIL}`);
console.log(`Open the files in db/local/, paste each into the Supabase SQL editor, run.`);
console.log(`They are gitignored, so nothing you paste can reach the public repo.`);
