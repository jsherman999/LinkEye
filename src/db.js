const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DB_PATH } = require("./config");
const { nowIso } = require("./time");

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
  }

  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      canonical_url TEXT NOT NULL,
      slug TEXT NOT NULL,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_checked_at TEXT,
      last_changed_at TEXT,
      last_status_code INTEGER,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      fetched_at TEXT NOT NULL,
      status_code INTEGER,
      final_url TEXT,
      content_hash TEXT NOT NULL,
      title TEXT,
      name TEXT,
      headline TEXT,
      location TEXT,
      image_url TEXT,
      raw_text TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      html_bytes INTEGER NOT NULL DEFAULT 0,
      changed INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      CHECK(length(content_hash) > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_versions_profile_fetched
      ON versions(profile_id, fetched_at DESC);
  `);
  removeLegacyVersionHashConstraint(database);
}

function removeLegacyVersionHashConstraint(database) {
  const indexes = database.prepare("PRAGMA index_list('versions')").all();
  const hasAutoUniqueHashIndex = indexes.some((index) => index.origin === "u");
  if (!hasAutoUniqueHashIndex) {
    return;
  }

  database.exec(`
    CREATE TABLE versions_without_hash_unique (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      fetched_at TEXT NOT NULL,
      status_code INTEGER,
      final_url TEXT,
      content_hash TEXT NOT NULL,
      title TEXT,
      name TEXT,
      headline TEXT,
      location TEXT,
      image_url TEXT,
      raw_text TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      html_bytes INTEGER NOT NULL DEFAULT 0,
      changed INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      CHECK(length(content_hash) > 0)
    );

    INSERT INTO versions_without_hash_unique
    SELECT * FROM versions;

    DROP TABLE versions;
    ALTER TABLE versions_without_hash_unique RENAME TO versions;

    CREATE INDEX IF NOT EXISTS idx_versions_profile_fetched
      ON versions(profile_id, fetched_at DESC);
  `);
}

function serializeProfile(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    slug: row.slug,
    label: row.label || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastChangedAt: row.last_changed_at,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    versionCount: row.version_count || 0,
  };
}

function serializeVersion(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    profileId: row.profile_id,
    fetchedAt: row.fetched_at,
    statusCode: row.status_code,
    finalUrl: row.final_url,
    contentHash: row.content_hash,
    title: row.title || "",
    name: row.name || "",
    headline: row.headline || "",
    location: row.location || "",
    imageUrl: row.image_url || "",
    rawText: row.raw_text || "",
    normalized: JSON.parse(row.normalized_json || "{}"),
    metadata: JSON.parse(row.metadata_json || "{}"),
    htmlBytes: row.html_bytes,
    changed: Boolean(row.changed),
    error: row.error,
  };
}

function createProfile({ url, canonicalUrl, slug, label = "" }) {
  const database = getDb();
  const timestamp = nowIso();
  const existing = findProfileByCanonicalUrl(canonicalUrl);

  if (existing) {
    database
      .prepare("UPDATE profiles SET label = COALESCE(NULLIF(?, ''), label), status = 'active', updated_at = ? WHERE id = ?")
      .run(label, timestamp, existing.id);
    return getProfile(existing.id);
  }

  const result = database
    .prepare(
      `INSERT INTO profiles (url, canonical_url, slug, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(url, canonicalUrl, slug, label, timestamp, timestamp);

  return getProfile(Number(result.lastInsertRowid));
}

function findProfileByCanonicalUrl(canonicalUrl) {
  return serializeProfile(
    getDb()
      .prepare(
        `SELECT profiles.*, COUNT(success_versions.id) AS version_count
         FROM profiles
         LEFT JOIN versions AS success_versions
           ON success_versions.profile_id = profiles.id
          AND success_versions.error IS NULL
         WHERE profiles.canonical_url = ?
         GROUP BY profiles.id`,
      )
      .get(canonicalUrl),
  );
}

function getProfile(id) {
  return serializeProfile(
    getDb()
      .prepare(
        `SELECT profiles.*, COUNT(success_versions.id) AS version_count
         FROM profiles
         LEFT JOIN versions AS success_versions
           ON success_versions.profile_id = profiles.id
          AND success_versions.error IS NULL
         WHERE profiles.id = ?
         GROUP BY profiles.id`,
      )
      .get(id),
  );
}

function listProfiles({ q = "" } = {}) {
  const query = `%${q.trim().toLowerCase()}%`;
  const rows = q.trim()
    ? getDb()
        .prepare(
          `SELECT profiles.*, COUNT(success_versions.id) AS version_count
           FROM profiles
           LEFT JOIN versions AS success_versions
             ON success_versions.profile_id = profiles.id
            AND success_versions.error IS NULL
           WHERE LOWER(profiles.url) LIKE ? OR LOWER(profiles.label) LIKE ? OR LOWER(profiles.slug) LIKE ?
           GROUP BY profiles.id
           ORDER BY COALESCE(profiles.last_checked_at, profiles.created_at) DESC`,
        )
        .all(query, query, query)
    : getDb()
        .prepare(
          `SELECT profiles.*, COUNT(success_versions.id) AS version_count
           FROM profiles
           LEFT JOIN versions AS success_versions
             ON success_versions.profile_id = profiles.id
            AND success_versions.error IS NULL
           GROUP BY profiles.id
           ORDER BY COALESCE(profiles.last_checked_at, profiles.created_at) DESC`,
        )
        .all();

  return rows.map(serializeProfile);
}

function updateProfileStatus(id, status) {
  const timestamp = nowIso();
  getDb().prepare("UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, id);
  return getProfile(id);
}

function deleteProfile(id) {
  getDb().prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

function getLatestVersion(profileId) {
  return serializeVersion(
    getDb()
      .prepare("SELECT * FROM versions WHERE profile_id = ? AND error IS NULL ORDER BY fetched_at DESC, id DESC LIMIT 1")
      .get(profileId),
  );
}

function getVersion(versionId) {
  return serializeVersion(getDb().prepare("SELECT * FROM versions WHERE id = ? AND error IS NULL").get(versionId));
}

function listVersions(profileId) {
  return getDb()
    .prepare("SELECT * FROM versions WHERE profile_id = ? AND error IS NULL ORDER BY fetched_at DESC, id DESC")
    .all(profileId)
    .map(serializeVersion);
}

function saveCapture(profileId, capture) {
  const database = getDb();
  const timestamp = capture.fetchedAt || nowIso();
  const previous = getLatestVersion(profileId);
  const sameAsPrevious = previous?.contentHash === capture.contentHash;
  const profileContentChanged = !sameAsPrevious && !capture.error;

  database
    .prepare(
      `UPDATE profiles
       SET last_checked_at = ?,
           last_status_code = ?,
           last_error = ?,
           last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      timestamp,
      capture.statusCode,
      capture.error || null,
      profileContentChanged ? 1 : 0,
      timestamp,
      timestamp,
      profileId,
    );

  if (capture.error) {
    return {
      inserted: false,
      version: previous,
      previous,
      error: capture.error,
      capture,
    };
  }

  if (sameAsPrevious) {
    return {
      inserted: false,
      version: previous,
      previous,
    };
  }

  const result = database
    .prepare(
      `INSERT INTO versions (
        profile_id, fetched_at, status_code, final_url, content_hash, title, name, headline,
        location, image_url, raw_text, normalized_json, metadata_json, html_bytes, changed, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      profileId,
      timestamp,
      capture.statusCode,
      capture.finalUrl,
      capture.contentHash,
      capture.title,
      capture.name,
      capture.headline,
      capture.location,
      capture.imageUrl,
      capture.rawText,
      JSON.stringify(capture.normalized),
      JSON.stringify(capture.metadata),
      capture.htmlBytes,
      1,
      capture.error || null,
    );

  return {
    inserted: true,
    version: getVersion(Number(result.lastInsertRowid)),
    previous,
  };
}

module.exports = {
  createProfile,
  deleteProfile,
  findProfileByCanonicalUrl,
  getDb,
  getLatestVersion,
  getProfile,
  getVersion,
  listProfiles,
  listVersions,
  saveCapture,
  updateProfileStatus,
};
