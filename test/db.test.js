const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDb = path.join(__dirname, "..", "data", "db-test.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  try {
    fs.unlinkSync(`${testDb}${suffix}`);
  } catch {
    // Database file does not exist yet.
  }
}

process.env.LINKEYE_DB_PATH = testDb;

const { createProfile, getLatestVersion, getProfile, listVersions, saveCapture } = require("../src/db");

test("failed captures update check metadata without becoming profile versions", () => {
  const profile = createProfile({
    url: "https://www.linkedin.com/in/example/",
    canonicalUrl: "https://www.linkedin.com/in/example/",
    slug: "example",
    label: "Example Person",
  });

  const successfulCapture = {
    fetchedAt: "2026-05-05T12:00:00.000Z",
    statusCode: 200,
    finalUrl: profile.canonicalUrl,
    contentHash: "success-1",
    title: "Example Person | LinkedIn",
    name: "Example Person",
    headline: "Builder",
    location: "Minneapolis",
    imageUrl: "",
    rawText: "Example Person\nBuilder",
    normalized: { captureState: "ok", text: "Example Person\nBuilder" },
    metadata: {},
    htmlBytes: 1000,
    error: null,
  };

  const success = saveCapture(profile.id, successfulCapture);
  assert.equal(success.inserted, true);
  assert.equal(getProfile(profile.id).versionCount, 1);

  const failure = saveCapture(profile.id, {
    ...successfulCapture,
    fetchedAt: "2026-05-05T12:05:00.000Z",
    statusCode: 999,
    contentHash: "failed-1",
    title: "",
    name: "",
    headline: "",
    location: "",
    rawText: "",
    normalized: { captureState: "unavailable", text: "" },
    htmlBytes: 500,
    error: "HTTP 999",
  });

  assert.equal(failure.inserted, false);
  assert.equal(failure.error, "HTTP 999");
  assert.equal(getProfile(profile.id).versionCount, 1);
  assert.equal(listVersions(profile.id).length, 1);
  assert.equal(getLatestVersion(profile.id).id, success.version.id);
  assert.equal(getProfile(profile.id).lastError, "HTTP 999");
});
