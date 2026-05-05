const sampleUrl = "https://www.linkedin.com/in/example-profile/";

const state = {
  profiles: [],
  selectedProfileId: null,
  selectedProfile: null,
  latestVersion: null,
  versions: [],
};

const nodes = {
  addForm: document.querySelector("#add-form"),
  profileUrl: document.querySelector("#profile-url"),
  profileLabel: document.querySelector("#profile-label"),
  addButton: document.querySelector("#add-button"),
  search: document.querySelector("#search"),
  discoverForm: document.querySelector("#discover-form"),
  discoverQuery: document.querySelector("#discover-query"),
  discoverButton: document.querySelector("#discover-button"),
  discoverResults: document.querySelector("#discover-results"),
  profileCount: document.querySelector("#profile-count"),
  profiles: document.querySelector("#profiles"),
  monitorButton: document.querySelector("#monitor-button"),
  notice: document.querySelector("#notice"),
  emptyState: document.querySelector("#empty-state"),
  sampleButton: document.querySelector("#sample-button"),
  profileView: document.querySelector("#profile-view"),
  workspaceTitle: document.querySelector("#workspace-title"),
  profileImage: document.querySelector("#profile-image"),
  avatarFallback: document.querySelector("#avatar-fallback"),
  profileName: document.querySelector("#profile-name"),
  profileStatus: document.querySelector("#profile-status"),
  profileHeadline: document.querySelector("#profile-headline"),
  profileUrlLink: document.querySelector("#profile-url-link"),
  captureButton: document.querySelector("#capture-button"),
  pauseButton: document.querySelector("#pause-button"),
  deleteButton: document.querySelector("#delete-button"),
  metricVersions: document.querySelector("#metric-versions"),
  metricChecked: document.querySelector("#metric-checked"),
  metricChanged: document.querySelector("#metric-changed"),
  metricStatus: document.querySelector("#metric-status"),
  fromVersion: document.querySelector("#from-version"),
  toVersion: document.querySelector("#to-version"),
  compareButton: document.querySelector("#compare-button"),
  diffSummary: document.querySelector("#diff-summary"),
  fieldDiff: document.querySelector("#field-diff"),
  textDiff: document.querySelector("#text-diff"),
  versionCaption: document.querySelector("#version-caption"),
  versions: document.querySelector("#versions"),
};

nodes.addForm.addEventListener("submit", onAddProfile);
nodes.search.addEventListener("input", () => loadProfiles(nodes.search.value.trim()));
nodes.discoverForm.addEventListener("submit", onDiscoverProfiles);
nodes.sampleButton.addEventListener("click", () => {
  nodes.profileUrl.value = sampleUrl;
  nodes.profileLabel.value = "Example Profile";
  nodes.addForm.requestSubmit();
});
nodes.monitorButton.addEventListener("click", onRunMonitor);
nodes.captureButton.addEventListener("click", onCaptureSelected);
nodes.pauseButton.addEventListener("click", onTogglePause);
nodes.deleteButton.addEventListener("click", onDeleteSelected);
nodes.compareButton.addEventListener("click", onCompare);

initialize();

async function initialize() {
  await loadProfiles();
  if (state.profiles[0]) {
    await selectProfile(state.profiles[0].id);
  }
}

async function onAddProfile(event) {
  event.preventDefault();
  const url = nodes.profileUrl.value.trim();
  const label = nodes.profileLabel.value.trim();
  if (!url) {
    showNotice("Enter a LinkedIn profile URL.", "error");
    return;
  }

  setBusy(nodes.addButton, true, "Capturing...");
  try {
    const payload = await requestJson("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ url, label, capture: true }),
    });
    nodes.profileUrl.value = "";
    nodes.profileLabel.value = "";
    await loadProfiles(nodes.search.value.trim());
    await selectProfile(payload.profile.id);
    const stateLabel = getCaptureNotice(payload.capture);
    showNotice(stateLabel.message, stateLabel.tone);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(nodes.addButton, false, "Save and capture");
  }
}

async function onRunMonitor() {
  setBusy(nodes.monitorButton, true, "Checking...");
  try {
    const payload = await requestJson("/api/monitor/run", { method: "POST" });
    await loadProfiles(nodes.search.value.trim());
    if (state.selectedProfileId) {
      await selectProfile(state.selectedProfileId);
    }
    showNotice(`Checked ${payload.checked} profiles. ${payload.changed} new versions archived.`, "ok");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(nodes.monitorButton, false, "Run monitor");
  }
}

async function onDiscoverProfiles(event) {
  event.preventDefault();
  const q = nodes.discoverQuery.value.trim();
  if (!q) {
    showNotice("Enter a name or company to search.", "error");
    return;
  }

  setBusy(nodes.discoverButton, true, "Finding...");
  nodes.discoverResults.classList.add("hidden");
  nodes.discoverResults.replaceChildren();

  try {
    const results = await requestJson(`/api/discover?q=${encodeURIComponent(q)}`);
    renderDiscoveryResults(results);
    showNotice(results.length ? `${results.length} public candidates found.` : "No public candidates found.", "ok");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(nodes.discoverButton, false, "Find");
  }
}

async function onCaptureSelected() {
  if (!state.selectedProfileId) {
    return;
  }

  setBusy(nodes.captureButton, true, "Capturing...");
  try {
    const payload = await requestJson(`/api/profiles/${state.selectedProfileId}/capture`, { method: "POST" });
    await loadProfiles(nodes.search.value.trim());
    await selectProfile(payload.profile.id);
    const stateLabel = getCaptureNotice(payload);
    showNotice(stateLabel.message, stateLabel.tone);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(nodes.captureButton, false, "Capture now");
  }
}

async function onTogglePause() {
  const profile = state.selectedProfile;
  if (!profile) {
    return;
  }

  const nextStatus = profile.status === "active" ? "paused" : "active";
  await requestJson(`/api/profiles/${profile.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: nextStatus }),
  });
  await loadProfiles(nodes.search.value.trim());
  await selectProfile(profile.id);
}

async function onDeleteSelected() {
  const profile = state.selectedProfile;
  if (!profile) {
    return;
  }

  const confirmed = window.confirm(`Delete ${profile.label || profile.slug} and all archived versions?`);
  if (!confirmed) {
    return;
  }

  await fetch(`/api/profiles/${profile.id}`, { method: "DELETE" });
  state.selectedProfileId = null;
  state.selectedProfile = null;
  await loadProfiles(nodes.search.value.trim());
  renderEmpty();
  showNotice("Profile deleted.", "ok");
}

async function onCompare() {
  if (!state.selectedProfileId || !nodes.fromVersion.value || !nodes.toVersion.value) {
    showNotice("Choose two versions to compare.", "error");
    return;
  }

  const params = new URLSearchParams({
    from: nodes.fromVersion.value,
    to: nodes.toVersion.value,
  });
  const diff = await requestJson(`/api/profiles/${state.selectedProfileId}/diff?${params}`);
  renderDiff(diff);
}

async function loadProfiles(q = "") {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  state.profiles = await requestJson(`/api/profiles${params}`);
  renderProfiles();
}

async function selectProfile(profileId) {
  state.selectedProfileId = Number(profileId);
  const detail = await requestJson(`/api/profiles/${profileId}`);
  state.selectedProfile = detail.profile;
  state.latestVersion = detail.latestVersion;
  state.versions = await requestJson(`/api/profiles/${profileId}/versions`);
  renderProfile();

  if (state.versions.length >= 2) {
    const diff = await requestJson(`/api/profiles/${profileId}/diff`);
    renderDiff(diff);
  } else {
    renderDiff(null);
  }
}

function renderProfiles() {
  nodes.profileCount.textContent = String(state.profiles.length);
  nodes.profiles.replaceChildren();

  if (!state.profiles.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No saved profiles.";
    nodes.profiles.append(empty);
    return;
  }

  for (const profile of state.profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-row ${profile.id === state.selectedProfileId ? "selected" : ""}`;
    button.addEventListener("click", () => selectProfile(profile.id));
    button.innerHTML = `
      <span class="row-title">${escapeHtml(profile.label || profile.slug)}</span>
      <span class="row-meta">${profile.versionCount} versions · ${escapeHtml(profile.status)}</span>
    `;
    nodes.profiles.append(button);
  }
}

function renderDiscoveryResults(results) {
  nodes.discoverResults.replaceChildren();
  nodes.discoverResults.classList.remove("hidden");

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No public candidates found.";
    nodes.discoverResults.append(empty);
    return;
  }

  for (const result of results) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "discover-row";
    row.addEventListener("click", () => {
      nodes.profileUrl.value = result.url;
      nodes.profileLabel.value = result.title;
      nodes.profileUrl.focus();
    });
    row.innerHTML = `
      <span>${escapeHtml(result.title || result.slug)}</span>
      <small>${escapeHtml(result.url)}</small>
    `;
    nodes.discoverResults.append(row);
  }
}

function renderEmpty() {
  nodes.emptyState.classList.remove("hidden");
  nodes.profileView.classList.add("hidden");
  nodes.workspaceTitle.textContent = "Archive";
}

function renderProfile() {
  const profile = state.selectedProfile;
  const latest = state.latestVersion || {};
  const latestUnavailable = isUnavailableVersion(latest);
  const displayName = latestUnavailable ? profile.label || profile.slug : latest.name || profile.label || profile.slug;
  const displayHeadline = latestUnavailable
    ? "Public profile content was not available during the latest capture."
    : latest.headline || latest.title || profile.canonicalUrl;
  nodes.emptyState.classList.add("hidden");
  nodes.profileView.classList.remove("hidden");
  nodes.workspaceTitle.textContent = displayName;

  nodes.profileName.textContent = displayName;
  nodes.profileStatus.textContent = profile.status;
  nodes.profileStatus.className = `status-pill ${profile.status}`;
  nodes.profileHeadline.textContent = displayHeadline;
  nodes.profileUrlLink.href = profile.canonicalUrl;
  nodes.profileUrlLink.textContent = profile.canonicalUrl;
  nodes.pauseButton.textContent = profile.status === "active" ? "Pause" : "Resume";

  if (!latestUnavailable && latest.imageUrl) {
    nodes.profileImage.src = latest.imageUrl;
    nodes.profileImage.classList.remove("hidden");
    nodes.avatarFallback.classList.add("hidden");
  } else {
    nodes.profileImage.classList.add("hidden");
    nodes.avatarFallback.classList.remove("hidden");
    nodes.avatarFallback.textContent = initials(latest.name || profile.label || profile.slug);
  }

  nodes.metricVersions.textContent = String(state.versions.length);
  nodes.metricChecked.textContent = formatDate(profile.lastCheckedAt);
  nodes.metricChanged.textContent = formatDate(getLastSuccessfulChangeAt());
  nodes.metricStatus.textContent = getCaptureStatusLabel(latest, profile);
  nodes.metricStatus.closest("article").classList.toggle("warning-metric", latestUnavailable || Boolean(profile.lastError));
  nodes.versionCaption.textContent = state.versions.length
    ? `${state.versions.length} archived capture${state.versions.length === 1 ? "" : "s"}`
    : "No captures yet";

  renderVersionSelectors();
  renderVersions();
  renderProfiles();
}

function renderVersionSelectors() {
  nodes.fromVersion.replaceChildren();
  nodes.toVersion.replaceChildren();

  for (const version of state.versions) {
    const label = `#${version.id} · ${formatDate(version.fetchedAt)} · ${version.statusCode || "no status"}`;
    nodes.fromVersion.append(new Option(label, version.id));
    nodes.toVersion.append(new Option(label, version.id));
  }

  if (state.versions[1]) {
    nodes.fromVersion.value = state.versions[1].id;
  }
  if (state.versions[0]) {
    nodes.toVersion.value = state.versions[0].id;
  }
}

function renderVersions() {
  nodes.versions.replaceChildren();
  if (!state.versions.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No versions archived yet.";
    nodes.versions.append(empty);
    return;
  }

  for (const version of state.versions) {
    const unavailable = isUnavailableVersion(version);
    const article = document.createElement("article");
    article.className = `version-row ${unavailable ? "unavailable" : ""}`;
    article.innerHTML = `
      <div>
        <strong>#${version.id}</strong>
        <span>${escapeHtml(formatDate(version.fetchedAt))}</span>
      </div>
      <p>${escapeHtml(getVersionSummary(version))}</p>
      <span class="http-pill ${unavailable ? "unavailable" : ""}">${escapeHtml(getVersionBadge(version))}</span>
    `;
    nodes.versions.append(article);
  }
}

function renderDiff(diff) {
  nodes.diffSummary.replaceChildren();
  nodes.fieldDiff.replaceChildren();
  nodes.textDiff.replaceChildren();

  if (!diff) {
    nodes.diffSummary.textContent = "Archive two versions to enable comparison.";
    return;
  }

  nodes.diffSummary.textContent = `${diff.summary.changedFields} fields changed, ${diff.summary.added} additions, ${diff.summary.removed} removals.`;

  for (const change of diff.fieldChanges) {
    const article = document.createElement("article");
    article.className = "field-change";
    article.innerHTML = `
      <strong>${escapeHtml(change.field)}</strong>
      <p><span>-</span>${escapeHtml(change.before || "(blank)")}</p>
      <p><span>+</span>${escapeHtml(change.after || "(blank)")}</p>
    `;
    nodes.fieldDiff.append(article);
  }

  for (const part of diff.textDiff) {
    const div = document.createElement("div");
    div.className = `diff-line ${part.type}`;
    div.textContent = part.type === "added" ? `+ ${part.text}` : part.type === "removed" ? `- ${part.text}` : part.text;
    nodes.textDiff.append(div);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function showNotice(message, tone = "ok") {
  nodes.notice.textContent = message;
  nodes.notice.className = `notice ${tone}`;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => {
    nodes.notice.classList.add("hidden");
  }, 5200);
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isUnavailableVersion(version) {
  return Boolean(
    version?.error ||
      version?.normalized?.captureState === "unavailable" ||
      (Number(version?.statusCode) >= 400 && Number(version?.statusCode) < 600),
  );
}

function getCaptureStatusLabel(version, profile) {
  if (profile.lastError) {
    const status = profile.lastStatusCode ? `HTTP ${profile.lastStatusCode}` : "no status";
    return `Last check failed (${status})`;
  }

  if (!version?.id) {
    return "Ready";
  }

  return version.statusCode ? `Captured (HTTP ${version.statusCode})` : "Captured";
}

function getCaptureNotice(capture) {
  if (capture?.error) {
    return {
      message: `Capture failed: ${capture.error}. Keeping the last successful version.`,
      tone: "warn",
    };
  }

  return {
    message: capture?.inserted ? "New version archived." : "Profile unchanged.",
    tone: "ok",
  };
}

function getVersionSummary(version) {
  if (isUnavailableVersion(version)) {
    return "Public profile content unavailable during capture";
  }

  return version.title || version.name || version.contentHash.slice(0, 16);
}

function getVersionBadge(version) {
  if (!version?.statusCode) {
    return "no status";
  }

  return `HTTP ${version.statusCode}`;
}

function getLastSuccessfulChangeAt() {
  const successful = state.versions.find((version) => !isUnavailableVersion(version));
  return successful?.fetchedAt || null;
}

function initials(value) {
  return String(value || "LE")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
