// ============================================================================
// CLASS MANAGEMENT
// ============================================================================

let classPaginator;
let classFilters = { search: "", status: "all" };

(async function init() {
  await requireAuth();
  const content = renderLayout("classes", "Classes");
  content.innerHTML = classesSkeleton();
  classPaginator = new Paginator({ pageSize: 10, onChange: loadClasses });
  wireClassToolbar();
  await loadClasses();
})();

function classesSkeleton() {
  return `
    <div class="toolbar">
      <div class="search-input"><input type="text" id="classSearch" placeholder="Search by class name…"></div>
      <select class="filter-select" id="classStatusFilter">
        <option value="all">All statuses</option>
        <option value="active">Active only</option>
        <option value="inactive">Inactive only</option>
      </select>
      <div class="toolbar__spacer"></div>
      <button class="btn btn--primary" id="addClassBtn">+ Add Class</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Class Name</th><th>Fee Type</th><th class="num">Fee Amount</th>
          <th>Academic Year</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="classBody"><tr class="row-loading"><td colspan="6"><div class="spinner"></div>Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="classPagination"></div>
  `;
}

function wireClassToolbar() {
  document.getElementById("classSearch").addEventListener(
    "input",
    debounce((e) => {
      classFilters.search = e.target.value.trim();
      classPaginator.goto(1);
    }, 300)
  );
  document.getElementById("classStatusFilter").addEventListener("change", (e) => {
    classFilters.status = e.target.value;
    classPaginator.goto(1);
  });
  document.getElementById("addClassBtn").addEventListener("click", () => openClassForm());
}

async function loadClasses() {
  const body = document.getElementById("classBody");
  setLoading(body, true, 6);

  try {
    let query = sb.from("classes").select("*", { count: "exact" });
    if (classFilters.search) query = query.ilike("class_name", `%${classFilters.search}%`);
    if (classFilters.status === "active") query = query.eq("active", true);
    if (classFilters.status === "inactive") query = query.eq("active", false);

    const { data, error, count } = await query
      .order("academic_year", { ascending: false })
      .order("class_name", { ascending: true })
      .range(classPaginator.from, classPaginator.to);

    if (error) throw error;
    classPaginator.setTotal(count || 0);
    paintClasses(data || []);
    classPaginator.render(document.getElementById("classPagination"));
  } catch (err) {
    toast(getFriendlyError(err), "error");
    emptyState(body, "Couldn't load classes.", 6);
  }
}

function paintClasses(rows) {
  const body = document.getElementById("classBody");
  if (rows.length === 0) return emptyState(body, "No classes found. Add your first class to get started.", 6);

  body.innerHTML = rows
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.class_name)}</td>
      <td>${escapeHtml(c.fee_type)}</td>
      <td class="num tabular">${formatCurrency(c.fee_amount)}</td>
      <td>${escapeHtml(c.academic_year)}</td>
      <td><span class="badge ${c.active ? "badge--active" : "badge--inactive"}">${c.active ? "Active" : "Inactive"}</span></td>
      <td class="row-actions">
        <button class="btn btn--ghost btn--sm" data-edit="${c.id}">Edit</button>
        <button class="btn btn--danger btn--sm" data-delete="${c.id}">Delete</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const cls = rows.find((r) => r.id === btn.dataset.edit);
      openClassForm(cls);
    })
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteClass(btn.dataset.delete))
  );
}

function openClassForm(existing) {
  const isEdit = !!existing;
  const overlay = openModal(`
    <h3 class="modal__title">${isEdit ? "Edit Class" : "Add Class"}</h3>
    <p class="modal__message">${isEdit ? "Update the class details below." : "Fill in the details for the new class."}</p>
    <form id="classForm">
      <div class="modal__grid">
        <div class="field field--full">
          <label for="className">Class Name</label>
          <input type="text" id="className" placeholder="e.g. Grade 1 A" required value="${escapeHtml(existing?.class_name || "")}">
        </div>
        <div class="field">
          <label for="feeType">Fee Type</label>
          <select id="feeType" required>
            <option value="Monthly" ${existing?.fee_type === "Monthly" ? "selected" : ""}>Monthly</option>
            <option value="Yearly" ${existing?.fee_type === "Yearly" ? "selected" : ""}>Yearly</option>
          </select>
        </div>
        <div class="field">
          <label for="feeAmount">Fee Amount (₹)</label>
          <input type="number" id="feeAmount" min="0" step="0.01" required value="${existing?.fee_amount ?? ""}">
        </div>
        <div class="field field--full">
          <label for="academicYear">Academic Year</label>
          <input type="text" id="academicYear" placeholder="e.g. ${CURRENT_ACADEMIC_YEAR}" required value="${escapeHtml(existing?.academic_year || CURRENT_ACADEMIC_YEAR)}">
        </div>
        <div class="field field--full">
          <label class="flex-row"><input type="checkbox" id="classActive" style="width:auto" ${existing?.active !== false ? "checked" : ""}> Active</label>
        </div>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn--primary" id="classSubmitBtn">${isEdit ? "Save Changes" : "Add Class"}</button>
      </div>
    </form>
  `);

  overlay.querySelector("#classForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("classSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    const payload = {
      class_name: document.getElementById("className").value.trim(),
      fee_type: document.getElementById("feeType").value,
      fee_amount: parseFloat(document.getElementById("feeAmount").value),
      academic_year: document.getElementById("academicYear").value.trim(),
      active: document.getElementById("classActive").checked,
    };

    try {
      if (isEdit) {
        const { error } = await sb.from("classes").update(payload).eq("id", existing.id);
        if (error) throw error;
        toast("Class updated successfully.");
      } else {
        const { error } = await sb.from("classes").insert(payload);
        if (error) throw error;
        toast("Class added successfully.");
      }
      closeModal(overlay);
      await loadClasses();
    } catch (err) {
      toast(getFriendlyError(err), "error");
      btn.disabled = false;
      btn.textContent = isEdit ? "Save Changes" : "Add Class";
    }
  });
}

async function deleteClass(id) {
  const ok = await confirmDialog({
    title: "Delete this class?",
    message: "Students assigned to this class will keep their record, but the class link will be removed. This cannot be undone.",
    confirmLabel: "Delete Class",
  });
  if (!ok) return;

  try {
    const { error } = await sb.from("classes").delete().eq("id", id);
    if (error) throw error;
    toast("Class deleted.");
    await loadClasses();
  } catch (err) {
    toast(getFriendlyError(err), "error");
  }
}
