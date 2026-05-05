const path = require("node:path");
const express = require("express");
const { HOST, PORT, ROOT_DIR } = require("./config");
const {
  deleteProfile,
  getProfile,
  getVersion,
  listProfiles,
  listVersions,
  updateProfileStatus,
} = require("./db");
const { normalizeLinkedInProfileUrl } = require("./archive");
const { discoverPublicProfiles } = require("./discovery");
const { addProfile, captureProfile, compareProfileVersions, monitorProfiles } = require("./profiles");

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(ROOT_DIR, "public", "index.html"));
});

app.use(
  express.static(path.join(ROOT_DIR, "public"), {
    index: false,
    setHeaders(res) {
      res.set("Cache-Control", "no-store");
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "LinkEye",
  });
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  const profiles = listProfiles({ q });
  let candidate = null;

  try {
    candidate = q ? normalizeLinkedInProfileUrl(q) : null;
  } catch {
    candidate = null;
  }

  res.json({
    q,
    profiles,
    candidate,
  });
});

app.get("/api/discover", async (req, res) => {
  try {
    res.json(await discoverPublicProfiles(String(req.query.q || "")));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/profiles", (req, res) => {
  res.json(listProfiles({ q: String(req.query.q || "") }));
});

app.post("/api/profiles", async (req, res) => {
  try {
    const profile = addProfile({
      url: req.body?.url,
      label: String(req.body?.label || "").trim(),
    });

    let capture = null;
    if (req.body?.capture !== false) {
      capture = await captureProfile(profile.id);
    }

    res.status(201).json({
      profile: getProfile(profile.id),
      capture,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/profiles/:id", (req, res) => {
  const profile = getProfile(Number(req.params.id));
  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  res.json({
    profile,
    latestVersion: listVersions(profile.id)[0] || null,
  });
});

app.patch("/api/profiles/:id", (req, res) => {
  const profile = getProfile(Number(req.params.id));
  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  const status = String(req.body?.status || "").trim();
  if (!["active", "paused"].includes(status)) {
    res.status(400).json({ error: "Status must be active or paused." });
    return;
  }

  res.json(updateProfileStatus(profile.id, status));
});

app.delete("/api/profiles/:id", (req, res) => {
  const profile = getProfile(Number(req.params.id));
  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  deleteProfile(profile.id);
  res.status(204).end();
});

app.post("/api/profiles/:id/capture", async (req, res) => {
  try {
    const result = await captureProfile(Number(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get("/api/profiles/:id/versions", (req, res) => {
  const profile = getProfile(Number(req.params.id));
  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  res.json(listVersions(profile.id));
});

app.get("/api/profiles/:id/versions/:versionId", (req, res) => {
  const version = getVersion(Number(req.params.versionId));
  if (!version || version.profileId !== Number(req.params.id)) {
    res.status(404).json({ error: "Version not found." });
    return;
  }

  res.json(version);
});

app.get("/api/profiles/:id/diff", (req, res) => {
  try {
    res.json(
      compareProfileVersions(
        Number(req.params.id),
        req.query.from ? Number(req.query.from) : null,
        req.query.to ? Number(req.query.to) : null,
      ),
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/monitor/run", async (_req, res) => {
  const results = await monitorProfiles();
  res.json({
    checked: results.length,
    changed: results.filter((result) => result.inserted).length,
    results,
  });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`LinkEye running at http://${HOST}:${PORT}`);
  });
}

module.exports = app;
