// ============================================================================
// LAYOUT — renders the shared sidebar + topbar shell on every protected page
// ============================================================================

const NAV_ITEMS = [
  { href: "dashboard.html", key: "dashboard", icon: "layout-icon", label: "Dashboard" },
  { href: "classes.html", key: "classes", icon: "class-icon", label: "Classes" },
  { href: "students.html", key: "students", icon: "student-icon", label: "Students" },
  { href: "fees.html", key: "fees", icon: "fee-icon", label: "Fee Records" },
  { href: "reports.html", key: "reports", icon: "report-icon", label: "Reports" },
];

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then(() => console.log("Service Worker registered"))
      .catch(err => console.error("Service Worker registration failed:", err));
  });
}

function renderLayout(activeKey, pageTitle) {
  const root = document.getElementById("app-shell");
  if (!root) return;

  const navHtml = NAV_ITEMS.map(
    (item) => `
      <a href="${item.href}" class="nav-link ${item.key === activeKey ? "nav-link--active" : ""}">
        <span class="nav-link__dot"></span>${item.label}
      </a>`
  ).join("");

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar__brand">
          <span class="sidebar__mark">FM</span>
          <span class="sidebar__name">Ledger<em>School</em></span>
        </div>
        <nav class="sidebar__nav">${navHtml}</nav>
        <button class="sidebar__logout" data-logout>
          <span>Log out</span>
        </button>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="topbar__menu" id="menuToggle" aria-label="Toggle menu">☰</button>
          <h1 class="topbar__title">${escapeHtml(pageTitle)}</h1>
          <div class="topbar__spacer"></div>
          <div class="topbar__year-badge" id="academicYearBadge">${CURRENT_ACADEMIC_YEAR}</div>
        </header>
        <main class="content" id="pageContent"></main>
      </div>
    </div>
    <div class="sidebar-scrim" id="sidebarScrim"></div>
  `;

  wireLogoutButton();

  const menuToggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("sidebarScrim");
  const openSidebar = () => { sidebar.classList.add("sidebar--open"); scrim.classList.add("sidebar-scrim--show"); };
  const closeSidebar = () => { sidebar.classList.remove("sidebar--open"); scrim.classList.remove("sidebar-scrim--show"); };
  menuToggle?.addEventListener("click", openSidebar);
  scrim?.addEventListener("click", closeSidebar);

  return document.getElementById("pageContent");
}
