(function () {
  "use strict";

  const LOCAL_DATA = window.MASTERS_DATA;
  const STORAGE_KEY = "masters-planning-edits-v1";
  const PASSWORD_STORAGE_KEY = "masters-planning-edit-password";
  const API_BASE = "/api";

  const els = {
    modeGate: document.getElementById("modeGate"),
    enterViewMode: document.getElementById("enterViewMode"),
    enterEditMode: document.getElementById("enterEditMode"),
    modeButton: document.getElementById("modeButton"),
    sourceNote: document.getElementById("sourceNote"),
    countryFilter: document.getElementById("countryFilter"),
    bandFilter: document.getElementById("bandFilter"),
    sortFilter: document.getElementById("sortFilter"),
    searchInput: document.getElementById("searchInput"),
    resetButton: document.getElementById("resetButton"),
    exportButton: document.getElementById("exportButton"),
    laneStrip: document.getElementById("laneStrip"),
    resultCount: document.getElementById("resultCount"),
    activeContext: document.getElementById("activeContext"),
    cardsView: document.getElementById("cardsView"),
    passwordDialog: document.getElementById("passwordDialog"),
    passwordForm: document.getElementById("passwordForm"),
    passwordInput: document.getElementById("passwordInput"),
    cancelPasswordButton: document.getElementById("cancelPasswordButton"),
    cancelPasswordAction: document.getElementById("cancelPasswordAction"),
    unlockEditButton: document.getElementById("unlockEditButton"),
    editorDialog: document.getElementById("editorDialog"),
    editorForm: document.getElementById("editorForm"),
    editorMeta: document.getElementById("editorMeta"),
    editorTitle: document.getElementById("editorTitle"),
    editorFields: document.getElementById("editorFields"),
    saveEditorButton: document.getElementById("saveEditorButton"),
    toast: document.getElementById("toast"),
  };

  let DATA = LOCAL_DATA;
  let baseRows = [];
  let bandCatalog = new Map();
  let edits = readEdits();
  let activeEditorId = null;
  let usingDatabase = false;
  let editPassword = sessionStorage.getItem(PASSWORD_STORAGE_KEY) || "";
  const state = {
    mode: null,
    country: LOCAL_DATA?.defaultCountry || "Germany",
    band: "all",
    sort: "group",
    query: "",
  };

  init();

  async function init() {
    if (!DATA || !DATA.sheets) {
      document.body.innerHTML = "<main class=\"empty-state\">Workbook data could not be loaded.</main>";
      return;
    }

    rebuildDataIndexes();
    await loadCloudData();
    populateControls();
    bindEvents();
    render();
  }

  function rebuildDataIndexes() {
    baseRows = DATA.sheets.flatMap((sheet) =>
      sheet.rows.map((row) => ({
        ...row,
        columns: row.columns || sheet.columns,
      })),
    );
    bandCatalog = buildBandCatalog();
    if (!DATA.sheets.some((sheet) => sheet.name === state.country)) {
      state.country = DATA.defaultCountry || "Germany";
    }
  }

  async function loadCloudData() {
    if (window.location.protocol === "file:") {
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/bootstrap`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.sheets)) {
        return;
      }
      DATA = payload;
      usingDatabase = true;
      edits = {};
      rebuildDataIndexes();
    } catch (error) {
      console.info("Using local workbook data preview.", error);
    }
  }

  function buildBandCatalog() {
    const catalog = new Map();
    DATA.sections.forEach((band) => catalog.set(band.key, band));
    baseRows.forEach((row) => {
      if (!catalog.has(row.sourceBand.key)) {
        catalog.set(row.sourceBand.key, row.sourceBand);
      }
    });
    return catalog;
  }

  function populateControls() {
    const sheetCountries = DATA.sheets.map((sheet) => sheet.name);
    const defaultCountry = DATA.defaultCountry || "Germany";
    const countries = [defaultCountry, ...sheetCountries.filter((country) => country !== defaultCountry), "all"];
    els.countryFilter.innerHTML = countries
      .map((country) => `<option value="${escapeAttr(country)}">${country === "all" ? "All countries" : escapeHtml(country)}</option>`)
      .join("");
    els.countryFilter.value = state.country;

    const bandOptions = [`<option value="all">All statuses</option>`];
    for (const [key, band] of bandCatalog) {
      bandOptions.push(`<option value="${escapeAttr(key)}">${escapeHtml(band.label)}</option>`);
    }
    els.bandFilter.innerHTML = bandOptions.join("");

    const generated = new Date(DATA.generatedAt);
    const generatedLabel = Number.isNaN(generated.getTime())
      ? "recently"
      : generated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    els.sourceNote.textContent = `${baseRows.length} applications across ${DATA.sheets.length} countries. Germany opens first. Updated ${generatedLabel}.`;
  }

  function bindEvents() {
    els.enterViewMode.addEventListener("click", () => enterMode("view"));
    els.enterEditMode.addEventListener("click", openPasswordDialog);
    els.passwordForm.addEventListener("submit", requestEditMode);
    els.cancelPasswordButton.addEventListener("click", closePasswordDialog);
    els.cancelPasswordAction.addEventListener("click", closePasswordDialog);
    els.modeButton.addEventListener("click", () => {
      els.modeGate.hidden = false;
      document.body.classList.remove("has-entered");
    });
    els.countryFilter.addEventListener("change", () => {
      state.country = els.countryFilter.value;
      render();
    });
    els.bandFilter.addEventListener("change", () => {
      state.band = els.bandFilter.value;
      render();
    });
    els.sortFilter.addEventListener("change", () => {
      state.sort = els.sortFilter.value;
      render();
    });
    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value.trim().toLowerCase();
      render();
    });
    els.resetButton.addEventListener("click", resetEdits);
    els.exportButton.addEventListener("click", exportVisibleRows);
    els.laneStrip.addEventListener("click", (event) => {
      const button = event.target.closest("[data-band-filter]");
      if (!button) {
        return;
      }
      state.band = button.dataset.bandFilter;
      els.bandFilter.value = state.band;
      render();
    });
    els.cardsView.addEventListener("click", openEditorFromClick);
    els.saveEditorButton.addEventListener("click", saveEditor);
  }

  function enterMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.body.classList.add("has-entered");
    els.modeGate.hidden = true;
    els.modeButton.textContent = mode === "edit" ? "Edit mode" : "View mode";
    els.resetButton.disabled = mode !== "edit";
    render();
    showToast(mode === "edit" ? "Editing unlocked." : "View only mode.");
  }

  function openPasswordDialog() {
    els.passwordInput.value = "";
    if (typeof els.passwordDialog.showModal === "function") {
      els.passwordDialog.showModal();
      window.setTimeout(() => els.passwordInput.focus(), 60);
    } else {
      els.passwordDialog.setAttribute("open", "");
      els.passwordInput.focus();
    }
  }

  function closePasswordDialog() {
    if (typeof els.passwordDialog.close === "function") {
      els.passwordDialog.close();
    } else {
      els.passwordDialog.removeAttribute("open");
    }
  }

  async function requestEditMode(event) {
    event.preventDefault();
    const password = els.passwordInput.value;
    if (!password.trim()) {
      showToast("Enter the edit password.");
      return;
    }

    if (!usingDatabase) {
      editPassword = password;
      sessionStorage.setItem(PASSWORD_STORAGE_KEY, editPassword);
      closePasswordDialog();
      enterMode("edit");
      return;
    }

    els.unlockEditButton.disabled = true;
    try {
      await validateEditPassword(password);
      editPassword = password;
      sessionStorage.setItem(PASSWORD_STORAGE_KEY, editPassword);
      closePasswordDialog();
      enterMode("edit");
    } catch (error) {
      editPassword = "";
      sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
      showToast(error.message || "Wrong password.");
    } finally {
      els.unlockEditButton.disabled = false;
    }
  }

  async function validateEditPassword(password) {
    const response = await fetch(`${API_BASE}/auth`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Wrong password.");
    }
  }

  function render() {
    const allRows = currentRows();
    const visibleRows = filterRows(allRows);
    renderLaneStrip(allRows);
    renderResultsMeta(visibleRows);
    renderCards(visibleRows);
  }

  function currentRows() {
    return baseRows.map((row) => {
      const edit = usingDatabase ? {} : edits[row.id] || {};
      const fields = { ...row.fields, ...(edit.fields || {}) };
      const band = edit.bandKey ? bandCatalog.get(edit.bandKey) || row.sourceBand : row.sourceBand;
      return {
        ...row,
        fields,
        sourceBand: band,
      };
    });
  }

  function filterRows(rows) {
    const filtered = rows.filter((row) => {
      if (state.country !== "all" && row.country !== state.country) {
        return false;
      }
      if (state.band !== "all" && row.sourceBand.key !== state.band) {
        return false;
      }
      if (!state.query) {
        return true;
      }
      return searchableText(row).includes(state.query);
    });

    return filtered.sort(sortRows);
  }

  function searchableText(row) {
    return [
      row.country,
      row.sourceBand.label,
      ...Object.values(row.fields),
    ]
      .join(" ")
      .toLowerCase();
  }

  function sortRows(a, b) {
    const groupDelta = outcomeRank(a) - outcomeRank(b);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    if (state.sort === "group") {
      return a.country.localeCompare(b.country) || a.rowNumber - b.rowNumber;
    }
    if (state.sort === "university") {
      return field(a, "university").localeCompare(field(b, "university"));
    }
    if (state.sort === "country") {
      return a.country.localeCompare(b.country) || field(a, "university").localeCompare(field(b, "university"));
    }
    if (state.sort === "row") {
      return a.country.localeCompare(b.country) || a.rowNumber - b.rowNumber;
    }

    const aDate = sortableDate(field(a, "deadline") || field(a, "enrollmentDeadline"));
    const bDate = sortableDate(field(b, "deadline") || field(b, "enrollmentDeadline"));
    if (aDate !== bDate) {
      return aDate - bDate;
    }
    return a.country.localeCompare(b.country) || a.rowNumber - b.rowNumber;
  }

  function outcomeRank(row) {
    const order = {
      admit: 0,
      waiting: 1,
      rejected: 2,
      skipped: 3,
      action: 4,
    };
    return order[row.sourceBand.key] ?? 9;
  }

  function renderLaneStrip(rows) {
    const counts = new Map();
    rows.forEach((row) => {
      if (state.country !== "all" && row.country !== state.country) {
        return;
      }
      counts.set(row.sourceBand.key, (counts.get(row.sourceBand.key) || 0) + 1);
    });

    const tiles = [];
    for (const [key, band] of bandCatalog) {
      const count = counts.get(key) || 0;
      if (!count && key !== state.band) {
        continue;
      }
      tiles.push(`
        <button class="lane-tile tone-${escapeAttr(band.tone)} ${state.band === key ? "is-active" : ""}" data-band-filter="${escapeAttr(key)}" type="button">
          <span class="eyebrow">${escapeHtml(band.shortLabel || band.label)}</span>
          <strong>${count}</strong>
          <p>${escapeHtml(statusHint(band))}</p>
        </button>
      `);
    }
    els.laneStrip.innerHTML = tiles.join("");
  }

  function statusHint(band) {
    const hints = {
      admit: "Offer received",
      waiting: "Submitted and waiting",
      rejected: "Not selected",
      skipped: "Not applying",
      action: "Needs follow-up",
    };
    return hints[band.key] || band.description || "Application status";
  }

  function renderResultsMeta(rows) {
    const label = rows.length === 1 ? "1 application" : `${rows.length} applications`;
    els.resultCount.textContent = label;
    const parts = [];
    if (state.country !== "all") {
      parts.push(state.country);
    }
    if (state.band !== "all") {
      parts.push((bandCatalog.get(state.band) || {}).label || state.band);
    }
    if (state.query) {
      parts.push(`Search: "${state.query}"`);
    }
    els.activeContext.textContent = parts.length
      ? `Showing ${parts.join(" · ")}.`
      : "Showing Germany first.";
  }

  function renderCards(rows) {
    if (!rows.length) {
      els.cardsView.innerHTML = `<div class="empty-state">No applications match this view.</div>`;
      return;
    }
    els.cardsView.innerHTML = rows.map(renderCard).join("");
  }

  function renderCard(row) {
    const university = field(row, "university") || "University not added";
    const course = field(row, "course") || "Course not specified";
    const enrollmentDeadline = formatDisplayDate(field(row, "enrollmentDeadline"));
    const applicationOpen = formatDisplayDate(field(row, "applicationOpen"));
    const applicationDeadline = formatDisplayDate(field(row, "deadline"));
    const dateApplied = formatDisplayDate(field(row, "dateApplied"));
    const fee = formatFee(field(row, "tuitionFeeEurosPerSem"));
    const comments = field(row, "commentsRejectionReason") || "Not added";
    const links = row.links
      .map((link) => {
        const latestValue = row.fields[link.field];
        const url = isSafeUrl(latestValue) ? latestValue : link.url;
        if (!isSafeUrl(url)) {
          return "";
        }
        return `<a class="link-button" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(shortLinkLabel(link.label))}</a>`;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join("");

    return `
      <article class="program-card tone-${escapeAttr(row.sourceBand.tone)}">
        <div class="card-head">
          <div class="card-title">
            <p class="eyebrow">${escapeHtml(row.country)}</p>
            <h3 class="university">${escapeHtml(university)}</h3>
            <p class="course">${escapeHtml(course)}</p>
          </div>
          <div class="outcome-orb" title="${escapeAttr(row.sourceBand.label)}">
            <span>${escapeHtml(row.sourceBand.shortLabel || row.sourceBand.label)}</span>
          </div>
        </div>

        <dl class="detail-grid">
          ${detail("University", university, "is-wide is-primary")}
          ${detail("Course", course, "is-wide")}
          ${detail("Applied", field(row, "applied") || "Not added")}
          ${detail("Enrollment Deadline", enrollmentDeadline || "Not added")}
          ${detail("Tuition Fee", fee || "Not added")}
          ${detail("Date Applied", dateApplied || "Not added")}
          ${detail("Application Opens", applicationOpen || "Not added")}
          ${detail("Application Deadline", applicationDeadline || "Not added")}
          ${detail("Comments / Rejection Reason", comments, "is-wide is-comment")}
        </dl>

        <div class="card-actions">
          ${links}
          ${state.mode === "edit" ? `<button class="quiet-button edit-button" type="button" data-edit-row="${escapeAttr(row.id)}">Edit details</button>` : ""}
        </div>
      </article>
    `;
  }

  function detail(label, value, className = "") {
    const classes = className ? ` ${className}` : "";
    return `<div class="detail${classes}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function openEditorFromClick(event) {
    const button = event.target.closest("[data-edit-row]");
    if (!button) {
      return;
    }
    if (state.mode !== "edit") {
      showToast("Switch to edit mode to change applications.");
      return;
    }
    openEditor(button.dataset.editRow);
  }

  function openEditor(rowId) {
    const row = currentRows().find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    activeEditorId = rowId;
    els.editorTitle.textContent = field(row, "university") || "University not added";
    els.editorMeta.textContent = row.country;

    const bandOptions = Array.from(bandCatalog)
      .map(([key, band]) => `<option value="${escapeAttr(key)}" ${key === row.sourceBand.key ? "selected" : ""}>${escapeHtml(band.label)}</option>`)
      .join("");

    const fields = [
      `
        <div class="field-editor">
          <label for="field-planningLane">Application status</label>
          <select id="field-planningLane" data-band-input>${bandOptions}</select>
        </div>
      `,
      ...row.columns.map((column) => {
        const value = row.fields[column.key] || "";
        const isWide = ["commentsRejectionReason", "website", "daad"].includes(column.key) || value.length > 80;
        const control = isWide
          ? `<textarea id="field-${escapeAttr(column.key)}" data-field="${escapeAttr(column.key)}">${escapeHtml(value)}</textarea>`
          : `<input id="field-${escapeAttr(column.key)}" data-field="${escapeAttr(column.key)}" value="${escapeAttr(value)}" />`;
        return `
          <div class="field-editor ${isWide ? "is-wide" : ""}">
            <label for="field-${escapeAttr(column.key)}">${escapeHtml(displayColumnLabel(column))}</label>
            ${control}
          </div>
        `;
      }),
    ];

    els.editorFields.innerHTML = fields.join("");
    if (typeof els.editorDialog.showModal === "function") {
      els.editorDialog.showModal();
    } else {
      els.editorDialog.setAttribute("open", "");
    }
  }

  async function saveEditor() {
    if (!activeEditorId) {
      return;
    }
    const row = currentRows().find((item) => item.id === activeEditorId);
    if (!row) {
      return;
    }
    const fields = {};
    els.editorFields.querySelectorAll("[data-field]").forEach((control) => {
      fields[control.dataset.field] = control.value.trim();
    });
    const bandInput = els.editorFields.querySelector("[data-band-input]");
    const bandKey = bandInput ? bandInput.value : row.sourceBand.key;

    els.saveEditorButton.disabled = true;
    try {
      if (usingDatabase) {
        const updatedRow = await saveCloudRow(activeEditorId, fields, bandKey);
        replaceRow(updatedRow);
        showToast("Changes saved.");
      } else {
        edits[activeEditorId] = {
          fields,
          bandKey,
          savedAt: new Date().toISOString(),
        };
        writeEdits();
        showToast("Changes saved locally.");
      }
      els.editorDialog.close();
      activeEditorId = null;
      render();
    } catch (error) {
      showToast(error.message || "Save failed.");
    } finally {
      els.saveEditorButton.disabled = false;
    }
  }

  async function saveCloudRow(rowId, fields, bandKey) {
    if (!editPassword) {
      throw new Error("Unlock edit mode again to save.");
    }

    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${editPassword}`,
    };

    const response = await fetch(`${API_BASE}/programs/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields, bandKey }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Could not save this application.");
    }
    return payload.row;
  }

  function replaceRow(updatedRow) {
    if (!updatedRow || !updatedRow.id) {
      return;
    }
    baseRows = baseRows.map((row) => {
      if (row.id !== updatedRow.id) {
        return row;
      }
      return {
        ...updatedRow,
        columns: updatedRow.columns || row.columns,
      };
    });
  }

  function resetEdits() {
    if (usingDatabase) {
      showToast("Saved changes stay online. Download a copy if needed.");
      return;
    }
    if (!Object.keys(edits).length) {
      showToast("No changes to clear.");
      return;
    }
    const confirmed = window.confirm("Clear saved changes and return to the original list?");
    if (!confirmed) {
      return;
    }
    edits = {};
    writeEdits();
    render();
    showToast("Changes cleared.");
  }

  function exportVisibleRows() {
    const rows = filterRows(currentRows());
    const columns = exportColumns(rows);
    const header = ["Country", "Application status", ...columns.map(displayColumnLabel)];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((row) => {
      const values = [
        row.country,
        row.sourceBand.label,
        ...columns.map((column) => field(row, column.key)),
      ];
      lines.push(values.map(csvCell).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `masters-planning-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${rows.length} applications.`);
  }

  function exportColumns(rows) {
    const seen = new Set();
    const columns = [];
    const sheets = state.country === "all"
      ? DATA.sheets
      : DATA.sheets.filter((sheet) => sheet.name === state.country);

    sheets.forEach((sheet) => {
      sheet.columns.forEach((column) => {
        if (!seen.has(column.key) && rows.some((row) => row.columns.some((item) => item.key === column.key))) {
          seen.add(column.key);
          columns.push(column);
        }
      });
    });

    return columns.filter((column) => rows.some((row) => field(row, column.key)));
  }

  function displayColumnLabel(column) {
    const labels = {
      commentsRejectionReason: "Comments / Rejection Reason",
      tuitionFeeEurosPerSem: "Tuition Fee",
      applicationOpen: "Application Opens",
      deadline: "Application Deadline",
    };
    return labels[column.key] || column.label;
  }

  function readEdits() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (error) {
      console.warn("Could not read local edits", error);
      return {};
    }
  }

  function writeEdits() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  }

  function field(row, key) {
    return row.fields[key] || "";
  }

  function sortableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Date.parse(`${value}T00:00:00`);
  }

  function formatDisplayDate(value) {
    if (!value) {
      return "";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function formatFee(value) {
    if (!value) {
      return "";
    }
    if (value.toLowerCase() === "free") {
      return "Free";
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(numeric);
    }
    return value;
  }

  function shortLinkLabel(label) {
    if (label.toLowerCase().includes("daad")) {
      return "DAAD";
    }
    if (label.toLowerCase().includes("website")) {
      return "Website";
    }
    return label;
  }

  function isSafeUrl(value) {
    return /^https?:\/\//i.test(value || "");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }
})();
