// ============================================================================
// SHARED UTILITIES — toasts, formatting, export, pagination, dialogs
// ============================================================================

/* ---------------------------- Toast notifications ------------------------- */
function ensureToastHost() {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  return host;
}

function toast(message, type = "success", duration = 3800) {
  const host = ensureToastHost();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  const icon = { success: "✓", error: "✕", info: "ℹ", warning: "!" }[type] || "✓";
  el.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg"></span>`;
  el.querySelector(".toast__msg").textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--show"));
  setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ------------------------------ Formatting -------------------------------- */
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return currencyFormatter.format(n);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusBadge(status) {
  const cls = { "Paid": "badge--paid", "Partially Paid": "badge--partial", "Pending": "badge--pending" }[status] || "badge--pending";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

/* -------------------------------- Debounce -------------------------------- */
function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------ Confirm dialog ----------------------------- */
function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = true } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal--sm" role="dialog" aria-modal="true">
        <h3 class="modal__title">${escapeHtml(title)}</h3>
        <p class="modal__message">${escapeHtml(message)}</p>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-action="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("modal-overlay--show"));

    function close(result) {
      overlay.classList.remove("modal-overlay--show");
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="ok"]').addEventListener("click", () => close(true));
  });
}

/* -------------------------------- Loading ---------------------------------- */
function setLoading(el, isLoading, colSpan = 6) {
  if (!el) return;
  if (isLoading) {
    el.innerHTML = `<tr class="row-loading"><td colspan="${colSpan}"><div class="spinner"></div><span>Loading…</span></td></tr>`;
  }
}

function emptyState(el, message = "No records found.", colSpan = 6) {
  if (!el) return;
  el.innerHTML = `<tr class="row-empty"><td colspan="${colSpan}"><div class="empty-state"><div class="empty-state__icon">🗂</div><p>${escapeHtml(message)}</p></div></td></tr>`;
}

/* -------------------------------- Pagination -------------------------------- */
class Paginator {
  constructor({ pageSize = 10, onChange } = {}) {
    this.pageSize = pageSize;
    this.page = 1;
    this.total = 0;
    this.onChange = onChange;
  }
  setTotal(total) {
    this.total = total;
    const maxPage = Math.max(1, Math.ceil(total / this.pageSize));
    if (this.page > maxPage) this.page = maxPage;
  }
  get from() { return (this.page - 1) * this.pageSize; }
  get to() { return this.from + this.pageSize - 1; }
  get totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  goto(p) {
    this.page = Math.min(Math.max(1, p), this.totalPages);
    this.onChange?.();
  }
  render(container) {
    if (!container) return;
    const p = this.page, tp = this.totalPages;
    container.innerHTML = `
      <button class="pg-btn" data-pg="prev" ${p <= 1 ? "disabled" : ""}>‹ Prev</button>
      <span class="pg-info">Page ${p} of ${tp} <span class="pg-total">(${this.total} total)</span></span>
      <button class="pg-btn" data-pg="next" ${p >= tp ? "disabled" : ""}>Next ›</button>
    `;
    container.querySelector('[data-pg="prev"]')?.addEventListener("click", () => this.goto(p - 1));
    container.querySelector('[data-pg="next"]')?.addEventListener("click", () => this.goto(p + 1));
  }
}

/* -------------------------------- CSV Export -------------------------------- */
function toCsvValue(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function exportToCsv(filename, columns, rows) {
  const header = columns.map((c) => toCsvValue(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => toCsvValue(typeof c.value === "function" ? c.value(row) : row[c.value])).join(","));
  const csv = [header, ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

// "Excel" export = an HTML table wrapped with an .xls MIME type, which Excel
// opens natively with formatting — no external library required.
function exportToExcel(filename, columns, rows, title = "Report") {
  const th = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const trs = rows
    .map((row) => {
      const tds = columns
        .map((c) => `<td>${escapeHtml(typeof c.value === "function" ? c.value(row) : row[c.value])}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  const html = `
    <html xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"><style>
      table { border-collapse: collapse; font-family: Calibri, sans-serif; }
      th { background:#2F6F5E; color:#fff; padding:6px 10px; text-align:left; }
      td { padding:6px 10px; border:1px solid #ddd; }
    </style></head>
    <body><h3>${escapeHtml(title)}</h3><table>
      <thead><tr>${th}</tr></thead><tbody>${trs}</tbody>
    </table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  downloadBlob(blob, filename.endsWith(".xls") ? filename : `${filename}.xls`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------- Modal (form) -------------------------------- */
function openModal(innerHtml, { size = "" } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("modal-overlay--show"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
  const closeBtns = overlay.querySelectorAll("[data-close-modal]");
  closeBtns.forEach((b) => b.addEventListener("click", () => closeModal(overlay)));
  return overlay;
}

function closeModal(overlay) {
  overlay.classList.remove("modal-overlay--show");
  setTimeout(() => overlay.remove(), 200);
}

function getFriendlyError(err) {
  if (!err) return "Something went wrong. Please try again.";
  if (err.message?.includes("duplicate key")) return "A record with these details already exists.";
  if (err.message?.includes("Invalid login")) return "Incorrect email or password.";
  return err.message || "Something went wrong. Please try again.";
}
