const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const testDb = path.join(__dirname, "..", "data", "api-test.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  try {
    fs.unlinkSync(`${testDb}${suffix}`);
  } catch {
    // Database file does not exist yet.
  }
}

process.env.LINKEYE_DB_PATH = testDb;

const app = require("../src/server");

test("API creates saved profiles without an immediate capture", async () => {
  const server = app.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const createResponse = await fetch(`${baseUrl}/api/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: "https://www.linkedin.com/in/example-profile/",
        label: "Example Profile",
        capture: false,
      }),
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.profile.slug, "example-profile");
    assert.equal(created.capture, null);

    const listResponse = await fetch(`${baseUrl}/api/profiles?q=example`);
    const profiles = await listResponse.json();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].label, "Example Profile");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
