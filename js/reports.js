// ============================================================================
// REPORTS
// ============================================================================

let reportStudentsCache = [];

(async function init() {
  await requireAuth();
  const content = renderLayout("reports", "Reports");
  content.innerHTML = reportsSkeleton();
  wireReportCards();
  const { data } = await sb.from("students").select("id, student_name, student_id").eq("active", true).order("student_name");
  reportStudentsCache = data || [];
  const sel = document.getElementById("reportStudentSelect");
  if (sel) sel.innerHTML = `<option value="">Select a student…</option>` + reportStudentsCache.map((s) => `<option value="${s.id}">${escapeHtml(s.student_name)} (${escapeHtml(s.student_id)})</option>`).join("");
})();

function reportsSkeleton() {
  return `
    <div class="report-grid">
      <div class="report-card">
        <h3>Student Fee History</h3>
        <p>Every fee record for a single student, across all months and years.</p>
        <select class="filter-select" id="reportStudentSelect"><option>Loading students…</option></select>
        <div class="report-card__actions">
          <button class="btn btn--ghost btn--sm" data-report="student-history" data-fmt="preview">Preview</button>
          <button class="btn btn--ghost btn--sm" data-report="student-history" data-fmt="csv">CSV</button>
          <button class="btn btn--primary btn--sm" data-report="student-history" data-fmt="excel">Excel</button>
        </div>
      </div>

      <div class="report-card">
        <h3>Class Collection Report</h3>
        <p>Expected vs. received vs. outstanding, broken down by class.</p>
        <select class="filter-select" id="reportYearSelectClass"></select>
        <div class="report-card__actions">
          <button class="btn btn--ghost btn--sm" data-report="class-collection" data-fmt="preview">Preview</button>
          <button class="btn btn--ghost btn--sm" data-report="class-collection" data-fmt="csv">CSV</button>
          <button class="btn btn--primary btn--sm" data-report="class-collection" data-fmt="excel">Excel</button>
        </div>
      </div>

      <div class="report-card">
        <h3>Monthly Collection Report</h3>
        <p>Expected, collected and due totals for each calendar month.</p>
        <select class="filter-select" id="reportYearSelectMonthly"></select>
        <div class="report-card__actions">
          <button class="btn btn--ghost btn--sm" data-report="monthly-collection" data-fmt="preview">Preview</button>
          <button class="btn btn--ghost btn--sm" data-report="monthly-collection" data-fmt="csv">CSV</button>
          <button class="btn btn--primary btn--sm" data-report="monthly-collection" data-fmt="excel">Excel</button>
        </div>
      </div>

      <div class="report-card">
        <h3>Pending Fees Report</h3>
        <p>Every record that is Pending or Partially Paid right now.</p>
        <select class="filter-select" id="reportYearSelectPending"></select>
        <div class="report-card__actions">
          <button class="btn btn--ghost btn--sm" data-report="pending-fees" data-fmt="preview">Preview</button>
          <button class="btn btn--ghost btn--sm" data-report="pending-fees" data-fmt="csv">CSV</button>
          <button class="btn btn--primary btn--sm" data-report="pending-fees" data-fmt="excel">Excel</button>
        </div>
      </div>

      <div class="report-card">
        <h3>Yearly Collection Report</h3>
        <p>Totals rolled up by academic year — good for year-on-year comparisons.</p>
        <div></div>
        <div class="report-card__actions">
          <button class="btn btn--ghost btn--sm" data-report="yearly-collection" data-fmt="preview">Preview</button>
          <button class="btn btn--ghost btn--sm" data-report="yearly-collection" data-fmt="csv">CSV</button>
          <button class="btn btn--primary btn--sm" data-report="yearly-collection" data-fmt="excel">Excel</button>
        </div>
      </div>
    </div>

    <div class="section-title"><h2>Preview</h2><span id="previewMeta"></span></div>
    <div class="table-wrap">
      <table class="data-table" id="previewTable">
        <thead><tr><th></th></tr></thead>
        <tbody><tr class="row-empty"><td><div class="empty-state"><div class="empty-state__icon">📄</div><p>Choose a report above and click Preview.</p></div></td></tr></tbody>
      </table>
    </div>
  `;
}


function wireReportCards() {
  const [startY] = CURRENT_ACADEMIC_YEAR.split("-").map(Number);
  const years = [];
  for (let i = -2; i <= 1; i++) years.push(`${startY + i}-${startY + i + 1}`);
  ["reportYearSelectClass", "reportYearSelectMonthly", "reportYearSelectPending"].forEach((id) => {
    const sel = document.getElementById(id);
    sel.innerHTML = years.map((y) => `<option value="${y}" ${y === CURRENT_ACADEMIC_YEAR ? "selected" : ""}>${y}</option>`).join("");
  });

  document.querySelectorAll("[data-report]").forEach((btn) => {
    btn.addEventListener("click", () => runReport(btn.dataset.report, btn.dataset.fmt));
  });
}

async function runReport(reportKey, fmt) {
  try {
    const report = await REPORTS[reportKey]();
    if (!report) return; // e.g. no student selected
    if (fmt === "preview") renderPreview(report);
    if (fmt === "csv") exportToCsv(report.filename, report.columns, report.rows);
    if (fmt === "excel") exportToExcel(report.filename, report.columns, report.rows, report.title);
    if (fmt !== "preview") toast(`${report.title} exported.`);
  } catch (err) {
    toast(getFriendlyError(err), "error");
  }
}

function renderPreview(report) {
  document.getElementById("previewMeta").textContent = `${report.title} · ${report.rows.length} rows`;
  const table = document.getElementById("previewTable");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  thead.innerHTML = `<tr>${report.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;

  if (report.rows.length === 0) {
    tbody.innerHTML = `<tr class="row-empty"><td colspan="${report.columns.length}"><div class="empty-state"><div class="empty-state__icon">🗂</div><p>No data for this selection.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = report.rows
    .slice(0, 200)
    .map(
      (row) =>
        `<tr>${report.columns
          .map((c) => `<td>${escapeHtml(typeof c.value === "function" ? c.value(row) : row[c.value])}</td>`)
          .join("")}</tr>`
    )
    .join("");
}

const REPORTS = {
  async "student-history"() {
    const studentId = document.getElementById("reportStudentSelect").value;
    if (!studentId) {
      toast("Select a student first.", "info");
      return null;
    }
    const { data, error } = await sb
      .from("fee_records")
      .select("*")
      .eq("student_id", studentId)
      .order("academic_year", { ascending: false })
      .order("month", { ascending: true });
    if (error) throw error;
    const student = reportStudentsCache.find((s) => s.id === studentId);
    return {
      title: `Fee History — ${student?.student_name || ""}`,
      filename: `fee-history-${student?.student_id || "student"}`,
      columns: [
        { label: "Academic Year", value: "academic_year" },
        { label: "Period", value: (r) => r.month || "Yearly" },
        { label: "Fee Type", value: "fee_type" },
        { label: "Fee Amount", value: (r) => Number(r.fee_amount).toFixed(2) },
        { label: "Discount", value: (r) => Number(r.discount_amount || 0).toFixed(2) },
        { label: "Paid", value: (r) => Number(r.amount_paid).toFixed(2) },
        { label: "Balance", value: (r) => Number(r.balance_amount).toFixed(2) },
        { label: "Status", value: "payment_status" },
        { label: "Paid Date", value: (r) => formatDate(r.paid_date) },
      ],
      rows: data || [],
    };
  },

  async "class-collection"() {
    const year = document.getElementById("reportYearSelectClass").value;
    const { data, error } = await sb
      .from("fee_records")
      .select("fee_amount, amount_paid, balance_amount, students!inner(classes(class_name))")
      .eq("academic_year", year);
    if (error) throw error;

    const byClass = {};
    (data || []).forEach((r) => {
      const name = r.students?.classes?.class_name || "Unassigned";
      if (!byClass[name]) byClass[name] = { expected: 0, received: 0, due: 0 };
      byClass[name].expected += Number(r.fee_amount);
      byClass[name].received += Number(r.amount_paid);
      byClass[name].due += Number(r.balance_amount);
    });

    const rows = Object.entries(byClass).map(([class_name, d]) => ({
      class_name,
      ...d,
      pct: d.expected > 0 ? Math.round((d.received / d.expected) * 100) : 0,
    }));

    return {
      title: `Class Collection Report — ${year}`,
      filename: `class-collection-${year}`,
      columns: [
        { label: "Class", value: "class_name" },
        { label: "Expected", value: (r) => r.expected.toFixed(2) },
        { label: "Received", value: (r) => r.received.toFixed(2) },
        { label: "Outstanding", value: (r) => r.due.toFixed(2) },
        { label: "Collection %", value: (r) => `${r.pct}%` },
      ],
      rows,
    };
  },

  async "monthly-collection"() {
    const year = document.getElementById("reportYearSelectMonthly").value;
    const { data, error } = await sb
      .from("fee_records")
      .select("month, fee_amount, amount_paid, balance_amount")
      .eq("academic_year", year)
      .eq("fee_type", "Monthly");
    if (error) throw error;

    const byMonth = {};
    (data || []).forEach((r) => {
      if (!r.month) return;
      if (!byMonth[r.month]) byMonth[r.month] = { expected: 0, collected: 0, due: 0 };
      byMonth[r.month].expected += Number(r.fee_amount);
      byMonth[r.month].collected += Number(r.amount_paid);
      byMonth[r.month].due += Number(r.balance_amount);
    });

    const rows = MONTH_NAMES.filter((m) => byMonth[m]).map((m) => ({ month: m, ...byMonth[m] }));

    return {
      title: `Monthly Collection Report — ${year}`,
      filename: `monthly-collection-${year}`,
      columns: [
        { label: "Month", value: "month" },
        { label: "Expected", value: (r) => r.expected.toFixed(2) },
        { label: "Collected", value: (r) => r.collected.toFixed(2) },
        { label: "Due", value: (r) => r.due.toFixed(2) },
      ],
      rows,
    };
  },

  async "pending-fees"() {
    const year = document.getElementById("reportYearSelectPending").value;
    const { data, error } = await sb
      .from("fee_records")
      .select("*, students!inner(student_name, student_id, active, classes(class_name))")
      .eq("academic_year", year)
      .neq("payment_status", "Paid")
      .order("balance_amount", { ascending: false });
    if (error) throw error;

    return {
      title: `Pending Fees Report — ${year}`,
      filename: `pending-fees-${year}`,
      columns: [
        { label: "Student", value: (r) => r.students?.student_name },
        { label: "Student ID", value: (r) => r.students?.student_id },
        { label: "Class", value: (r) => r.students?.classes?.class_name },
        { label: "Period", value: (r) => r.month || "Yearly" },
        { label: "Fee Amount", value: (r) => Number(r.fee_amount).toFixed(2) },
        { label: "Discount", value: (r) => Number(r.discount_amount || 0).toFixed(2) },
        { label: "Paid", value: (r) => Number(r.amount_paid).toFixed(2) },
        { label: "Balance", value: (r) => Number(r.balance_amount).toFixed(2) },
        { label: "Status", value: "payment_status" },
      ],
      rows: (data || []).filter((r) => r.students?.active),
    };
  },

  async "yearly-collection"() {
    const { data, error } = await sb.from("fee_records").select("academic_year, fee_amount, amount_paid, balance_amount");
    if (error) throw error;

    const byYear = {};
    (data || []).forEach((r) => {
      if (!byYear[r.academic_year]) byYear[r.academic_year] = { expected: 0, received: 0, due: 0 };
      byYear[r.academic_year].expected += Number(r.fee_amount);
      byYear[r.academic_year].received += Number(r.amount_paid);
      byYear[r.academic_year].due += Number(r.balance_amount);
    });

    const rows = Object.entries(byYear)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([academic_year, d]) => ({ academic_year, ...d, pct: d.expected > 0 ? Math.round((d.received / d.expected) * 100) : 0 }));

    return {
      title: "Yearly Collection Report",
      filename: "yearly-collection-report",
      columns: [
        { label: "Academic Year", value: "academic_year" },
        { label: "Expected", value: (r) => r.expected.toFixed(2) },
        { label: "Received", value: (r) => r.received.toFixed(2) },
        { label: "Outstanding", value: (r) => r.due.toFixed(2) },
        { label: "Collection %", value: (r) => `${r.pct}%` },
      ],
      rows,
    };
  },
};
