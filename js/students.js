// ============================================================================
// STUDENT MANAGEMENT
// ============================================================================

let studentPaginator;
let studentFilters = { search: "", classId: "all", status: "active" };
let allClassesCache = [];

(async function init() {
  await requireAuth();
  const content = renderLayout("students", "Students");
  content.innerHTML = studentsSkeleton();
  studentPaginator = new Paginator({ pageSize: 10, onChange: loadStudents });
  await loadClassOptions();
  wireStudentToolbar();
  await loadStudents();
})();

function studentsSkeleton() {
  return `
    <div class="toolbar">
      <div class="search-input"><input type="text" id="studentSearch" placeholder="Search name, student ID or parent name…"></div>
      <select class="filter-select" id="classFilterSelect"><option value="all">All classes</option></select>
      <select class="filter-select" id="statusFilterSelect">
        <option value="all">All statuses</option>
        <option value="active" selected>Active only</option>
        <option value="inactive">Inactive only</option>
      </select>
      <div class="toolbar__spacer"></div>
      <button class="btn btn--primary" id="addStudentBtn">+ Add Student</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Student ID</th><th>Name</th><th>Class</th><th>Parent</th>
          <th>Parent Phone</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="studentBody"><tr class="row-loading"><td colspan="7"><div class="spinner"></div>Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="studentPagination"></div>
  `;
}

async function loadClassOptions() {
  const { data, error } = await sb.from("classes").select("id, class_name, fee_type, fee_amount, academic_year, active").order("class_name");
  if (error) return toast(getFriendlyError(error), "error");
  allClassesCache = data || [];
  const sel = document.getElementById("classFilterSelect");
  sel.innerHTML =
    `<option value="all">All classes</option>` +
    allClassesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.class_name)} (${escapeHtml(c.academic_year)})</option>`).join("");
}

function wireStudentToolbar() {
  document.getElementById("studentSearch").addEventListener(
    "input",
    debounce((e) => {
      studentFilters.search = e.target.value.trim();
      studentPaginator.goto(1);
    }, 300)
  );
  document.getElementById("classFilterSelect").addEventListener("change", (e) => {
    studentFilters.classId = e.target.value;
    studentPaginator.goto(1);
  });
  document.getElementById("statusFilterSelect").addEventListener("change", (e) => {
    studentFilters.status = e.target.value;
    studentPaginator.goto(1);
  });
  document.getElementById("addStudentBtn").addEventListener("click", () => openStudentForm());
}

async function loadStudents() {
  const body = document.getElementById("studentBody");
  setLoading(body, true, 7);

  try {
    let query = sb.from("students").select("*, classes(class_name)", { count: "exact" });

    if (studentFilters.search) {
      const q = studentFilters.search;
      query = query.or(`student_name.ilike.%${q}%,student_id.ilike.%${q}%,parent_name.ilike.%${q}%`);
    }
    if (studentFilters.classId !== "all") query = query.eq("class_id", studentFilters.classId);
    if (studentFilters.status === "active") query = query.eq("active", true);
    if (studentFilters.status === "inactive") query = query.eq("active", false);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(studentPaginator.from, studentPaginator.to);

    if (error) throw error;
    studentPaginator.setTotal(count || 0);
    paintStudents(data || []);
    studentPaginator.render(document.getElementById("studentPagination"));
  } catch (err) {
    toast(getFriendlyError(err), "error");
    emptyState(body, "Couldn't load students.", 7);
  }
}

function paintStudents(rows) {
  const body = document.getElementById("studentBody");
  if (rows.length === 0) return emptyState(body, "No students found. Try adjusting your filters or add a new student.", 7);

  body.innerHTML = rows
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.student_id)}</td>
      <td>${escapeHtml(s.student_name)}</td>
      <td>${escapeHtml(s.classes?.class_name || "—")}</td>
      <td>${escapeHtml(s.parent_name)}</td>
      <td>${escapeHtml(s.parent_phone || "—")}</td>
      <td><span class="badge ${s.active ? "badge--active" : "badge--inactive"}">${s.active ? "Active" : "Inactive"}</span></td>
      <td class="row-actions">
        <button class="btn btn--ghost btn--sm" data-view="${s.id}">View</button>
        <button class="btn btn--ghost btn--sm" data-edit="${s.id}">Edit</button>
        ${s.active ? `<button class="btn btn--danger btn--sm" data-deactivate="${s.id}">Deactivate</button>` : ""}
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => viewStudent(rows.find((r) => r.id === btn.dataset.view)))
  );
  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openStudentForm(rows.find((r) => r.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-deactivate]").forEach((btn) =>
    btn.addEventListener("click", () => deactivateStudent(btn.dataset.deactivate))
  );
}

function classSelectOptions(selectedId) {
  return allClassesCache
    .map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.class_name)} · ${escapeHtml(c.fee_type)} (${escapeHtml(c.academic_year)})</option>`)
    .join("");
}

function openStudentForm(existing) {
  const isEdit = !!existing;
  const overlay = openModal(
    `
    <h3 class="modal__title">${isEdit ? "Edit Student" : "Add Student"}</h3>
    <p class="modal__message">${isEdit ? "Update this student's details." : "After adding, use \u201cGenerate Fees for a Period\u201d on the Fee Records page to create their first fee record."}</p>
    <form id="studentForm">
      <div class="modal__grid">
        <div class="field">
          <label for="studentIdField">Student ID</label>
          <input type="text" id="studentIdField" placeholder="e.g. STU0001" required value="${escapeHtml(existing?.student_id || "")}">
        </div>
        <div class="field">
          <label for="studentNameField">Student Name</label>
          <input type="text" id="studentNameField" required value="${escapeHtml(existing?.student_name || "")}">
        </div>
        <div class="field">
          <label for="parentNameField">Parent Name</label>
          <input type="text" id="parentNameField" required value="${escapeHtml(existing?.parent_name || "")}">
        </div>
        <div class="field">
          <label for="classField">Class</label>
          <select id="classField" required><option value="">Select class…</option>${classSelectOptions(existing?.class_id)}</select>
        </div>
        <div class="field">
          <label for="studentPhoneField">Student Phone</label>
          <input type="tel" id="studentPhoneField" value="${escapeHtml(existing?.student_phone || "")}">
        </div>
        <div class="field">
          <label for="parentPhoneField">Parent Phone</label>
          <input type="tel" id="parentPhoneField" value="${escapeHtml(existing?.parent_phone || "")}">
        </div>
        <div class="field">
          <label for="bloodGroupField">Blood Group</label>
          <select id="bloodGroupField">
            ${["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => `<option value="${bg}" ${existing?.blood_group === bg ? "selected" : ""}>${bg || "Select…"}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="admissionDateField">Admission Date</label>
          <input type="date" id="admissionDateField" required value="${existing?.admission_date || new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="field field--full">
          <label class="flex-row"><input type="checkbox" id="studentActiveField" style="width:auto" ${existing?.active !== false ? "checked" : ""}> Active</label>
        </div>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn--primary" id="studentSubmitBtn">${isEdit ? "Save Changes" : "Add Student"}</button>
      </div>
    </form>
  `,
    { size: "modal--lg" }
  );

  overlay.querySelector("#studentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("studentSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    const payload = {
      student_id: document.getElementById("studentIdField").value.trim(),
      student_name: document.getElementById("studentNameField").value.trim(),
      parent_name: document.getElementById("parentNameField").value.trim(),
      class_id: document.getElementById("classField").value,
      student_phone: document.getElementById("studentPhoneField").value.trim() || null,
      parent_phone: document.getElementById("parentPhoneField").value.trim() || null,
      blood_group: document.getElementById("bloodGroupField").value || null,
      admission_date: document.getElementById("admissionDateField").value,
      active: document.getElementById("studentActiveField").checked,
    };

    try {
      if (isEdit) {
        const { error } = await sb.from("students").update(payload).eq("id", existing.id);
        if (error) throw error;
        toast("Student updated successfully.");
      } else {
        const { error } = await sb.from("students").insert(payload);
        if (error) throw error;
        // Fee records are never generated automatically — only via
        // "Generate Fees for a Period" on the Fee Records page.
        toast("Student added successfully. Generate their fee record from the Fee Records page.");
      }
      closeModal(overlay);
      await loadStudents();
    } catch (err) {
      toast(getFriendlyError(err), "error");
      btn.disabled = false;
      btn.textContent = isEdit ? "Save Changes" : "Add Student";
    }
  });
}

function viewStudent(s) {
  if (!s) return;
  openModal(`
    <h3 class="modal__title">${escapeHtml(s.student_name)}</h3>
    <p class="modal__message">Student ID: ${escapeHtml(s.student_id)}</p>
    <div class="modal__grid" style="row-gap:14px;">
      <div><div class="text-muted" style="font-size:12px;">Class</div><div>${escapeHtml(s.classes?.class_name || "—")}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Status</div><div><span class="badge ${s.active ? "badge--active" : "badge--inactive"}">${s.active ? "Active" : "Inactive"}</span></div></div>
      <div><div class="text-muted" style="font-size:12px;">Parent Name</div><div>${escapeHtml(s.parent_name)}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Parent Phone</div><div>${escapeHtml(s.parent_phone || "—")}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Student Phone</div><div>${escapeHtml(s.student_phone || "—")}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Blood Group</div><div>${escapeHtml(s.blood_group || "—")}</div></div>
      <div><div class="text-muted" style="font-size:12px;">Admission Date</div><div>${formatDate(s.admission_date)}</div></div>
    </div>
    <div class="modal__actions">
      <a class="btn btn--primary" href="fees.html?student=${s.id}">View Fee History</a>
      <button type="button" class="btn btn--ghost" data-close-modal>Close</button>
    </div>
  `);
}

async function deactivateStudent(id) {
  const ok = await confirmDialog({
    title: "Deactivate this student?",
    message: "No new monthly fee records will be generated for this student going forward. Existing records are kept.",
    confirmLabel: "Deactivate",
  });
  if (!ok) return;

  try {
    const { error } = await sb.from("students").update({ active: false }).eq("id", id);
    if (error) throw error;
    toast("Student deactivated.");
    await loadStudents();
  } catch (err) {
    toast(getFriendlyError(err), "error");
  }
}
