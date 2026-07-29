// ============================================================================
// FEES MANAGEMENT
// ============================================================================

let feePaginator;
let feeFilters = { academicYear: CURRENT_ACADEMIC_YEAR, classId: "all", feeType: "all", month: "all", status: "all", search: "" };
let feeClassesCache = [];
let feeActiveStudentsCache = [];

(async function init() {
  await requireAuth();
  const content = renderLayout("fees", "Fee Records");
  content.innerHTML = feesSkeleton();
  feePaginator = new Paginator({ pageSize: 10, onChange: loadFees });

  const urlParams = new URLSearchParams(window.location.search);
  const studentParam = urlParams.get("student");
  if (studentParam) {
    const { data } = await sb.from("students").select("student_name").eq("id", studentParam).single();
    if (data) {
      feeFilters.search = data.student_name;
      document.getElementById("feeSearch").value = data.student_name;
    }
    feeFilters.studentId = studentParam;
  }

  await loadClassFilterOptions();
  wireFeeToolbar();
  await loadFees();
})();

function feesSkeleton() {
  return `
    <div class="toolbar">
      <button class="btn btn--primary" id="generateFeesBtn">⚙ Generate Fees for a Period</button>
      <div class="toolbar__spacer"></div>
      <button class="btn btn--ghost btn--sm" id="exportFeesCsv">Export CSV</button>
    </div>

    <div class="toolbar">
      <div class="search-input"><input type="text" id="feeSearch" placeholder="Search student name…"></div>
      <select class="filter-select" id="feeYearFilter"></select>
      <select class="filter-select" id="feeClassFilter"><option value="all">All classes</option></select>
      <select class="filter-select" id="feeTypeFilter">
        <option value="all">All fee types</option>
        <option value="Monthly">Monthly</option>
        <option value="Yearly">Yearly</option>
      </select>
      <select class="filter-select" id="feeMonthFilter"><option value="all">All months</option></select>
      <select class="filter-select" id="feeStatusFilter">
        <option value="all">All statuses</option>
        <option value="Pending">Pending</option>
        <option value="Partially Paid">Partially Paid</option>
        <option value="Paid">Paid</option>
      </select>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Student</th><th>Class</th><th>Period</th><th>Fee Type</th>
          <th class="num">Fee Amount</th><th class="num">Discount</th><th class="num">Paid</th><th class="num">Balance</th>
          <th>Status</th><th></th>
        </tr></thead>
        <tbody id="feeBody"><tr class="row-loading"><td colspan="10"><div class="spinner"></div>Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="feePagination"></div>
  `;
}

function academicYearOptionsList() {
  const [startY] = CURRENT_ACADEMIC_YEAR.split("-").map(Number);
  const years = [];
  for (let i = -2; i <= 1; i++) years.push(`${startY + i}-${startY + i + 1}`);
  return years;
}

async function loadClassFilterOptions() {
  const { data } = await sb.from("classes").select("id, class_name, fee_type, fee_amount, academic_year, active").order("class_name");
  feeClassesCache = data || [];

  const yearSel = document.getElementById("feeYearFilter");
  yearSel.innerHTML = academicYearOptionsList().map((y) => `<option value="${y}" ${y === feeFilters.academicYear ? "selected" : ""}>${y}</option>`).join("");

  const classSel = document.getElementById("feeClassFilter");
  classSel.innerHTML = `<option value="all">All classes</option>` + feeClassesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.class_name)}</option>`).join("");

  const monthSel = document.getElementById("feeMonthFilter");
  monthSel.innerHTML = `<option value="all">All months</option>` + MONTH_NAMES.map((m) => `<option value="${m}">${m}</option>`).join("");
}

function wireFeeToolbar() {
  document.getElementById("feeSearch").addEventListener(
    "input",
    debounce((e) => {
      feeFilters.search = e.target.value.trim();
      feePaginator.goto(1);
    }, 300)
  );
  document.getElementById("feeYearFilter").addEventListener("change", (e) => { feeFilters.academicYear = e.target.value; feePaginator.goto(1); });
  document.getElementById("feeClassFilter").addEventListener("change", (e) => { feeFilters.classId = e.target.value; feePaginator.goto(1); });
  document.getElementById("feeTypeFilter").addEventListener("change", (e) => { feeFilters.feeType = e.target.value; feePaginator.goto(1); });
  document.getElementById("feeMonthFilter").addEventListener("change", (e) => { feeFilters.month = e.target.value; feePaginator.goto(1); });
  document.getElementById("feeStatusFilter").addEventListener("change", (e) => { feeFilters.status = e.target.value; feePaginator.goto(1); });
  document.getElementById("generateFeesBtn").addEventListener("click", openGenerateFeesDialog);
  document.getElementById("exportFeesCsv").addEventListener("click", exportCurrentFeesCsv);
}

let _lastFeeRows = [];

async function loadFees() {
  const body = document.getElementById("feeBody");
  setLoading(body, true, 10);

  try {
    let query = sb
      .from("fee_records")
      .select("*, students!inner(student_name, student_id, active, class_id, classes(class_name))", { count: "exact" })
      .eq("academic_year", feeFilters.academicYear);

    if (feeFilters.classId !== "all") query = query.eq("students.class_id", feeFilters.classId);
    if (feeFilters.feeType !== "all") query = query.eq("fee_type", feeFilters.feeType);
    if (feeFilters.month !== "all") query = query.eq("month", feeFilters.month);
    if (feeFilters.status !== "all") query = query.eq("payment_status", feeFilters.status);
    if (feeFilters.studentId) query = query.eq("student_id", feeFilters.studentId);
    if (feeFilters.search) query = query.ilike("students.student_name", `%${feeFilters.search}%`);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(feePaginator.from, feePaginator.to);

    if (error) throw error;
    feePaginator.setTotal(count || 0);
    _lastFeeRows = data || [];
    paintFees(_lastFeeRows);
    feePaginator.render(document.getElementById("feePagination"));
  } catch (err) {
    toast(getFriendlyError(err), "error");
    emptyState(body, "Couldn't load fee records.", 10);
  }
}

function paintFees(rows) {
  const body = document.getElementById("feeBody");
  if (rows.length === 0) return emptyState(body, "No fee records match these filters.", 10);

  body.innerHTML = rows
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.students?.student_name || "—")} <span class="text-muted">(${escapeHtml(f.students?.student_id || "")})</span></td>
      <td>${escapeHtml(f.students?.classes?.class_name || "—")}</td>
      <td>${escapeHtml(f.month || "Yearly")}</td>
      <td>${escapeHtml(f.fee_type)}</td>
      <td class="num tabular">${formatCurrency(f.fee_amount)}</td>
      <td class="num tabular">${formatCurrency(f.discount_amount)}</td>
      <td class="num tabular">${formatCurrency(f.amount_paid)}</td>
      <td class="num tabular">${formatCurrency(f.balance_amount)}</td>
      <td>${statusBadge(f.payment_status)}</td>
      <td class="row-actions">
        <button class="btn btn--ghost btn--sm" data-view="${f.id}">Details</button>
        <button class="btn btn--primary btn--sm" data-pay="${f.id}" ${f.payment_status === "Paid" ? "disabled" : ""}>Record Payment</button>
        <button class="btn btn--danger btn--sm" data-delete="${f.id}">Delete</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => viewFeeDetails(rows.find((r) => r.id === btn.dataset.view))));
  body.querySelectorAll("[data-pay]").forEach((btn) => btn.addEventListener("click", () => openPaymentForm(rows.find((r) => r.id === btn.dataset.pay))));
  body.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => deleteFeeRecord(rows.find((r) => r.id === btn.dataset.delete))));
}

async function deleteFeeRecord(f) {
  if (!f) return;
  const ok = await confirmDialog({
    title: "Delete this fee record?",
    message: `This permanently removes the ${f.month || "Yearly"} ${f.academic_year} fee record for ${f.students?.student_name || "this student"}, including any payment recorded against it. This cannot be undone.`,
    confirmLabel: "Delete Record",
  });
  if (!ok) return;

  try {
    const { error } = await sb.from("fee_records").delete().eq("id", f.id);
    if (error) throw error;
    toast("Fee record deleted.");
    await loadFees();
  } catch (err) {
    toast(getFriendlyError(err), "error");
  }
}

function viewFeeDetails(f) {
  if (!f) return;
  openModal(`
    <h3 class="modal__title">${escapeHtml(f.students?.student_name || "Fee Record")}</h3>
    <p class="modal__message">${escapeHtml(f.month || "Yearly")} · ${escapeHtml(f.academic_year)}</p>
    <div class="modal__grid" style="row-gap:14px;">
      <div><div class="text-muted" style="font-size:12px;">Fee Type</div><div>${escapeHtml(f.fee_type)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Status</div><div>${statusBadge(f.payment_status)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Fee Amount</div><div class="tabular">${formatCurrency(f.fee_amount)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Discount</div><div class="tabular">${formatCurrency(f.discount_amount)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Amount Paid</div><div class="tabular">${formatCurrency(f.amount_paid)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Balance</div><div class="tabular">${formatCurrency(f.balance_amount)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Paid Date</div><div>${formatDate(f.paid_date)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Payment Method</div><div>${escapeHtml(f.payment_method || "—")}</div></div>
      <div class="field--full"><div class="text-muted" style="font-size:12px;">Remarks</div><div>${escapeHtml(f.remarks || "—")}</div></div>
    </div>
    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" data-close-modal>Close</button>
    </div>
  `);
}

function openPaymentForm(f) {
  if (!f) return;
  const feeAmount = Number(f.fee_amount);
  const overlay = openModal(`
    <h3 class="modal__title">Record Payment</h3>
    <p class="modal__message">${escapeHtml(f.students?.student_name || "")} · ${escapeHtml(f.month || "Yearly")} ${escapeHtml(f.academic_year)}</p>
    <form id="paymentForm">
      <div class="modal__grid">
        <div class="field"><label>Fee Amount</label><input type="text" disabled value="${formatCurrency(f.fee_amount)}"></div>
        <div class="field"><label>Current Balance</label><input type="text" disabled value="${formatCurrency(f.balance_amount)}"></div>
        <div class="field">
          <label for="amountPaidField">Amount Paid (total received so far)</label>
          <input type="number" id="amountPaidField" min="0" max="${feeAmount}" step="0.01" required value="${f.amount_paid}">
        </div>
        <div class="field">
          <label for="discountAmountField">Discount Amount</label>
          <input type="number" id="discountAmountField" min="0" max="${feeAmount}" step="0.01" value="${f.discount_amount || 0}">
        </div>
        <div class="field field--full">
          <label>New Balance (auto-calculated)</label>
          <input type="text" id="newBalancePreview" disabled value="${formatCurrency(f.balance_amount)}">
        </div>
        <div class="field">
          <label for="paymentMethodField">Payment Method</label>
          <select id="paymentMethodField">
            ${["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other"].map((m) => `<option value="${m}" ${f.payment_method === m ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="paidDateField">Paid Date</label>
          <input type="date" id="paidDateField" value="${f.paid_date || new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="field field--full">
          <label for="remarksField">Remarks</label>
          <textarea id="remarksField" rows="2">${escapeHtml(f.remarks || "")}</textarea>
        </div>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn--primary" id="paymentSubmitBtn">Save Payment</button>
      </div>
    </form>
  `);

  const amountPaidEl = overlay.querySelector("#amountPaidField");
  const discountEl = overlay.querySelector("#discountAmountField");
  const previewEl = overlay.querySelector("#newBalancePreview");

  function refreshPreview() {
    const paid = parseFloat(amountPaidEl.value) || 0;
    const discount = parseFloat(discountEl.value) || 0;
    const balance = Math.max(0, feeAmount - paid - discount);
    previewEl.value = formatCurrency(balance);
  }
  amountPaidEl.addEventListener("input", refreshPreview);
  discountEl.addEventListener("input", refreshPreview);

  overlay.querySelector("#paymentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("paymentSubmitBtn");
    const amountPaid = parseFloat(amountPaidEl.value) || 0;
    const discountAmount = parseFloat(discountEl.value) || 0;

    if (amountPaid < 0 || discountAmount < 0) {
      toast("Amount paid and discount cannot be negative.", "error");
      return;
    }
    if (amountPaid + discountAmount > feeAmount) {
      toast("Amount paid plus discount cannot exceed the fee amount.", "error");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Saving…";

    const payload = {
      amount_paid: amountPaid,
      discount_amount: discountAmount,
      payment_method: document.getElementById("paymentMethodField").value,
      paid_date: document.getElementById("paidDateField").value || null,
      remarks: document.getElementById("remarksField").value.trim() || null,
    };

    try {
      const { error } = await sb.from("fee_records").update(payload).eq("id", f.id);
      if (error) throw error;
      toast("Payment recorded successfully.");
      closeModal(overlay);
      await loadFees();
    } catch (err) {
      toast(getFriendlyError(err), "error");
      btn.disabled = false;
      btn.textContent = "Save Payment";
    }
  });
}

async function openGenerateFeesDialog() {
  // Fetch a fresh list of active students each time the dialog opens.
  const { data: activeStudents, error: studErr } = await sb
    .from("students")
    .select("id, student_name, student_id")
    .eq("active", true)
    .order("student_name");
  if (studErr) return toast(getFriendlyError(studErr), "error");
  feeActiveStudentsCache = activeStudents || [];

  const studentOptions =
    `<option value="">All active students</option>` +
    feeActiveStudentsCache.map((s) => `<option value="${s.id}">${escapeHtml(s.student_name)} (${escapeHtml(s.student_id)})</option>`).join("");

  const overlay = openModal(`
    <h3 class="modal__title">Generate Fees for a Period</h3>
    <p class="modal__message">Creates fee records for the selected period. Leave the student lookup empty to generate for every eligible active student at once — or pick one student to generate just theirs. Existing records are never duplicated, and a student who already has a Yearly record for the year is skipped during Monthly generation.</p>
    <div class="pill-tabs" id="genTypeTabs" style="margin-bottom:18px;">
      <button type="button" class="pill-tab pill-tab--active" data-gen-type="Monthly">Monthly</button>
      <button type="button" class="pill-tab" data-gen-type="Yearly">Yearly</button>
    </div>
    <form id="generateForm">
      <div class="modal__grid">
        <div class="field field--full">
          <label for="genStudent">Student (optional)</label>
          <select id="genStudent">${studentOptions}</select>
        </div>
        <div class="field field--full">
          <label for="genYear">Academic Year</label>
          <input type="text" id="genYear" value="${CURRENT_ACADEMIC_YEAR}" required>
        </div>
        <div class="field field--full" id="genMonthWrap">
          <label for="genMonth">Month</label>
          <select id="genMonth">${MONTH_NAMES.map((m) => `<option ${m === getCurrentMonthName() ? "selected" : ""}>${m}</option>`).join("")}</select>
        </div>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn--primary" id="generateSubmitBtn">Generate Records</button>
      </div>
    </form>
  `);

  let genType = "Monthly";
  overlay.querySelectorAll("[data-gen-type]").forEach((tab) => {
    tab.addEventListener("click", () => {
      genType = tab.dataset.genType;
      overlay.querySelectorAll("[data-gen-type]").forEach((t) => t.classList.toggle("pill-tab--active", t === tab));
      overlay.querySelector("#genMonthWrap").style.display = genType === "Monthly" ? "" : "none";
    });
  });

  overlay.querySelector("#generateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("generateSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Generating…";

    const year = document.getElementById("genYear").value.trim();
    const month = document.getElementById("genMonth").value;
    const studentId = document.getElementById("genStudent").value || null;

    try {
      let result;
      if (genType === "Monthly") {
        result = await sb.rpc("generate_monthly_fees", { p_academic_year: year, p_month: month, p_student_id: studentId });
        console.log('monthly fees record', JSON.stringify(result));
      } else {
        result = await sb.rpc("generate_yearly_fees", { p_academic_year: year, p_student_id: studentId });
        console.log('yearly fees record', JSON.stringify(result));
      }
      if (result.error) throw result.error;
      const createdCount = result.data ?? 0;
      if (createdCount === 0) {
        toast(studentId ? "No record was created — the student may already have one, be inactive, or be on a different fee plan." : "No new records were needed — everyone eligible already has one.", "info");
      } else {
        toast(`Generated ${createdCount} new fee record${createdCount === 1 ? "" : "s"}.`);
      }
      closeModal(overlay);
      await loadFees();
    } catch (err) {
      toast(getFriendlyError(err), "error");
      btn.disabled = false;
      btn.textContent = "Generate Records";
    }
  });
}

function exportCurrentFeesCsv() {
  if (_lastFeeRows.length === 0) {
    return toast("Nothing to export on this page.", "info");
  }

  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12 || 12;
  hours = String(hours).padStart(2, "0");

  const timestamp = `${day}-${month}-${year}-${hours}-${minutes}-${ampm}`;

  exportToCsv(`fee-records-${timestamp}`, [
    { label: "Student", value: (r) => r.students?.student_name },
    { label: "Student ID", value: (r) => r.students?.student_id },
    { label: "Class", value: (r) => r.students?.classes?.class_name },
    { label: "Period", value: (r) => r.month || "Yearly" },
    { label: "Fee Type", value: "fee_type" },
    { label: "Fee Amount", value: (r) => Number(r.fee_amount).toFixed(2) },
    { label: "Discount", value: (r) => Number(r.discount_amount || 0).toFixed(2) },
    { label: "Amount Paid", value: (r) => Number(r.amount_paid).toFixed(2) },
    { label: "Balance", value: (r) => Number(r.balance_amount).toFixed(2) },
    { label: "Status", value: "payment_status" },
    { label: "Paid Date", value: (r) => formatDate(r.paid_date) },
  ], _lastFeeRows);
}
