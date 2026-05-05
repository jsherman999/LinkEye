const { createHash } = require("node:crypto");
const cheerio = require("cheerio");
const { USER_AGENT } = require("./config");
const { nowIso } = require("./time");

const LINKEDIN_PROFILE_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

function normalizeLinkedInProfileUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("Profile URL is required.");
  }

  const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  let parsed;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid LinkedIn profile URL.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^([a-z]{2}\.)linkedin\.com$/, "www.linkedin.com");
  if (!LINKEDIN_PROFILE_HOSTS.has(hostname)) {
    throw new Error("Only linkedin.com public profile URLs are supported.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "in" || !parts[1]) {
    throw new Error("Use a public LinkedIn profile URL shaped like https://www.linkedin.com/in/name/.");
  }

  const slug = decodeURIComponent(parts[1]).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    throw new Error("LinkedIn profile slug contains unsupported characters.");
  }

  const canonicalUrl = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;

  return {
    inputUrl: raw,
    canonicalUrl,
    slug,
  };
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function fetchProfileSnapshot(url, options = {}) {
  const normalized = normalizeLinkedInProfileUrl(url);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let latestCapture = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latestCapture = await fetchProfileSnapshotOnce(normalized, options);
    latestCapture.metadata = {
      ...latestCapture.metadata,
      attempt,
      maxAttempts,
    };

    if (!shouldRetryCapture(latestCapture, attempt, maxAttempts)) {
      return latestCapture;
    }

    await delay(350 * attempt);
  }

  return latestCapture;
}

async function fetchProfileSnapshotOnce(normalized, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);

  try {
    const response = await fetch(normalized.canonicalUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": options.userAgent || USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const html = await response.text();
    const responseError = getHttpError(response, html);
    return buildCaptureFromHtml({
      html,
      requestedUrl: normalized.canonicalUrl,
      finalUrl: response.url || normalized.canonicalUrl,
      statusCode: response.status,
      contentType: response.headers.get("content-type") || "",
      fetchedAt: nowIso(),
      error: responseError,
    });
  } catch (error) {
    return buildFailureCapture({
      requestedUrl: normalized.canonicalUrl,
      fetchedAt: nowIso(),
      error: error.name === "AbortError" ? "Request timed out." : error.message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryCapture(capture, attempt, maxAttempts) {
  if (attempt >= maxAttempts || !capture?.error) {
    return false;
  }

  if (capture.metadata?.failureKind === "linkedin_authwall") {
    return false;
  }

  return [0, 404, 408, 409, 425, 429, 500, 502, 503, 504, 999].includes(Number(capture.statusCode || 0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFailureCapture({ requestedUrl, fetchedAt, error }) {
  const normalized = {
    captureState: "unavailable",
    title: "",
    name: "",
    headline: "",
    location: "",
    text: "",
    fetchError: error,
  };

  return {
    fetchedAt,
    statusCode: null,
    finalUrl: requestedUrl,
    title: "",
    name: "",
    headline: "",
    location: "",
    imageUrl: "",
    rawText: "",
    normalized,
    metadata: {
      requestedUrl,
      fetchError: error,
    },
    htmlBytes: 0,
    contentHash: hashObject(normalized),
    error,
  };
}

function buildCaptureFromHtml({ html, requestedUrl, finalUrl, statusCode, contentType, fetchedAt, error = null }) {
  const $ = cheerio.load(html || "");
  const metadata = extractMetadata($);
  const rawText = extractReadableText($);
  const unavailable = Boolean(error) || statusCode < 200 || statusCode >= 300;
  const failureKind = detectFailureKind(statusCode, html, error);
  const title = firstTruthy(metadata.ogTitle, metadata.twitterTitle, $("title").first().text());
  const description = firstTruthy(metadata.ogDescription, metadata.twitterDescription, metaContent($, "description"));
  const name = extractName(title, metadata.profileFirstName, metadata.profileLastName);
  const headline = description.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
  const imageUrl = firstTruthy(metadata.ogImage, metadata.twitterImage);
  const location = extractLikelyLocation(rawText);

  const normalized = {
    captureState: unavailable ? "unavailable" : "ok",
    title: unavailable ? "" : cleanText(title),
    name: unavailable ? "" : cleanText(name),
    headline: unavailable ? "" : cleanText(headline),
    location: unavailable ? "" : cleanText(location),
    text: rawText,
    statusCode,
  };

  return {
    fetchedAt,
    statusCode,
    finalUrl,
    title: normalized.title,
    name: normalized.name,
    headline: normalized.headline,
    location: normalized.location,
    imageUrl,
    rawText,
    normalized,
    metadata: {
      requestedUrl,
      finalUrl,
      contentType,
      captureState: normalized.captureState,
      failureKind,
      ...metadata,
    },
    htmlBytes: Buffer.byteLength(html || "", "utf8"),
    contentHash: hashObject(normalized),
    error,
  };
}

function getHttpError(response, html) {
  if (response.ok) {
    return null;
  }

  const failureKind = detectFailureKind(response.status, html, null);
  if (failureKind === "linkedin_authwall") {
    return `LinkedIn authwall blocked public fetch (HTTP ${response.status})`;
  }

  const statusText = response.statusText && response.statusText !== "<none>" ? ` ${response.statusText}` : "";
  return `HTTP ${response.status}${statusText}`;
}

function detectFailureKind(statusCode, html, error) {
  if (error && /authwall|blocked public fetch/i.test(error)) {
    return "linkedin_authwall";
  }

  const body = String(html || "");
  if (Number(statusCode) === 999 && /\/authwall|sessionRedirect=|window\.location\.href/i.test(body)) {
    return "linkedin_authwall";
  }

  if (Number(statusCode) === 999) {
    return "linkedin_block";
  }

  if (Number(statusCode) >= 400) {
    return "http_error";
  }

  return "";
}

function extractMetadata($) {
  const metadata = {
    canonical: $("link[rel='canonical']").attr("href") || "",
    ogTitle: metaProperty($, "og:title"),
    ogDescription: metaProperty($, "og:description"),
    ogImage: metaProperty($, "og:image"),
    twitterTitle: metaName($, "twitter:title"),
    twitterDescription: metaName($, "twitter:description"),
    twitterImage: metaName($, "twitter:image"),
    profileFirstName: metaProperty($, "profile:first_name"),
    profileLastName: metaProperty($, "profile:last_name"),
  };

  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, cleanText(value)]));
}

function extractReadableText($) {
  $("script, style, noscript, svg, canvas, iframe, form, nav").remove();
  const chunks = [];

  $("h1, h2, h3, p, li, dd, dt, span").each((_index, element) => {
    const text = cleanText($(element).text());
    if (text && text.length > 1) {
      chunks.push(text);
    }
  });

  const deduped = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const key = chunk.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(chunk);
    }
  }

  return deduped.join("\n").slice(0, 120000);
}

function extractName(title, firstName, lastName) {
  if (firstName || lastName) {
    return `${firstName || ""} ${lastName || ""}`.trim();
  }

  return cleanText(String(title || "").replace(/\s*\|\s*LinkedIn\s*$/i, ""));
}

function extractLikelyLocation(rawText) {
  const lines = String(rawText || "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);

  const locationIndex = lines.findIndex((line) => /^location$/i.test(line));
  if (locationIndex >= 0 && lines[locationIndex + 1]) {
    return lines[locationIndex + 1];
  }

  return "";
}

function compareVersions(fromVersion, toVersion) {
  if (!fromVersion || !toVersion) {
    throw new Error("Both versions are required for comparison.");
  }

  const fieldChanges = ["name", "headline", "location", "title", "statusCode"].flatMap((field) => {
    const before = String(fromVersion[field] ?? "");
    const after = String(toVersion[field] ?? "");
    return before === after ? [] : [{ field, before, after }];
  });

  const textDiff = diffText(fromVersion.rawText || "", toVersion.rawText || "");

  return {
    fromVersionId: fromVersion.id,
    toVersionId: toVersion.id,
    fromFetchedAt: fromVersion.fetchedAt,
    toFetchedAt: toVersion.fetchedAt,
    sameHash: fromVersion.contentHash === toVersion.contentHash,
    fieldChanges,
    textDiff,
    summary: {
      changedFields: fieldChanges.length,
      added: textDiff.filter((part) => part.type === "added").length,
      removed: textDiff.filter((part) => part.type === "removed").length,
    },
  };
}

function diffText(before, after) {
  const oldParts = splitForDiff(before);
  const newParts = splitForDiff(after);
  const table = Array.from({ length: oldParts.length + 1 }, () => Array(newParts.length + 1).fill(0));

  for (let i = oldParts.length - 1; i >= 0; i -= 1) {
    for (let j = newParts.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldParts[i] === newParts[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const diff = [];
  let i = 0;
  let j = 0;

  while (i < oldParts.length && j < newParts.length) {
    if (oldParts[i] === newParts[j]) {
      diff.push({ type: "unchanged", text: oldParts[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      diff.push({ type: "removed", text: oldParts[i] });
      i += 1;
    } else {
      diff.push({ type: "added", text: newParts[j] });
      j += 1;
    }
  }

  while (i < oldParts.length) {
    diff.push({ type: "removed", text: oldParts[i] });
    i += 1;
  }

  while (j < newParts.length) {
    diff.push({ type: "added", text: newParts[j] });
    j += 1;
  }

  return compactUnchanged(diff, 2);
}

function splitForDiff(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);

  if (lines.length > 1) {
    return lines;
  }

  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(Boolean);
}

function compactUnchanged(diff, contextSize) {
  const output = [];

  for (let i = 0; i < diff.length; i += 1) {
    const part = diff[i];
    if (part.type !== "unchanged") {
      output.push(part);
      continue;
    }

    const run = [];
    while (i < diff.length && diff[i].type === "unchanged") {
      run.push(diff[i]);
      i += 1;
    }
    i -= 1;

    if (run.length <= contextSize * 2 + 1) {
      output.push(...run);
    } else {
      output.push(...run.slice(0, contextSize));
      output.push({ type: "context", text: `${run.length - contextSize * 2} unchanged lines` });
      output.push(...run.slice(-contextSize));
    }
  }

  return output;
}

function metaProperty($, property) {
  return $(`meta[property='${property}']`).attr("content") || "";
}

function metaName($, name) {
  return $(`meta[name='${name}']`).attr("content") || "";
}

function metaContent($, name) {
  return metaName($, name) || $(`meta[property='${name}']`).attr("content") || "";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstTruthy(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

module.exports = {
  buildCaptureFromHtml,
  compareVersions,
  detectFailureKind,
  diffText,
  fetchProfileSnapshot,
  getHttpError,
  normalizeLinkedInProfileUrl,
  shouldRetryCapture,
  splitForDiff,
};
