// check-db.mjs — confirm the schema files in db/ have actually been applied.
//
//   node scripts/check-db.mjs
//
// Reads only, apart from one probe row it writes and removes again to prove
// the review_flags policies let the owner write as well as read. Useful after
// pasting a file into the Supabase SQL editor, where a failed statement is
// easy to miss.
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

requireEnv();
const token = await signIn();
const api = rest(token);
const { SUPABASE_URL, SUPABASE_KEY } = process.env;

let bad = 0;
const say = (name, ok, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(22)} ${detail}`);
};

// db/migrations/2026-09-20-review-flags.sql
try {
  const rows = await api.select("review_flags?select=kind,subject,state&limit=5");
  say("review_flags", true, `readable, ${rows.length} row(s)`);
} catch (e) {
  say("review_flags", false, String(e.message).slice(0, 80));
}

// db/migrations/2026-09-20-drop-pool.sql — the column should be GONE, so a select on it must fail
try {
  await api.select("albums?select=in_pool&limit=1");
  say("albums.in_pool", false, "still present — db/migrations/2026-09-20-drop-pool.sql has not run");
} catch {
  say("albums.in_pool", true, "dropped");
}

// the write path the maintenance screen depends on
try {
  await api.insert("review_flags", [{ kind: "__selftest", subject: "probe", state: "dismissed" }]);
  const back = await api.select("review_flags?select=kind&kind=eq.__selftest");
  await fetch(`${SUPABASE_URL}/rest/v1/review_flags?kind=eq.__selftest`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  const after = await api.select("review_flags?select=kind&kind=eq.__selftest");
  say("verdicts write", back.length === 1 && after.length === 0,
      back.length === 1 && after.length === 0 ? "insert and delete both allowed"
        : `wrote ${back.length}, ${after.length} left behind`);
} catch (e) {
  say("verdicts write", false, String(e.message).slice(0, 80));
}

console.log(bad ? `\n${bad} check(s) failed.` : "\nSchema is up to date.");
process.exit(bad ? 1 : 0);
