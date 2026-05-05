const cheerio = require("cheerio");
const { USER_AGENT } = require("./config");
const { normalizeLinkedInProfileUrl } = require("./archive");

async function discoverPublicProfiles(query) {
  const q = String(query || "").trim();
  if (!q) {
    return [];
  }

  const searchUrl = new URL("https://html.duckduckgo.com/html/");
  searchUrl.searchParams.set("q", `site:linkedin.com/in ${q}`);

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed with HTTP ${response.status}.`);
  }

  return parseDiscoveryHtml(await response.text());
}

function parseDiscoveryHtml(html) {
  const $ = cheerio.load(html || "");
  const candidates = [];
  const seen = new Set();

  $("a").each((_index, element) => {
    const href = $(element).attr("href") || "";
    const url = unwrapDuckDuckGoUrl(href);
    if (!url || !url.includes("linkedin.com/in/")) {
      return;
    }

    try {
      const normalized = normalizeLinkedInProfileUrl(url);
      if (seen.has(normalized.canonicalUrl)) {
        return;
      }

      seen.add(normalized.canonicalUrl);
      candidates.push({
        url: normalized.canonicalUrl,
        slug: normalized.slug,
        title: cleanResultText($(element).text()) || normalized.slug,
      });
    } catch {
      // Ignore non-profile search results.
    }
  });

  return candidates.slice(0, 8);
}

function unwrapDuckDuckGoUrl(href) {
  if (!href) {
    return "";
  }

  if (href.startsWith("//")) {
    href = `https:${href}`;
  }

  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return "";
  }
}

function cleanResultText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();
}

module.exports = {
  discoverPublicProfiles,
  parseDiscoveryHtml,
  unwrapDuckDuckGoUrl,
};
