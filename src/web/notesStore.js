import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOTES_PATH = join(root, "data", "notes.json");

export const NOTE_CATEGORIES = Object.freeze([
  { id: "general", label: "General" },
  { id: "ppe", label: "Driver PPE" },
  { id: "incident", label: "Driver Incident" },
  { id: "camera", label: "Truck Camera" },
  { id: "wake", label: "Wake Trucks" },
  { id: "ops", label: "Ops / Other" },
]);

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* serialize notes writes */
  }
}

function withLock(fn) {
  const lockPath = `${NOTES_PATH}.lock`;
  mkdirSync(dirname(NOTES_PATH), { recursive: true });
  const started = Date.now();
  let fd;
  while (fd == null) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${process.pid}\n`);
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
      if (Date.now() - started > 10000) {
        throw new Error(`Timed out waiting for notes lock: ${lockPath}`);
      }
      try {
        if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 60000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* ignore */
      }
      sleepSync(30);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

function emptyStore() {
  return { version: 1, notes: [] };
}

function loadStore() {
  if (!existsSync(NOTES_PATH)) return emptyStore();
  try {
    const data = JSON.parse(readFileSync(NOTES_PATH, "utf8"));
    return {
      version: 1,
      notes: Array.isArray(data.notes) ? data.notes.map(normalizeNote).filter(Boolean) : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  mkdirSync(dirname(NOTES_PATH), { recursive: true });
  writeFileSync(NOTES_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function newId() {
  return `n_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

function normalizeCategory(value) {
  const raw = String(value || "general")
    .trim()
    .toLowerCase();
  if (NOTE_CATEGORIES.some((c) => c.id === raw)) return raw;
  return "general";
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((t) => String(t || "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 12)
      ),
    ];
  }
  return String(value || "")
    .split(/[,#]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeNote(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  if (!id) return null;
  return {
    id,
    title: String(value.title || "").trim() || "Untitled note",
    body: String(value.body || ""),
    category: normalizeCategory(value.category),
    tags: normalizeTags(value.tags),
    pinned: Boolean(value.pinned),
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || value.createdAt || new Date().toISOString(),
  };
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

export function listNotes({ category = null, q = "" } = {}) {
  const store = loadStore();
  const query = String(q || "")
    .trim()
    .toLowerCase();
  let notes = store.notes;
  const rawCategory = String(category || "")
    .trim()
    .toLowerCase();
  if (rawCategory && rawCategory !== "all") {
    const cat = normalizeCategory(rawCategory);
    notes = notes.filter((n) => n.category === cat);
  }
  if (query) {
    notes = notes.filter((n) => {
      const hay = [n.title, n.body, n.category, ...(n.tags || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }
  return {
    categories: NOTE_CATEGORIES,
    notes: sortNotes(notes),
    counts: NOTE_CATEGORIES.reduce((acc, c) => {
      acc[c.id] = store.notes.filter((n) => n.category === c.id).length;
      return acc;
    }, { all: store.notes.length }),
  };
}

export function getNote(id) {
  const store = loadStore();
  return store.notes.find((n) => n.id === id) || null;
}

export function createNote({ title, body, category, tags, pinned } = {}) {
  return withLock(() => {
    const store = loadStore();
    const now = new Date().toISOString();
    const note = normalizeNote({
      id: newId(),
      title,
      body,
      category,
      tags,
      pinned,
      createdAt: now,
      updatedAt: now,
    });
    store.notes.unshift(note);
    saveStore(store);
    return note;
  });
}

export function updateNote(id, patch = {}) {
  return withLock(() => {
    const store = loadStore();
    const idx = store.notes.findIndex((n) => n.id === id);
    if (idx < 0) return { updated: false, note: null, missing: true };
    const prev = store.notes[idx];
    const next = normalizeNote({
      ...prev,
      title: patch.title != null ? patch.title : prev.title,
      body: patch.body != null ? patch.body : prev.body,
      category: patch.category != null ? patch.category : prev.category,
      tags: patch.tags != null ? patch.tags : prev.tags,
      pinned: patch.pinned != null ? Boolean(patch.pinned) : prev.pinned,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
      id: prev.id,
    });
    store.notes[idx] = next;
    saveStore(store);
    return { updated: true, note: next, missing: false };
  });
}

export function deleteNote(id) {
  return withLock(() => {
    const store = loadStore();
    const before = store.notes.length;
    store.notes = store.notes.filter((n) => n.id !== id);
    if (store.notes.length === before) {
      return { removed: false, id };
    }
    saveStore(store);
    return { removed: true, id };
  });
}
