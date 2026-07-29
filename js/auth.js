// ============================================================================
// AUTH — session guard, login, logout
// ============================================================================

// Call at the top of every protected page. Redirects to index.html (login)
// if there is no active session. Resolves with the session on success.
async function requireAuth() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data?.session) {
    window.location.href = "index.html";
    return null;
  }
  // Keep session fresh in the background & bounce to login if it ever drops.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      window.location.href = "index.html";
    }
  });
  return data.session;
}

// If already logged in and viewing the login page, skip straight to the dashboard.
async function redirectIfAuthenticated() {
  const { data } = await sb.auth.getSession();
  if (data?.session) {
    window.location.href = "dashboard.html";
  }
}

async function loginAdmin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function logoutAdmin() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

function wireLogoutButton() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Log out?",
        message: "You'll need to sign in again to access the dashboard.",
        confirmLabel: "Log out",
        danger: false,
      });
      if (ok) await logoutAdmin();
    });
  });
}
