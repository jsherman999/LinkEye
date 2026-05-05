const {
  createProfile,
  getLatestVersion,
  getProfile,
  getVersion,
  listProfiles,
  listVersions,
  saveCapture,
} = require("./db");
const { compareVersions, fetchProfileSnapshot, normalizeLinkedInProfileUrl } = require("./archive");

function addProfile({ url, label = "" }) {
  const normalized = normalizeLinkedInProfileUrl(url);
  return createProfile({
    url: normalized.inputUrl,
    canonicalUrl: normalized.canonicalUrl,
    slug: normalized.slug,
    label,
  });
}

async function captureProfile(profileId) {
  const profile = getProfile(profileId);
  if (!profile) {
    throw new Error("Profile not found.");
  }

  const capture = await fetchProfileSnapshot(profile.canonicalUrl);
  const saved = saveCapture(profile.id, capture);

  return {
    profile: getProfile(profile.id),
    inserted: saved.inserted,
    version: saved.version,
    previous: saved.previous,
    error: saved.error || null,
    diff: saved.inserted && saved.previous && saved.version ? compareVersions(saved.previous, saved.version) : null,
  };
}

async function monitorProfiles() {
  const profiles = listProfiles().filter((profile) => profile.status === "active");
  const results = [];

  for (const profile of profiles) {
    try {
      results.push(await captureProfile(profile.id));
    } catch (error) {
      results.push({
        profile,
        inserted: false,
        version: null,
        previous: getLatestVersion(profile.id),
        error: error.message,
      });
    }
  }

  return results;
}

function compareProfileVersions(profileId, fromId, toId) {
  const versions = listVersions(profileId);
  if (versions.length < 2 && (!fromId || !toId)) {
    throw new Error("At least two archived versions are needed to compare changes.");
  }

  const toVersion = toId ? getVersion(toId) : versions[0];
  const fromVersion = fromId ? getVersion(fromId) : versions[1];

  if (!fromVersion || !toVersion || fromVersion.profileId !== Number(profileId) || toVersion.profileId !== Number(profileId)) {
    throw new Error("Version IDs do not belong to this profile.");
  }

  return compareVersions(fromVersion, toVersion);
}

module.exports = {
  addProfile,
  captureProfile,
  compareProfileVersions,
  monitorProfiles,
};
