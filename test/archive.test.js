const test = require("node:test");
const assert = require("node:assert/strict");

process.env.LINKEYE_DB_PATH = "./data/test-linkeye.sqlite";

const {
  buildCaptureFromHtml,
  compareVersions,
  detectFailureKind,
  diffText,
  getHttpError,
  normalizeLinkedInProfileUrl,
  shouldRetryCapture,
  splitForDiff,
} = require("../src/archive");
const { parseDiscoveryHtml } = require("../src/discovery");

test("normalizeLinkedInProfileUrl canonicalizes public profile URLs", () => {
  assert.deepEqual(normalizeLinkedInProfileUrl("linkedin.com/in/example-profile/?trk=public"), {
    inputUrl: "linkedin.com/in/example-profile/?trk=public",
    canonicalUrl: "https://www.linkedin.com/in/example-profile/",
    slug: "example-profile",
  });
});

test("normalizeLinkedInProfileUrl rejects non-profile LinkedIn URLs", () => {
  assert.throws(() => normalizeLinkedInProfileUrl("https://www.linkedin.com/company/openai/"), /public LinkedIn profile/);
});

test("buildCaptureFromHtml extracts metadata and readable text", () => {
  const capture = buildCaptureFromHtml({
    requestedUrl: "https://www.linkedin.com/in/example/",
    finalUrl: "https://www.linkedin.com/in/example/",
    statusCode: 200,
    contentType: "text/html",
    fetchedAt: "2026-05-05T12:00:00.000Z",
    html: `
      <html>
        <head>
          <title>Jane Example | LinkedIn</title>
          <meta property="og:description" content="Principal Builder at Example Co" />
          <meta property="og:image" content="https://cdn.example/image.jpg" />
        </head>
        <body>
          <h1>Jane Example</h1>
          <p>Principal Builder</p>
          <script>ignored()</script>
        </body>
      </html>
    `,
  });

  assert.equal(capture.name, "Jane Example");
  assert.equal(capture.headline, "Principal Builder at Example Co");
  assert.equal(capture.imageUrl, "https://cdn.example/image.jpg");
  assert.match(capture.rawText, /Principal Builder/);
  assert.equal(capture.error, null);
});

test("buildCaptureFromHtml does not treat non-2xx LinkedIn pages as profile content", () => {
  const capture = buildCaptureFromHtml({
    requestedUrl: "https://www.linkedin.com/in/example/",
    finalUrl: "https://www.linkedin.com/in/example/",
    statusCode: 404,
    contentType: "text/html",
    fetchedAt: "2026-05-05T12:00:00.000Z",
    error: "HTTP 404 Not Found",
    html: `
      <html>
        <head>
          <title>LinkedIn</title>
          <meta property="og:description" content="LinkedIn" />
        </head>
        <body><h1>Page not found</h1></body>
      </html>
    `,
  });

  assert.equal(capture.normalized.captureState, "unavailable");
  assert.equal(capture.name, "");
  assert.equal(capture.headline, "");
  assert.equal(capture.title, "");
  assert.equal(capture.error, "HTTP 404 Not Found");
});

test("diffText marks additions and removals with compact context", () => {
  const diff = diffText("A\nB\nC\nD", "A\nB updated\nC\nE");
  assert.deepEqual(
    diff.filter((part) => part.type !== "unchanged"),
    [
      { type: "removed", text: "B" },
      { type: "added", text: "B updated" },
      { type: "removed", text: "D" },
      { type: "added", text: "E" },
    ],
  );
});

test("splitForDiff falls back to sentence chunks", () => {
  assert.deepEqual(splitForDiff("One sentence. Second sentence."), ["One sentence.", "Second sentence."]);
});

test("compareVersions summarizes field and text changes", () => {
  const diff = compareVersions(
    {
      id: 1,
      fetchedAt: "2026-05-04T12:00:00.000Z",
      contentHash: "a",
      name: "Jane Example",
      headline: "Engineer",
      location: "",
      title: "Jane Example",
      statusCode: 200,
      rawText: "Engineer\nOld role",
    },
    {
      id: 2,
      fetchedAt: "2026-05-05T12:00:00.000Z",
      contentHash: "b",
      name: "Jane Example",
      headline: "Principal Engineer",
      location: "",
      title: "Jane Example",
      statusCode: 200,
      rawText: "Principal Engineer\nNew role",
    },
  );

  assert.equal(diff.summary.changedFields, 1);
  assert.equal(diff.summary.added, 2);
  assert.equal(diff.summary.removed, 2);
});

test("parseDiscoveryHtml extracts LinkedIn profile candidates from DuckDuckGo links", () => {
  const results = parseDiscoveryHtml(`
    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fexample-profile%2F&rut=abc">
      Example Profile | LinkedIn
    </a>
    <a href="https://www.linkedin.com/company/example/">Company</a>
  `);

  assert.deepEqual(results, [
    {
      url: "https://www.linkedin.com/in/example-profile/",
      slug: "example-profile",
      title: "Example Profile",
    },
  ]);
});

test("shouldRetryCapture retries intermittent LinkedIn unavailable statuses", () => {
  assert.equal(shouldRetryCapture({ error: "HTTP 404 Not Found", statusCode: 404 }, 1, 3), true);
  assert.equal(shouldRetryCapture({ error: "HTTP 999", statusCode: 999 }, 2, 3), true);
  assert.equal(
    shouldRetryCapture(
      { error: "LinkedIn authwall blocked public fetch (HTTP 999)", statusCode: 999, metadata: { failureKind: "linkedin_authwall" } },
      1,
      3,
    ),
    false,
  );
  assert.equal(shouldRetryCapture({ error: "HTTP 404 Not Found", statusCode: 404 }, 3, 3), false);
  assert.equal(shouldRetryCapture({ error: null, statusCode: 200 }, 1, 3), false);
});

test("detectFailureKind recognizes LinkedIn authwall 999 responses", () => {
  const html = `<html><script>window.location.href = "https://www.linkedin.com/authwall?sessionRedirect=x"</script></html>`;
  assert.equal(detectFailureKind(999, html, null), "linkedin_authwall");
  assert.equal(
    getHttpError(
      {
        ok: false,
        status: 999,
        statusText: "<none>",
      },
      html,
    ),
    "LinkedIn authwall blocked public fetch (HTTP 999)",
  );
});
