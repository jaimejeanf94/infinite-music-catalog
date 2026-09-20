// supabase-rest.mjs — a tiny Supabase client built on plain fetch.
//
// The other scripts use this instead of the npm package so the project needs
// no `npm install` and no node_modules at all. It talks to the same REST API
// the browser client does.
//
// Credentials come from the environment, never from a file in the repo:
//   export SUPABASE_URL="https://xxxx.supabase.co"
//   export SUPABASE_KEY="sb_publishable_..."
//   export IMC_EMAIL="you@example.com"
//   export IMC_PASSWORD="..."

const { SUPABASE_URL, SUPABASE_KEY, IMC_EMAIL, IMC_PASSWORD } = process.env;

export function requireEnv() {
  const missing = ["SUPABASE_URL", "SUPABASE_KEY", "IMC_EMAIL", "IMC_PASSWORD"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(", ")}`);
    console.error("See the README section 'Running the scripts'.");
    process.exit(1);
  }
}

// Writes are blocked for anonymous callers by Row Level Security, so sign in
// first and use the returned token as a bearer.
export async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: IMC_EMAIL, password: IMC_PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed: ${json.error_description || json.msg || res.status}`);
  return json.access_token;
}

// Storage speaks a different API to the table REST endpoint, but takes the
// same bearer token. Buckets marked public are served straight from the CDN,
// so the read path needs no key at all.
export function storage(token) {
  const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  const base = `${SUPABASE_URL}/storage/v1`;

  return {
    publicUrl: (bucket, path) => `${base}/object/public/${bucket}/${path}`,

    // GET /bucket/<name> reads storage.buckets, which a normal signed-in user
    // has no rights on, so it answers "Bucket not found" for a bucket that is
    // sitting right there. Ask the public object endpoint instead: a missing
    // object inside a real bucket says NoSuchKey, a missing bucket says
    // NoSuchBucket. No auth needed either, since the bucket is public.
    async bucketExists(bucket) {
      const res = await fetch(`${base}/object/public/${bucket}/__probe_does_not_exist__`);
      if (res.ok) return true;
      const body = await res.text().catch(() => "");
      return !/nosuchbucket|bucket not found/i.test(body);
    },

    // x-upsert makes a re-run overwrite rather than fail, which is what you
    // want when a previous run was interrupted part-way through a file.
    async upload(bucket, path, bytes, contentType) {
      const res = await fetch(`${base}/object/${bucket}/${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType, "x-upsert": "true" },
        body: bytes,
      });
      if (!res.ok) throw new Error(`upload ${path} -> ${res.status} ${await res.text()}`);
      return `${base}/object/public/${bucket}/${path}`;
    },
  };
}

export function rest(token) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = `${SUPABASE_URL}/rest/v1`;

  return {
    async select(path) {
      const res = await fetch(`${base}/${path}`, { headers });
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
      return res.json();
    },
    // PostgREST caps a response at its max-rows setting -- 1,000 by default --
    // and says so only in the Content-Range header, not as an error. Asking
    // for limit=10000 quietly returns 1,000, which is how a table of 4,400
    // albums looks fully read when three quarters of it was never fetched.
    // Page until a short page comes back.
    async selectAll(path, page = 1000) {
      const out = [];
      for (let from = 0; ; from += page) {
        const sep = path.includes("?") ? "&" : "?";
        const res = await fetch(`${base}/${path}${sep}offset=${from}&limit=${page}`, { headers });
        if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
        const batch = await res.json();
        out.push(...batch);
        if (batch.length < page) return out;
      }
    },

    async insert(table, rows) {
      const res = await fetch(`${base}/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`POST ${table} -> ${res.status} ${await res.text()}`);
    },
    async update(table, filter, patch) {
      const res = await fetch(`${base}/${table}?${filter}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`PATCH ${table} -> ${res.status} ${await res.text()}`);
    },
  };
}
