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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PVM_RECORD_VISIT") {
    PVM.storage
      .recordParsedVisit(message.parsed, message.source || "click", message.timestamp || Date.now())
      .then((record) => sendResponse({ ok: true, record }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PVM_OPEN_TAB") {
    const url = message.url;
    const active = message.active === true;
    if (typeof url !== "string" || !url) {
      sendResponse({ ok: false, error: "missing url" });
      return false;
    }
    const openerTabId = sender?.tab?.id;
    const openerIndex = sender?.tab?.index;
    const createProps = { url, active };
    if (Number.isInteger(openerTabId)) createProps.openerTabId = openerTabId;
    if (Number.isInteger(openerIndex)) createProps.index = openerIndex + 1;
    chrome.tabs
      .create(createProps)
      .then((tab) => sendResponse({ ok: true, tabId: tab?.id }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
