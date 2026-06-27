(function initStorage(global) {
  const PVM = global.PVM || {};

  const DEFAULT_DATA = {
    schemaVersion: PVM.SCHEMA_VERSION,
    settings: PVM.DEFAULT_SETTINGS,
    viewedArtworks: {},
    viewedUsers: {},
    exclusions: PVM.DEFAULT_EXCLUSIONS,
    stats: PVM.DEFAULT_STATS
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(value) {
    return chrome.storage.local.set(value);
  }

  async function getAllData() {
    const stored = await storageGet(Object.keys(DEFAULT_DATA));
    const storedExclusions = stored.exclusions || {};
    return {
      schemaVersion: stored.schemaVersion || PVM.SCHEMA_VERSION,
      settings: { ...clone(PVM.DEFAULT_SETTINGS), ...(stored.settings || {}) },
      viewedArtworks: stored.viewedArtworks || {},
      viewedUsers: stored.viewedUsers || {},
      exclusions: {
        ...clone(PVM.DEFAULT_EXCLUSIONS),
        pages: storedExclusions.pages || {}
      },
      stats: { ...clone(PVM.DEFAULT_STATS), ...(stored.stats || {}) }
    };
  }

  async function saveCollections({ viewedArtworks, viewedUsers, exclusions, stats, settings } = {}) {
    const patch = { schemaVersion: PVM.SCHEMA_VERSION };
    if (viewedArtworks) patch.viewedArtworks = viewedArtworks;
    if (viewedUsers) patch.viewedUsers = viewedUsers;
    if (exclusions) patch.exclusions = exclusions;
    if (stats) patch.stats = stats;
    if (settings) patch.settings = settings;
    await storageSet(patch);
  }

  async function saveSettings(settings) {
    const data = await getAllData();
    const nextSettings = { ...data.settings, ...(settings || {}) };
    await saveCollections({ settings: nextSettings });
    return nextSettings;
  }

  function mergeRecord(collection, id, source, timestamp, count = 1) {
    const existing = collection[id];
    if (!existing) {
      collection[id] = {
        id,
        visitedAt: timestamp,
        visitCount: count,
        source,
        updatedAt: timestamp
      };
      return;
    }

    existing.visitedAt = Math.max(existing.visitedAt || 0, timestamp);
    existing.visitCount = (existing.visitCount || 0) + count;
    existing.source = existing.source || source;
    existing.updatedAt = timestamp;
  }

  async function recordParsedVisit(parsed, source = "runtime", timestamp = Date.now()) {
    if (!parsed || !parsed.id) return null;

    const data = await getAllData();

    if (parsed.type === "artwork") {
      mergeRecord(data.viewedArtworks, parsed.id, source, timestamp);
      await saveCollections({ viewedArtworks: data.viewedArtworks });
      return data.viewedArtworks[parsed.id];
    }

    if (parsed.type === "user") {
      mergeRecord(data.viewedUsers, parsed.id, source, timestamp);
      await saveCollections({ viewedUsers: data.viewedUsers });
      return data.viewedUsers[parsed.id];
    }

    return null;
  }

  async function addExcludedPage(pagePattern) {
    if (!pagePattern || !pagePattern.pattern) throw new Error("无法识别这个 Pixiv 页面 URL。");

    const data = await getAllData();
    const now = Date.now();
    data.exclusions.pages[pagePattern.pattern] = {
      id: pagePattern.pattern,
      pattern: pagePattern.pattern,
      label: pagePattern.label || pagePattern.pattern,
      addedAt: now
    };

    await saveCollections({
      exclusions: data.exclusions
    });

    return data.exclusions;
  }

  async function removeExcludedPage(pattern) {
    const data = await getAllData();
    delete data.exclusions.pages[pattern];
    await saveCollections({ exclusions: data.exclusions });
    return data.exclusions;
  }

  async function mergeImportedData(importData, source = "manual") {
    const data = await getAllData();
    const now = Date.now();
    const artworks = importData.viewedArtworks || {};
    const users = importData.viewedUsers || {};
    const exclusions = importData.exclusions || {};

    Object.entries(exclusions.pages || {}).forEach(([pattern, record]) => {
      data.exclusions.pages[pattern] = {
        id: pattern,
        pattern,
        label: record.label || pattern,
        addedAt: record.addedAt || now
      };
    });

    Object.entries(artworks).forEach(([id, record]) => {
      mergeRecord(
        data.viewedArtworks,
        id,
        record.source || source,
        record.visitedAt || now,
        record.visitCount || 1
      );
    });

    Object.entries(users).forEach(([id, record]) => {
      mergeRecord(
        data.viewedUsers,
        id,
        record.source || source,
        record.visitedAt || now,
        record.visitCount || 1
      );
    });

    await saveCollections({
      viewedArtworks: data.viewedArtworks,
      viewedUsers: data.viewedUsers,
      exclusions: data.exclusions
    });

    return {
      artworkCount: Object.keys(data.viewedArtworks).length,
      userCount: Object.keys(data.viewedUsers).length
    };
  }

  async function clearAllData() {
    await storageSet(clone(DEFAULT_DATA));
  }

  PVM.storage = {
    getAllData,
    saveCollections,
    saveSettings,
    recordParsedVisit,
    addExcludedPage,
    removeExcludedPage,
    mergeImportedData,
    clearAllData,
    mergeRecord
  };

  global.PVM = PVM;
})(globalThis);
