// cover-art.jsx — album art, fetched from the iTunes Search API the first time
// an album is shown and then remembered in Supabase so it is only ever looked
// up once. Albums that have no match (bootlegs, obscure pressings, non-Latin
// titles) fall back to generated art derived from the artist and album name.

const COVER_CACHE = new Map();   // "artist::title" -> url | null
const QUEUE = [];
let draining = false;

// iTunes throttles bursts, and a grid can mount 60 tiles at once, so requests
// go out one at a time with a gap instead of all at once.
const GAP_MS = 350;

async function drain() {
  if (draining) return;
  draining = true;
  while (QUEUE.length) {
    const job = QUEUE.shift();
    try {
      job.resolve(await lookup(job.artist, job.title, job.mbid));
    } catch {
      job.resolve(null);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  draining = false;
}

const normName = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
function sameArtist(mine, theirs) {
  const a = normName(mine), b = normName(theirs);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

// Mirrors scripts/enrich.mjs. An album that has been through enrichment has an
// mbid, and artwork is then fetched BY that id -- no searching, so it cannot
// land on the wrong record. Only an album added since the last nightly run
// falls through to a text search, and that result is checked against the
// artist name before it is used. Taking result #1 unchecked is what used to
// put other bands' covers on obscure albums.
async function lookup(artist, title, mbid) {
  if (mbid) {
    const url = `https://coverartarchive.org/release-group/${mbid}/front-500`;
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) return url;
    } catch { /* fall through to the search */ }
  }

  const term = encodeURIComponent(`${artist} ${title}`.slice(0, 180));
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=1`);
  if (!res.ok) return null;
  const hit = (await res.json()).results?.[0];
  if (!hit?.artworkUrl100) return null;
  if (!sameArtist(artist, hit.artistName)) return null;
  // The API hands back a 100px thumbnail; the URL resizes by substitution.
  return hit.artworkUrl100.replace("100x100bb", "600x600bb");
}

function requestCover(artist, title, mbid) {
  const key = `${artist}::${title}`;
  if (COVER_CACHE.has(key)) return Promise.resolve(COVER_CACHE.get(key));
  return new Promise((resolve) => {
    QUEUE.push({
      artist, title, mbid,
      resolve: (url) => { COVER_CACHE.set(key, url); resolve(url); },
    });
    drain();
  });
}

// ── generated fallback ──────────────────────────────────────────────────────
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function GeneratedArt({ artist, album, size }) {
  const h = hashOf(artist + album);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 80)) % 360;
  const initials = (artist.match(/\p{L}/gu) || ["?"])[0].toUpperCase() +
                   (album.match(/\p{L}/gu) || [""])[0].toUpperCase();
  return (
    <div
      className="art art--gen"
      style={{
        background: `linear-gradient(135deg,
          hsl(${hue} 55% 32%), hsl(${hue2} 45% 16%))`,
        fontSize: Math.max(11, size * 0.26),
      }}
    >
      <span>{initials}</span>
    </div>
  );
}

function CoverArt({ album, size = 150, canPersist, onResolved }) {
  const [url, setUrl] = React.useState(album.cover_url || null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setUrl(album.cover_url || null);
    setFailed(false);
  }, [album.id, album.cover_url]);

  React.useEffect(() => {
    if (url || failed) return;
    let alive = true;
    requestCover(album.artist, album.title, album.mbid).then((found) => {
      if (!alive) return;
      if (!found) return setFailed(true);
      setUrl(found);
      // Persist so the next visitor -- and the next device -- skips the lookup.
      if (canPersist) onResolved?.(album.id, found);
    });
    return () => { alive = false; };
  }, [album.id, url, failed, canPersist]);

  if (!url) return <GeneratedArt artist={album.artist} album={album.title} size={size} />;
  return (
    <img
      className="art"
      src={url}
      alt=""
      loading="lazy"
      onError={() => { setUrl(null); setFailed(true); }}
    />
  );
}

window.CoverArt = CoverArt;
