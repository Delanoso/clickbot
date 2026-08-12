const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const notesDot = document.getElementById("notesDot");
const notesCountLabel = document.getElementById("notesCountLabel");
const notesStatus = document.getElementById("notesStatus");
const categoryList = document.getElementById("categoryList");
const notesSearch = document.getElementById("notesSearch");
const notesSearchClear = document.getElementById("notesSearchClear");
const notesList = document.getElementById("notesList");
const listMeta = document.getElementById("listMeta");
const newNoteBtn = document.getElementById("newNoteBtn");
const editorPanel = document.getElementById("editorPanel");
const editorTitle = document.getElementById("editorTitle");
const editorHint = document.getElementById("editorHint");
const noteForm = document.getElementById("noteForm");
const noteId = document.getElementById("noteId");
const noteTitle = document.getElementById("noteTitle");
const noteCategory = document.getElementById("noteCategory");
const noteTags = document.getElementById("noteTags");
const notePinned = document.getElementById("notePinned");
const noteBody = document.getElementById("noteBody");
const noteFormNote = document.getElementById("noteFormNote");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");

let categories = [];
let activeCategory = "all";
let latestNotes = [];
let counts = { all: 0 };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function categoryLabel(id) {
  return categories.find((c) => c.id === id)?.label || id || "General";
}

function fillCategorySelect() {
  noteCategory.innerHTML = categories
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`)
    .join("");
}

function renderCategories() {
  const items = [
    { id: "all", label: "All notes" },
    ...categories,
  ];
  categoryList.innerHTML = items
    .map((c) => {
      const count = c.id === "all" ? counts.all || 0 : counts[c.id] || 0;
      return `<button type="button" class="notes-cat-btn${
        activeCategory === c.id ? " active" : ""
      }" data-category="${escapeHtml(c.id)}">
        <span>${escapeHtml(c.label)}</span>
        <strong>${count}</strong>
      </button>`;
    })
    .join("");
}

function renderNotes() {
  const total = counts.all || 0;
  notesCountLabel.textContent = `${total} note${total === 1 ? "" : "s"}`;
  notesDot.className = `status-dot ${total ? "running" : "idle"}`;
  listMeta.textContent =
    activeCategory === "all"
      ? `Showing ${latestNotes.length} note${latestNotes.length === 1 ? "" : "s"}`
      : `${categoryLabel(activeCategory)} · ${latestNotes.length} note${
          latestNotes.length === 1 ? "" : "s"
        }`;

  if (!latestNotes.length) {
    notesList.innerHTML = `<p class="empty-note">No notes here yet. Tap <strong>New note</strong> to start.</p>`;
    return;
  }

  notesList.innerHTML = latestNotes
    .map((note) => {
      const tags = (note.tags || [])
        .map((t) => `<span class="note-tag">${escapeHtml(t)}</span>`)
        .join("");
      const preview = String(note.body || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
      return `<article class="note-card${note.pinned ? " pinned" : ""}" data-id="${escapeHtml(
        note.id
      )}">
        <div class="note-card-top">
          <div>
            <h3>${escapeHtml(note.title)}${
              note.pinned ? ' <span class="note-pin-badge">Pinned</span>' : ""
            }</h3>
            <p class="note-card-meta">${escapeHtml(categoryLabel(note.category))} · Updated ${escapeHtml(
              formatWhen(note.updatedAt)
            )}</p>
          </div>
          <div class="task-actions">
            <button type="button" class="btn" data-edit="${escapeHtml(note.id)}">Edit</button>
            <button type="button" class="btn" data-pin="${escapeHtml(note.id)}">${
              note.pinned ? "Unpin" : "Pin"
            }</button>
            <button type="button" class="btn danger-btn" data-delete="${escapeHtml(
              note.id
            )}">Delete</button>
          </div>
        </div>
        <p class="note-card-body">${escapeHtml(preview || "(empty)")}${
          (note.body || "").length > 180 ? "…" : ""
        }</p>
        ${tags ? `<div class="note-tags">${tags}</div>` : ""}
      </article>`;
    })
    .join("");
}

function openEditor(note = null) {
  editorPanel.hidden = false;
  if (note) {
    editorTitle.textContent = "Edit note";
    editorHint.textContent = "Update and save.";
    noteId.value = note.id;
    noteTitle.value = note.title || "";
    noteCategory.value = note.category || "general";
    noteTags.value = (note.tags || []).join(", ");
    notePinned.checked = Boolean(note.pinned);
    noteBody.value = note.body || "";
  } else {
    editorTitle.textContent = "New note";
    editorHint.textContent = "Write and save — changes stay on this VPS.";
    noteId.value = "";
    noteTitle.value = "";
    noteCategory.value =
      activeCategory !== "all" ? activeCategory : "general";
    noteTags.value = "";
    notePinned.checked = false;
    noteBody.value = "";
  }
  noteFormNote.textContent = "";
  noteTitle.focus();
  editorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editorPanel.hidden = true;
  noteId.value = "";
  noteFormNote.textContent = "";
}

async function refresh() {
  const params = new URLSearchParams();
  if (activeCategory && activeCategory !== "all") {
    params.set("category", activeCategory);
  }
  const q = notesSearch.value.trim();
  if (q) params.set("q", q);

  const [healthRes, notesRes] = await Promise.all([
    fetch("/api/health"),
    fetch(`/api/notes?${params.toString()}`),
  ]);
  const health = await healthRes.json();
  const payload = await notesRes.json();
  if (!notesRes.ok) {
    notesStatus.textContent = payload.error || "Failed to load notes";
    return;
  }

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/notes`;
  clockLine.textContent = new Date().toLocaleString();

  categories = payload.categories || [];
  counts = payload.counts || { all: 0 };
  latestNotes = payload.notes || [];
  if (!noteCategory.options.length) fillCategorySelect();
  renderCategories();
  renderNotes();
  notesStatus.textContent = "Saved on this server";
}

categoryList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-category]");
  if (!btn) return;
  activeCategory = btn.getAttribute("data-category") || "all";
  void refresh();
});

notesSearch.addEventListener("input", () => {
  notesSearchClear.hidden = !notesSearch.value.trim();
  void refresh();
});

notesSearchClear.addEventListener("click", () => {
  notesSearch.value = "";
  notesSearchClear.hidden = true;
  void refresh();
});

newNoteBtn.addEventListener("click", () => openEditor(null));
cancelEditBtn.addEventListener("click", () => closeEditor());

async function saveCurrentNote() {
  if (!noteTitle.value.trim()) {
    noteFormNote.textContent = "Add a title first";
    noteTitle.focus();
    return;
  }
  saveNoteBtn.disabled = true;
  const bottomBtn = document.getElementById("saveNoteBtnBottom");
  if (bottomBtn) bottomBtn.disabled = true;
  noteFormNote.textContent = "Saving…";
  const payload = {
    title: noteTitle.value.trim(),
    body: noteBody.value,
    category: noteCategory.value || "general",
    tags: noteTags.value,
    pinned: notePinned.checked,
  };
  const id = noteId.value.trim();
  try {
    const res = await fetch(id ? `/api/notes/${encodeURIComponent(id)}` : "/api/notes", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
    noteFormNote.textContent = "Saved";
    closeEditor();
    await refresh();
  } catch (error) {
    noteFormNote.textContent = error.message || String(error);
  } finally {
    saveNoteBtn.disabled = false;
    if (bottomBtn) bottomBtn.disabled = false;
  }
}

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCurrentNote();
});

saveNoteBtn.addEventListener("click", (event) => {
  event.preventDefault();
  void saveCurrentNote();
});

notesList.addEventListener("click", async (event) => {
  const editBtn = event.target.closest("[data-edit]");
  if (editBtn) {
    const id = editBtn.getAttribute("data-edit");
    const note = latestNotes.find((n) => n.id === id);
    if (note) openEditor(note);
    return;
  }

  const pinBtn = event.target.closest("[data-pin]");
  if (pinBtn) {
    const id = pinBtn.getAttribute("data-pin");
    const note = latestNotes.find((n) => n.id === id);
    if (!note) return;
    pinBtn.disabled = true;
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update pin");
      await refresh();
    } catch (error) {
      notesStatus.textContent = error.message || String(error);
    } finally {
      pinBtn.disabled = false;
    }
    return;
  }

  const deleteBtn = event.target.closest("[data-delete]");
  if (deleteBtn) {
    const id = deleteBtn.getAttribute("data-delete");
    const note = latestNotes.find((n) => n.id === id);
    if (!note) return;
    if (!confirm(`Delete “${note.title}”?`)) return;
    deleteBtn.disabled = true;
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete");
      if (noteId.value === id) closeEditor();
      await refresh();
    } catch (error) {
      notesStatus.textContent = error.message || String(error);
    } finally {
      deleteBtn.disabled = false;
    }
  }
});

setInterval(() => {
  clockLine.textContent = new Date().toLocaleString();
}, 1000);

void refresh();
