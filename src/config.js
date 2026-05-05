const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const ROOT_DIR = path.join(__dirname, "..");

function resolveProjectPath(value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT_DIR, selected);
}

module.exports = {
  ROOT_DIR,
  PORT: Number(process.env.PORT || 3766),
  HOST: process.env.HOST || "127.0.0.1",
  DB_PATH: resolveProjectPath(process.env.LINKEYE_DB_PATH, "data/linkeye.sqlite"),
  USER_AGENT: process.env.LINKEYE_USER_AGENT || "LinkEye/0.1 public-profile-archiver",
  DAILY_HOUR: Number(process.env.LINKEYE_DAILY_HOUR || 9),
  DAILY_MINUTE: Number(process.env.LINKEYE_DAILY_MINUTE || 15),
};
