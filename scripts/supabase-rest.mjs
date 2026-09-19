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
