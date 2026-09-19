// config.js — the only file you edit by hand.
//
// Both values come from your Supabase dashboard:
//   Project Settings -> API -> Project URL, and the "anon / publishable" key.
//
// They are meant to be public; they sit in browser code on purpose. What
// actually stops strangers writing to your collection is Row Level Security
// (db/schema.sql) plus having sign-ups turned off, not hiding these strings.
window.IH_CONFIG = {
  SUPABASE_URL: "PASTE_YOUR_PROJECT_URL_HERE",
  SUPABASE_KEY: "PASTE_YOUR_PUBLISHABLE_KEY_HERE",
};
