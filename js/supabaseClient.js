// ============================================================================
// SUPABASE CLIENT — single shared instance used by every page
// ============================================================================
// Requires the Supabase UMD bundle to be loaded first (see <script> tags in
// each HTML page) and config.js to have set SUPABASE_URL / SUPABASE_ANON_KEY.

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
  },
});
