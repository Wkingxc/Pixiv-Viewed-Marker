importScripts(
  "../shared/constants.js",
  "../shared/url-parser.js",
  "../shared/storage.js",
  "../shared/history-importer.js"
);

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("schemaVersion").then((data) => {
    if (!data.schemaVersion) {
      chrome.storage.local.set({
        schemaVersion: PVM.SCHEMA_VERSION,
        settings: PVM.DEFAULT_SETTINGS,
        viewedArtworks: {},
        viewedUsers: {},
        exclusions: PVM.DEFAULT_EXCLUSIONS,
        stats: PVM.DEFAULT_STATS
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PVM_RECORD_VISIT") return false;

  PVM.storage
    .recordParsedVisit(message.parsed, message.source || "click", message.timestamp || Date.now())
    .then((record) => sendResponse({ ok: true, record }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
