// covers.mjs — fill in missing album art ahead of time.
//
//   node scripts/covers.mjs [limit]
//
// The app looks covers up as you browse, but that is one album at a time. This
// walks the whole collection instead. iTunes throttles bursts, so it deliberately
// runs about three albums a second -- roughly 25 minutes for 4,500 albums. Leave
// it running; it is safe to stop and restart, since it only ever picks up albums
// whose cover_url is still empty.
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

requireEnv();

const LIMIT = Number(process.argv[2] || 5000);
const GAP_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(artist, title) {
  const term = encodeURIComponent(`${artist} ${title}`.slice(0, 180));
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`);
  if (res.status === 403 || res.status === 429) return "throttled";
  if (!res.ok) return null;
  const hit = (await res.json()).results?.[0];
  return hit?.artworkUrl100?.replace("100x100bb", "600x600bb") || null;
}

const token = await signIn();
const api = rest(token);

const todo = await api.select(
  `albums?select=id,artist,title&cover_url=is.null&order=id&limit=${LIMIT}`
);
console.log(`${todo.length} albums without artwork\n`);

let found = 0, missed = 0;
for (const [i, album] of todo.entries()) {
  let url = await lookup(album.artist, album.title);

  // Back off and retry once if iTunes starts pushing back.
  if (url === "throttled") {
    console.log("  (throttled — pausing 30s)");
    await sleep(30_000);
    url = await lookup(album.artist, album.title);
    if (url === "throttled") url = null;
  }

  if (url) {
    await api.update("albums", `id=eq.${album.id}`, { cover_url: url });
    found++;
  } else {
    missed++;
  }

  if ((i + 1) % 25 === 0 || i === todo.length - 1) {
    console.log(`${i + 1}/${todo.length} — ${found} found, ${missed} not on iTunes`);
  }
  await sleep(GAP_MS);
}
console.log(`\ndone: ${found} covers added, ${missed} had no match`);
