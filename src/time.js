function nowIso() {
  return new Date().toISOString();
}

function formatLocalTimestamp(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

module.exports = {
  formatLocalTimestamp,
  nowIso,
};
