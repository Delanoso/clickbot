const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const incidentsDot = document.getElementById("incidentsDot");
const incidentsState = document.getElementById("incidentsState");
const incidentsMessage = document.getElementById("incidentsMessage");
const depotSummary = document.getElementById("depotSummary");
const jhbSummary = document.getElementById("jhbSummary");
const inDepotCount = document.getElementById("inDepotCount");
const inJhbCount = document.getElementById("inJhbCount");
const inDepotList = document.getElementById("inDepotList");
const inJhbList = document.getElementById("inJhbList");
const allTruckList = document.getElementById("allTruckList");
const watchedMeta = document.getElementById("watchedMeta");
const watchList = document.getElementById("watchList");
const truckCount = document.getElementById("truckCount");
const truckFormNote = document.getElementById("truckFormNote");
const addTruckForm = document.getElementById("addTruckForm");
const truckInput = document.getElementById("truckInput");
const watchSearchInput = document.getElementById("watchSearchInput");
const watchSearchClear = document.getElementById("watchSearchClear");
const watchSearchNote = document.getElementById("watchSearchNote");
const coverageNote = document.getElementById("coverageNote");
const logView = document.getElementById("logView");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const exportBtn = document.getElementById("exportBtn");

let refreshGeneration = 0;
const removingTrucks = new Set();
const commentTimers = new Map();
let latestConfiguredTrucks = [];
let latestLiveRows = [];
let latestIncidents = null;

startBtn.addEventListener("click", () => controlTask("start"));
stopBtn.addEventListener("click", () => controlTask("stop"));

exportBtn.addEventListener("click", (event) => {
  // Keep default navigation to download endpoint; refresh timestamp in filename via cache-buster.
  exportBtn.href = `/api/incidents/export?t=${Date.now()}`;
});

watchList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove]");
  if (!btn || !watchList.contains(btn)) return;
  event.preventDefault();
  void removeTruck(btn.getAttribute("data-remove"));
});

watchList.addEventListener("input", (event) => {
  const field = event.target.closest("[data-comment]");
  if (!field || !watchList.contains(field)) return;
  const truck = field.getAttribute("data-comment");
  const value = field.value;
  const existing = latestConfiguredTrucks.find((t) => t.id === truck);
  if (existing) existing.comment = value;

  if (commentTimers.has(truck)) clearTimeout(commentTimers.get(truck));
  commentTimers.set(
    truck,
    setTimeout(() => {
      void saveComment(truck, value);
    }, 500)
  );
});

watchList.addEventListener("change", (event) => {
  const field = event.target.closest("[data-comment]");
  if (!field || !watchList.contains(field)) return;
  const truck = field.getAttribute("data-comment");
  if (commentTimers.has(truck)) {
    clearTimeout(commentTimers.get(truck));
    commentTimers.delete(truck);
  }
  void saveComment(truck, field.value);
});

watchSearchInput.addEventListener("input", () => {
  renderFromCache();
});

watchSearchClear.addEventListener("click", () => {
  watchSearchInput.value = "";
  watchSearchInput.focus();
  renderFromCache();
});

addTruckForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const truck = truckInput.value.trim();
  if (!truck) return;

  const submitBtn = addTruckForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  truckInput.disabled = true;
  truckFormNote.textContent = "Saving truck…";

  try {
    const res = await fetch("/api/incidents/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ truck }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not add truck (${res.status})`);
    truckInput.value = "";
    if (data.added) {
      truckFormNote.textContent = data.lookupPending
        ? `Added ${data.truck}. Looking up driver on Webfleet…`
        : `Added ${data.truck}${data.driver ? ` · ${data.driver}` : ""}`;
    } else if (data.updated) {
      truckFormNote.textContent = `Updated ${data.truck}${data.driver ? ` · ${data.driver}` : ""}`;
    } else {
      truckFormNote.textContent = data.lookupPending
        ? `${data.truck} is already on the list. Refreshing driver from Webfleet…`
        : `${data.truck} is already on the list`;
    }
    if (data.restarted) truckFormNote.textContent += " · monitor restarting";
    await refresh({ force: true });
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    truckInput.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    truckInput.focus();
  }
});

async function saveComment(truck, comment) {
  try {
    const res = await fetch(`/api/incidents/trucks/${encodeURIComponent(truck)}/comment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: String(comment || "") }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not save comment (${res.status})`);
    const entry = latestConfiguredTrucks.find((t) => t.id === truck);
    if (entry) entry.comment = data.comment || "";
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  }
}

async function removeTruck(truck) {
  const id = String(truck || "").trim();
  if (!id) return;
  const key = id.toUpperCase();
  if (removingTrucks.has(key)) return;
  removingTrucks.add(key);

  refreshGeneration += 1;
  latestConfiguredTrucks = latestConfiguredTrucks.filter((t) => t.id !== key);
  renderFromCache();
  truckFormNote.textContent = `Removing ${key}…`;

  try {
    const res = await fetch(`/api/incidents/trucks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not remove truck (${res.status})`);
    truckFormNote.textContent = data.removed
      ? `Removed ${key}${data.restarted ? " · monitor restarting" : ""}`
      : `${key} was not on the list`;
    await refresh({ force: true });
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
    await refresh({ force: true });
  } finally {
    removingTrucks.delete(key);
  }
}

async function controlTask(action) {
  startBtn.disabled = true;
  stopBtn.disabled = true;
  try {
    const res = await fetch(`/api/tasks/incidents-monitor/${action}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not ${action} monitor`);
    await refresh({ force: true });
  } catch (error) {
    incidentsMessage.textContent = error.message || String(error);
  } finally {
    startBtn.disabled = false;
    stopBtn.disabled = false;
  }
}

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zoneLabel(zone) {
  if (zone === "depot") return "In depot";
  if (zone === "johannesburg") return "In Johannesburg";
  return "Other";
}

function renderTask(task) {
  const state = task?.status?.state || (task?.running ? "running" : "idle");
  incidentsState.textContent = state;
  incidentsDot.className = `status-dot ${state}`;
  incidentsMessage.textContent =
    task?.status?.message || (task?.running ? "Running" : "Idle");
}

function matchesSearch(entry, live, query) {
  if (!query) return true;
  const hay = [
    entry?.id,
    entry?.driver,
    entry?.comment,
    live?.locationText,
    live?.zone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query);
}

function renderZoneList(el, rows, emptyMessage) {
  if (!rows.length) {
    el.innerHTML = `<p class="empty-note">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  el.innerHTML = rows
    .map((row) => {
      const driver = row.driver ? escapeHtml(row.driver) : "No driver yet";
      const comment = row.comment ? escapeHtml(row.comment) : "";
      return `<div class="truck-row">
        <strong>${escapeHtml(row.truckNumber)}</strong>
        <span>${driver}${comment ? ` · ${comment}` : ""}<br />${escapeHtml(row.locationText || "—")}</span>
      </div>`;
    })
    .join("");
}

function renderLive(incidents, configuredTrucks) {
  const query = watchSearchInput.value.trim().toLowerCase();
  watchSearchClear.hidden = !query;

  const byId = new Map(configuredTrucks.map((t) => [t.id, t]));

  if (!incidents) {
    depotSummary.textContent = "Start the monitor to populate live locations.";
    jhbSummary.textContent = "Start the monitor to populate Johannesburg matches.";
    inDepotCount.textContent = "0";
    inJhbCount.textContent = "0";
    inDepotList.innerHTML = `<p class="empty-note">No live data yet.</p>`;
    inJhbList.innerHTML = `<p class="empty-note">No live data yet.</p>`;
    allTruckList.innerHTML = "";
    watchedMeta.textContent = "";
    return;
  }

  const enrich = (row) => {
    const cfg = byId.get(String(row.truckNumber || "").toUpperCase()) || {};
    return {
      ...row,
      driver: cfg.driver || "",
      comment: cfg.comment || "",
    };
  };

  const inDepot = (incidents.inDepot || [])
    .map(enrich)
    .filter((row) => matchesSearch(byId.get(row.truckNumber) || { id: row.truckNumber }, row, query));
  const inJhb = (incidents.inJohannesburg || [])
    .map(enrich)
    .filter((row) => matchesSearch(byId.get(row.truckNumber) || { id: row.truckNumber }, row, query));
  const trucks = (incidents.trucks || [])
    .map(enrich)
    .filter((row) => matchesSearch(byId.get(row.truckNumber) || { id: row.truckNumber }, row, query));

  inDepotCount.textContent = String(inDepot.length);
  inJhbCount.textContent = String(inJhb.length);
  depotSummary.textContent =
    incidents.message || `Cycle ${incidents.cycle || 0} · updated ${formatTime(incidents.updatedAt)}`;
  jhbSummary.textContent = query
    ? `Showing ${inJhb.length} Johannesburg match(es) for this search`
    : "CoJ suburbs, areas, and postal codes";

  watchedMeta.textContent = query
    ? `Showing ${trucks.length} of ${incidents.trucks?.length || configuredTrucks.length} locations`
    : `${incidents.trucks?.length || configuredTrucks.length} trucks watched`;

  renderZoneList(
    inDepotList,
    inDepot,
    query ? "No in-depot trucks match this search." : "No watched trucks currently in the depot."
  );
  renderZoneList(
    inJhbList,
    inJhb,
    query
      ? "No Johannesburg trucks match this search."
      : "No watched trucks currently in Johannesburg."
  );

  if (!trucks.length) {
    allTruckList.innerHTML = `<p class="empty-note">${
      query ? "No locations match this search." : "No location rows yet."
    }</p>`;
  } else {
    allTruckList.innerHTML = trucks
      .map((row) => {
        const zone = row.zone || (row.inDepot ? "depot" : row.inJohannesburg ? "johannesburg" : "other");
        const cls =
          zone === "depot" ? "in" : zone === "johannesburg" ? "jhb" : "";
        const driver = row.driver ? escapeHtml(row.driver) : "No driver";
        const comment = row.comment ? ` · ${escapeHtml(row.comment)}` : "";
        return `<div class="truck-chip ${cls}">
          <strong>${escapeHtml(row.truckNumber)}</strong>
          <span>${zoneLabel(zone)} · ${driver}${comment}<br />${escapeHtml(row.locationText || "—")}</span>
        </div>`;
      })
      .join("");
  }
}

function renderWatchList(configuredTrucks, liveRows) {
  const query = watchSearchInput.value.trim().toLowerCase();
  const liveById = new Map(
    (liveRows || []).map((row) => [String(row.truckNumber || "").toUpperCase(), row])
  );

  const filtered = configuredTrucks.filter((entry) =>
    matchesSearch(entry, liveById.get(entry.id), query)
  );

  truckCount.textContent = `${configuredTrucks.length} truck${configuredTrucks.length === 1 ? "" : "s"}`;
  watchSearchNote.textContent = query
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
    : "";

  if (!filtered.length) {
    watchList.innerHTML = `<p class="empty-note">${
      query ? "No trucks match this search." : "No trucks on the watch list yet."
    }</p>`;
    return;
  }

  watchList.innerHTML = filtered
    .map((entry) => {
      const live = liveById.get(entry.id);
      const zone = live?.zone || (live?.inDepot ? "depot" : live?.inJohannesburg ? "johannesburg" : "");
      const cls =
        zone === "depot" ? "in" : zone === "johannesburg" ? "jhb" : "";
      const metaParts = [];
      if (entry.driver) metaParts.push(escapeHtml(entry.driver));
      if (live?.locationText) {
        metaParts.push(
          zone === "depot"
            ? `In depot · ${escapeHtml(live.locationText)}`
            : zone === "johannesburg"
              ? `In JHB · ${escapeHtml(live.locationText)}`
              : escapeHtml(live.locationText)
        );
      } else if (!entry.driver) {
        metaParts.push("Driver lookup pending / not found");
      }
      return `<div class="watch-row watch-row-incidents ${cls}">
        <div class="watch-main">
          <strong>${escapeHtml(entry.id)}</strong>
          <span>${metaParts.join(" · ") || "—"}</span>
          <label class="comment-label" for="comment-${escapeHtml(entry.id)}">Comment</label>
          <input
            id="comment-${escapeHtml(entry.id)}"
            class="comment-input"
            type="text"
            data-comment="${escapeHtml(entry.id)}"
            value="${escapeHtml(entry.comment || "")}"
            placeholder="Add a note next to this driver…"
            autocomplete="off"
          />
        </div>
        <button type="button" class="btn danger-btn" data-remove="${escapeHtml(entry.id)}">Remove</button>
      </div>`;
    })
    .join("");
}

function renderFromCache() {
  renderLive(latestIncidents, latestConfiguredTrucks);
  renderWatchList(latestConfiguredTrucks, latestLiveRows);
}

async function refreshLogs() {
  try {
    const res = await fetch("/api/tasks/incidents-monitor/logs?tail=120");
    const data = await res.json();
    const lines = data.lines || [];
    logView.textContent = lines.length ? lines.join("\n") : "No log lines yet.";
  } catch {
    /* ignore */
  }
}

async function refresh({ force = false } = {}) {
  const gen = force ? ++refreshGeneration : refreshGeneration;
  const [healthRes, incidentsRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/incidents"),
  ]);
  if (gen !== refreshGeneration) return;

  const health = await healthRes.json();
  const payload = await incidentsRes.json();
  const ip = health.addresses?.[0] || "127.0.0.1";
  const location = window.location;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/incidents-drivers`;
  clockLine.textContent = new Date().toLocaleString();

  latestConfiguredTrucks = payload.trucks || [];
  latestIncidents = payload.incidents || null;
  latestLiveRows = payload.incidents?.trucks || [];

  if (payload.johannesburg) {
    coverageNote.textContent = `Latest monitor lines · CoJ coverage: ${payload.johannesburg.suburbCount} suburbs, ${payload.johannesburg.postalCodeCount} postal codes.`;
  }

  renderTask(payload.task);
  renderFromCache();
  await refreshLogs();
}

setInterval(() => {
  clockLine.textContent = new Date().toLocaleString();
}, 1000);

setInterval(() => {
  void refresh();
}, 4000);

void refresh({ force: true });
