#!/usr/bin/env node
const {
  deleteProfile,
  getProfile,
  listProfiles,
  listVersions,
  updateProfileStatus,
} = require("./db");
const { addProfile, captureProfile, compareProfileVersions, monitorProfiles } = require("./profiles");
const { normalizeLinkedInProfileUrl } = require("./archive");
const { formatLocalTimestamp } = require("./time");

async function main(argv) {
  const [command, ...args] = argv;

  try {
    if (!command || command === "help" || command === "--help") {
      printHelp();
      return;
    }

    if (command === "add") {
      await addCommand(args);
      return;
    }

    if (command === "list") {
      listCommand(args);
      return;
    }

    if (command === "capture") {
      await captureCommand(args);
      return;
    }

    if (command === "monitor") {
      await monitorCommand();
      return;
    }

    if (command === "versions") {
      versionsCommand(args);
      return;
    }

    if (command === "diff") {
      diffCommand(args);
      return;
    }

    if (command === "pause" || command === "resume") {
      statusCommand(command, args);
      return;
    }

    if (command === "delete") {
      deleteCommand(args);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

async function addCommand(args) {
  const url = args[0];
  const label = readFlag(args, "--label") || "";
  const noCapture = args.includes("--no-capture");
  const profile = addProfile({ url, label });
  console.log(`Saved #${profile.id}: ${profile.label || profile.slug}`);
  console.log(profile.canonicalUrl);

  if (!noCapture) {
    const result = await captureProfile(profile.id);
    printCaptureResult(result);
  }
}

function listCommand(args) {
  const q = readFlag(args, "--q") || "";
  const profiles = listProfiles({ q });
  if (!profiles.length) {
    console.log("No profiles saved.");
    return;
  }

  for (const profile of profiles) {
    console.log(
      [
        `#${profile.id}`,
        profile.status,
        profile.label || profile.slug,
        `${profile.versionCount} version${profile.versionCount === 1 ? "" : "s"}`,
        profile.lastCheckedAt ? `checked ${formatLocalTimestamp(profile.lastCheckedAt)}` : "never checked",
      ].join(" | "),
    );
    console.log(`  ${profile.canonicalUrl}`);
    if (profile.lastError) {
      console.log(`  last error: ${profile.lastError}`);
    }
  }
}

async function captureCommand(args) {
  const profile = resolveProfile(args[0]);
  const result = await captureProfile(profile.id);
  printCaptureResult(result);
}

async function monitorCommand() {
  const results = await monitorProfiles();
  console.log(`Checked ${results.length} active profile${results.length === 1 ? "" : "s"}.`);
  for (const result of results) {
    if (result.error) {
      console.log(`#${result.profile.id} ${result.profile.label || result.profile.slug}: ${result.error}`);
    } else {
      printCaptureResult(result);
    }
  }
}

function versionsCommand(args) {
  const profile = resolveProfile(args[0]);
  const versions = listVersions(profile.id);
  if (!versions.length) {
    console.log("No versions archived yet.");
    return;
  }

  for (const version of versions) {
    console.log(
      `#${version.id} | ${formatLocalTimestamp(version.fetchedAt)} | ${version.statusCode || "no status"} | ${
        version.error || version.title || version.contentHash.slice(0, 12)
      }`,
    );
  }
}

function diffCommand(args) {
  const profile = resolveProfile(args[0]);
  const diff = compareProfileVersions(profile.id, args[1] ? Number(args[1]) : null, args[2] ? Number(args[2]) : null);
  console.log(`Comparing #${diff.fromVersionId} -> #${diff.toVersionId}`);
  console.log(`Fields changed: ${diff.summary.changedFields}; added: ${diff.summary.added}; removed: ${diff.summary.removed}`);

  for (const change of diff.fieldChanges) {
    console.log(`\n${change.field}`);
    console.log(`- ${change.before || "(blank)"}`);
    console.log(`+ ${change.after || "(blank)"}`);
  }

  for (const part of diff.textDiff.filter((entry) => entry.type !== "unchanged")) {
    const marker = part.type === "added" ? "+" : part.type === "removed" ? "-" : "...";
    console.log(`${marker} ${part.text}`);
  }
}

function statusCommand(command, args) {
  const profile = resolveProfile(args[0]);
  const updated = updateProfileStatus(profile.id, command === "pause" ? "paused" : "active");
  console.log(`#${updated.id} is now ${updated.status}.`);
}

function deleteCommand(args) {
  const profile = resolveProfile(args[0]);
  deleteProfile(profile.id);
  console.log(`Deleted #${profile.id}.`);
}

function resolveProfile(value) {
  if (!value) {
    throw new Error("Profile id or URL is required.");
  }

  const profiles = listProfiles();
  if (/^\d+$/.test(value)) {
    const profile = getProfile(Number(value));
    if (!profile) {
      throw new Error(`Profile #${value} not found.`);
    }
    return profile;
  }

  const normalized = normalizeLinkedInProfileUrl(value);
  const profile = profiles.find((candidate) => candidate.canonicalUrl === normalized.canonicalUrl);
  if (!profile) {
    throw new Error("Profile URL is not saved yet. Use `linkeye add <url>` first.");
  }
  return profile;
}

function printCaptureResult(result) {
  const profile = result.profile;
  const version = result.version;
  const label = profile.label || profile.slug;

  if (result.error || !version) {
    console.log(`#${profile.id} ${label}: capture failed`);
    console.log(`  ${result.error || profile.lastError || "No profile content was archived."}`);
    if (profile.versionCount > 0) {
      console.log(`  Keeping ${profile.versionCount} successful archived version${profile.versionCount === 1 ? "" : "s"}.`);
    }
    return;
  }

  const state = result.inserted ? "new version" : "unchanged";
  console.log(`#${profile.id} ${label}: ${state} #${version.id} (${version.statusCode || "no status"})`);
  if (version.error) {
    console.log(`  ${version.error}`);
  }
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function printHelp() {
  console.log(`LinkEye

Usage:
  linkeye add <linkedin-url> [--label "Name"] [--no-capture]
  linkeye list [--q text]
  linkeye capture <profile-id-or-url>
  linkeye monitor
  linkeye versions <profile-id-or-url>
  linkeye diff <profile-id-or-url> [from-version-id] [to-version-id]
  linkeye pause <profile-id-or-url>
  linkeye resume <profile-id-or-url>
  linkeye delete <profile-id-or-url>
`);
}

main(process.argv.slice(2));
