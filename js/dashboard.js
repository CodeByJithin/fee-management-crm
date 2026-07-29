// ============================================================================
// DASHBOARD
// ============================================================================

(async function init() {
  await requireAuth();
  const content = renderLayout("dashboard", "Dashboard");
  content.innerHTML = dashboardSkeleton();
  wireYearFilter();
  await loadDashboard(CURRENT_ACADEMIC_YEAR);
})();

function dashboardSkeleton() {
  return `
    <div class="toolbar">
      <div></div>
      <div class="toolbar__spacer"></div>
      <select class="filter-select" id="yearFilter"></select>
    </div>

    <div class="stat-grid" id="statGrid">
      ${Array.from({ length: 9 }).map(() => `
        <div class="stat-card"><div class="stat-card__label">Loading…</div><div class="stat-card__value">—</div></div>
      `).join("")}
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-title mt-0"><h2>Class-wise Collection</h2><span id="classwiseNote"></span></div>
        <div class="bar-chart" id="classwiseChart"><div class="spinner"></div></div>
      </div>
      <div class="card">
        <div class="section-title mt-0"><h2>Monthly Collection</h2><span></span></div>
        <div class="bar-chart" id="monthlyChart"><div class="spinner"></div></div>
      </div>
    </div>

    <div class="section-title"><h2>Student Due Report</h2><span>Students with a pending balance</span></div>
    <div class="toolbar">
      <div class="search-input"><input type="text" id="dueSearch" placeholder="Search student, class or ID…"></div>
      <div class="toolbar__spacer"></div>
      <button class="btn btn--ghost btn--sm" id="exportDue">Export CSV</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Student</th><th>Class</th><th>Fee Month</th><th>Fee Type</th>
          <th class="num">Amount Due</th><th>Due Since</th>
        </tr></thead>
        <tbody id="dueBody"><tr class="row-loading"><td colspan="6"><div class="spinner"></div>Loading…</td></tr></tbody>
      </table>
    </div>

    <div class="section-title"><h2>Overdue Fees</h2><span>Unpaid balances from previous months</span></div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Student</th><th>Class</th><th>Month</th><th class="num">Amount Due</th><th>Days Overdue</th>
        </tr></thead>
        <tbody id="overdueBody"><tr class="row-loading"><td colspan="5"><div class="spinner"></div>Loading…</td></tr></tbody>
      </table>
    </div>
  `;
}

function wireYearFilter() {
  const sel = document.getElementById("yearFilter");
  const years = academicYearOptions();
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === CURRENT_ACADEMIC_YEAR ? "selected" : ""}>${y}</option>`).join("");
  sel.addEventListener("change", () => loadDashboard(sel.value));
}

function academicYearOptions() {
  const [startY] = CURRENT_ACADEMIC_YEAR.split("-").map(Number);
  const years = [];
  for (let i = -2; i <= 1; i++) years.push(`${startY + i}-${startY + i + 1}`);
  return years;
}

let _dueRows = [];

async function loadDashboard(academicYear) {
  try {
    const [studentsRes, classesRes, feeRes] = await Promise.all([
      sb.from("students").select("id, active"),
      sb.from("classes").select("id, class_name, fee_type, fee_amount, active, academic_year").eq("academic_year", academicYear),
      sb.from("fee_records")
        .select("id, student_id, academic_year, month, fee_type, fee_amount, amount_paid, balance_amount, payment_status, students(student_name, student_id, active, classes(class_name))")
        .eq("academic_year", academicYear),
    ]);

    if (studentsRes.error) throw studentsRes.error;
    if (classesRes.error) throw classesRes.error;
    if (feeRes.error) throw feeRes.error;

    const students = studentsRes.data || [];
    const classes = classesRes.data || [];
    const fees = feeRes.data || [];

    renderStatCards(students, classes, fees);
    renderClasswiseChart(fees);
    renderMonthlyChart(fees);
    renderDueReport(fees);
    renderOverdueReport(fees);
  } catch (err) {
    toast(getFriendlyError(err), "error");
  }
}

function renderStatCards(students, classes, fees) {
  const totalStudents = students.length;
  const activeStudents = students.filter((s) => s.active).length;
  const totalClasses = classes.length;

  const totalExpected = fees.reduce((sum, f) => sum + Number(f.fee_amount), 0);
  const totalReceived = fees.reduce((sum, f) => sum + Number(f.amount_paid), 0);
  const totalDue = fees.reduce((sum, f) => sum + Number(f.balance_amount), 0);

  const thisMonth = getCurrentMonthName();
  const monthFees = fees.filter((f) => f.fee_type === "Monthly" && f.month === thisMonth);
  const monthExpected = monthFees.reduce((sum, f) => sum + Number(f.fee_amount), 0);
  const monthCollected = monthFees.reduce((sum, f) => sum + Number(f.amount_paid), 0);
  const monthDue = monthFees.reduce((sum, f) => sum + Number(f.balance_amount), 0);

  const cards = [
    { label: "Total Students", value: totalStudents, cls: "" },
    { label: "Active Students", value: activeStudents, cls: "success" },
    { label: "Total Classes", value: totalClasses, cls: "" },
    { label: "Total Expected Fees", value: formatCurrency(totalExpected), cls: "info" },
    { label: "Total Amount Received", value: formatCurrency(totalReceived), cls: "success" },
    { label: "Total Outstanding Due", value: formatCurrency(totalDue), cls: "danger" },
    { label: `${thisMonth} Expected`, value: formatCurrency(monthExpected), cls: "info" },
    { label: `${thisMonth} Collected`, value: formatCurrency(monthCollected), cls: "success" },
    { label: `${thisMonth} Due`, value: formatCurrency(monthDue), cls: "warning" },
  ];

  document.getElementById("statGrid").innerHTML = cards
    .map(
      (c) => `
    <div class="stat-card ${c.cls ? `stat-card--${c.cls}` : ""}">
      <div class="stat-card__label">${c.label}</div>
      <div class="stat-card__value tabular">${c.value}</div>
    </div>`
    )
    .join("");
}

function renderClasswiseChart(fees) {
  const byClass = {};
  fees.forEach((f) => {
    const className = f.students?.classes?.class_name || "Unassigned";
    if (!byClass[className]) byClass[className] = { expected: 0, received: 0 };
    byClass[className].expected += Number(f.fee_amount);
    byClass[className].received += Number(f.amount_paid);
  });

  const rows = Object.entries(byClass).sort((a, b) => b[1].expected - a[1].expected);
  const el = document.getElementById("classwiseChart");

  if (rows.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📊</div><p>No fee records yet for this year.</p></div>`;
    return;
  }

  el.innerHTML = rows
    .map(([name, d]) => {
      const pct = d.expected > 0 ? Math.round((d.received / d.expected) * 100) : 0;
      return `
      <div class="bar-row">
        <div class="bar-row__label" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-row__value tabular">${pct}% · ${formatCurrency(d.received)}</div>
      </div>`;
    })
    .join("");
}

function renderMonthlyChart(fees) {
  const byMonth = {};
  fees.filter((f) => f.fee_type === "Monthly" && f.month).forEach((f) => {
    if (!byMonth[f.month]) byMonth[f.month] = { expected: 0, collected: 0 };
    byMonth[f.month].expected += Number(f.fee_amount);
    byMonth[f.month].collected += Number(f.amount_paid);
  });

  const rows = MONTH_NAMES.filter((m) => byMonth[m]).map((m) => [m, byMonth[m]]);
  const el = document.getElementById("monthlyChart");

  if (rows.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📅</div><p>No monthly fee records generated yet.</p></div>`;
    return;
  }

  el.innerHTML = rows
    .map(([month, d]) => {
      const pct = d.expected > 0 ? Math.round((d.collected / d.expected) * 100) : 0;
      return `
      <div class="bar-row">
        <div class="bar-row__label">${month}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-row__value tabular">${formatCurrency(d.collected)} / ${formatCurrency(d.expected)}</div>
      </div>`;
    })
    .join("");
}

function renderDueReport(fees) {
  _dueRows = fees
    .filter((f) => Number(f.balance_amount) > 0 && f.students?.active)
    .sort((a, b) => Number(b.balance_amount) - Number(a.balance_amount));

  paintDueRows(_dueRows);

  document.getElementById("dueSearch").addEventListener(
    "input",
    debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = _dueRows.filter((f) => {
        const name = (f.students?.student_name || "").toLowerCase();
        const sid = (f.students?.student_id || "").toLowerCase();
        const cls = (f.students?.classes?.class_name || "").toLowerCase();
        return name.includes(q) || sid.includes(q) || cls.includes(q);
      });
      paintDueRows(filtered);
    }, 250)
  );

  document.getElementById("exportDue").addEventListener("click", () => {
    exportToCsv("student-due-report", [
      { label: "Student", value: (r) => r.students?.student_name },
      { label: "Class", value: (r) => r.students?.classes?.class_name },
      { label: "Fee Month", value: (r) => r.month || "Yearly" },
      { label: "Fee Type", value: "fee_type" },
      { label: "Amount Due", value: (r) => Number(r.balance_amount).toFixed(2) },
      { label: "Due Since", value: (r) => formatDate(r.created_at) },
    ], _dueRows);
  });
}

function paintDueRows(rows) {
  const body = document.getElementById("dueBody");
  if (rows.length === 0) {
    emptyState(body, "No outstanding dues. Everyone's paid up! 🎉", 6);
    return;
  }
  body.innerHTML = rows
    .slice(0, 100)
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.students?.student_name || "—")} <span class="text-muted">(${escapeHtml(f.students?.student_id || "")})</span></td>
      <td>${escapeHtml(f.students?.classes?.class_name || "—")}</td>
      <td>${escapeHtml(f.month || "Yearly")}</td>
      <td>${escapeHtml(f.fee_type)}</td>
      <td class="num tabular">${formatCurrency(f.balance_amount)}</td>
      <td>${formatDate(f.created_at)}</td>
    </tr>`
    )
    .join("");
}

function renderOverdueReport(fees) {
  const currentMonthIdx = MONTH_NAMES.indexOf(getCurrentMonthName());
  const overdue = fees.filter((f) => {
    if (Number(f.balance_amount) <= 0 || !f.students?.active) return false;
    if (f.fee_type !== "Monthly" || !f.month) return false;
    return MONTH_NAMES.indexOf(f.month) < currentMonthIdx;
  }).sort((a, b) => Number(b.balance_amount) - Number(a.balance_amount));

  const body = document.getElementById("overdueBody");
  if (overdue.length === 0) {
    emptyState(body, "No overdue balances from previous months.", 5);
    return;
  }
  body.innerHTML = overdue
    .slice(0, 100)
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.students?.student_name || "—")}</td>
      <td>${escapeHtml(f.students?.classes?.class_name || "—")}</td>
      <td>${escapeHtml(f.month)}</td>
      <td class="num tabular">${formatCurrency(f.balance_amount)}</td>
      <td>${daysSince(f.created_at)} days</td>
    </tr>`
    )
    .join("");
}
