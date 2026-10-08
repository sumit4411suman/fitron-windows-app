// ============================================================
// Fitron backend switch (Phase 1).
//
// To turn the real backend ON:
//   1. Create a free project at https://supabase.com  (region: Mumbai if offered)
//   2. Run supabase-schema.sql once (dashboard → SQL Editor → paste → Run)
//   3. Dashboard → Settings → API → copy the Project URL and the anon public key
//   4. Paste them below (or set SUPABASE_URL + SUPABASE_ANON_KEY when deploying)
//
// Leave the url empty ('') to keep the app in demo mode — everything works,
// nothing is stored, and no backend call is ever made.
// ============================================================
window.__FITRON_BACKEND__ = {
  url: '',
  anonKey: '',
};