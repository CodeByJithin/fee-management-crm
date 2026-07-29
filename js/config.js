// ============================================================================
// SUPABASE CONFIGURATION
// ============================================================================
// Replace the two values below with your own project's credentials.
// Find them in: Supabase Dashboard → Project Settings → API
//   - SUPABASE_URL      → "Project URL"
//   - SUPABASE_ANON_KEY → "anon public" key (NOT the service_role key)
//
// The anon key is safe to expose in client-side code as long as Row Level
// Security (see sql/schema.sql) is enabled on every table, which it is.
// ============================================================================

const SUPABASE_URL = "https://ebxopysoouqbisnidndj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVieG9weXNvb3VxYmlzbmlkbmRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTc0NzAsImV4cCI6MjEwMDg3MzQ3MH0.MY1ABQaaDI9Yx25S-EOOVTFs9K9C_XDB5g_6LFaNOKc";


// Academic year helper — used to default forms/filters to "this year".
// Adjust CURRENT_ACADEMIC_YEAR manually at the start of a new session if you
// don't want it auto-derived from today's date.
function getCurrentAcademicYear() {
  const now = new Date();
  const y = now.getFullYear();
  // Academic year assumed to run June–May (common in Indian schools).
  // e.g. Jan–May 2027 is still "2026-2027".
  return now.getMonth() >= 5 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const CURRENT_ACADEMIC_YEAR = getCurrentAcademicYear();

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getCurrentMonthName() {
  return MONTH_NAMES[new Date().getMonth()];
}
