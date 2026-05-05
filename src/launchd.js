#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DAILY_HOUR, DAILY_MINUTE, ROOT_DIR } = require("./config");

const nodePath = process.execPath;
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const logsDir = path.join(ROOT_DIR, "logs");
const monitorLabel = "local.linkeye.monitor";
const serverLabel = "local.linkeye.server";

function main(command) {
  if (command === "install") {
    install();
    return;
  }

  if (command === "uninstall") {
    uninstall();
    return;
  }

  console.log("Usage: npm run launchd:install | npm run launchd:uninstall");
}

function install() {
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const serverPath = path.join(launchAgentsDir, `${serverLabel}.plist`);
  const monitorPath = path.join(launchAgentsDir, `${monitorLabel}.plist`);

  fs.writeFileSync(serverPath, serverPlist());
  fs.writeFileSync(monitorPath, monitorPlist());

  console.log(`Wrote ${serverPath}`);
  console.log(`Wrote ${monitorPath}`);
  console.log("Load them with:");
  console.log(`  launchctl load ${serverPath}`);
  console.log(`  launchctl load ${monitorPath}`);
}

function uninstall() {
  for (const label of [serverLabel, monitorLabel]) {
    const plistPath = path.join(launchAgentsDir, `${label}.plist`);
    if (fs.existsSync(plistPath)) {
      console.log(`Unload if needed: launchctl unload ${plistPath}`);
      fs.unlinkSync(plistPath);
      console.log(`Removed ${plistPath}`);
    }
  }
}

function serverPlist() {
  return plist({
    label: serverLabel,
    programArguments: [nodePath, path.join(ROOT_DIR, "src", "server.js")],
    runAtLoad: true,
    keepAlive: true,
    standardOutPath: path.join(logsDir, "server.log"),
    standardErrorPath: path.join(logsDir, "server.err.log"),
  });
}

function monitorPlist() {
  return plist({
    label: monitorLabel,
    programArguments: [nodePath, path.join(ROOT_DIR, "src", "cli.js"), "monitor"],
    startCalendarInterval: {
      Hour: DAILY_HOUR,
      Minute: DAILY_MINUTE,
    },
    standardOutPath: path.join(logsDir, "monitor.log"),
    standardErrorPath: path.join(logsDir, "monitor.err.log"),
  });
}

function plist(config) {
  const entries = [
    keyValue("Label", config.label),
    keyArray("ProgramArguments", config.programArguments),
    config.runAtLoad ? keyBool("RunAtLoad", true) : "",
    config.keepAlive ? keyBool("KeepAlive", true) : "",
    config.startCalendarInterval ? keyDict("StartCalendarInterval", config.startCalendarInterval) : "",
    keyValue("WorkingDirectory", ROOT_DIR),
    keyValue("StandardOutPath", config.standardOutPath),
    keyValue("StandardErrorPath", config.standardErrorPath),
  ].filter(Boolean);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.join("\n")}
</dict>
</plist>
`;
}

function keyValue(key, value) {
  return `  <key>${escapeXml(key)}</key>\n  <string>${escapeXml(value)}</string>`;
}

function keyBool(key, value) {
  return `  <key>${escapeXml(key)}</key>\n  <${value ? "true" : "false"}/>`;
}

function keyArray(key, values) {
  return `  <key>${escapeXml(key)}</key>\n  <array>\n${values
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n")}\n  </array>`;
}

function keyDict(key, value) {
  return `  <key>${escapeXml(key)}</key>\n  <dict>\n${Object.entries(value)
    .map(([entryKey, entryValue]) => `    <key>${escapeXml(entryKey)}</key>\n    <integer>${Number(entryValue)}</integer>`)
    .join("\n")}\n  </dict>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main(process.argv[2]);
