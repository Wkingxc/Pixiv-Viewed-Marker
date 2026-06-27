(function initHistoryImporter(global) {
  const PVM = global.PVM || {};

  async function importFromHistory() {
    const data = await PVM.storage.getAllData();
    const results = await chrome.history.search({
      text: "pixiv.net",
      startTime: 0,
      maxResults: 1000000
    });

    const now = Date.now();
    let parsedArtworkRecords = 0;
    let parsedUserRecords = 0;

    results.forEach((item) => {
      const parsed = PVM.parsePixivUrl(item.url, data.settings);
      if (!parsed) return;

      const timestamp = item.lastVisitTime || now;
      const visitCount = Math.max(1, item.visitCount || 1);

      if (parsed.type === "artwork") {
        parsedArtworkRecords += 1;
        PVM.storage.mergeRecord(
          data.viewedArtworks,
          parsed.id,
          "history",
          timestamp,
          visitCount
        );
      }

      if (parsed.type === "user") {
        parsedUserRecords += 1;
        PVM.storage.mergeRecord(
          data.viewedUsers,
          parsed.id,
          "history",
          timestamp,
          visitCount
        );
      }
    });

    data.stats.lastHistoryImportAt = now;
    data.stats.lastHistoryImportArtworkCount = Object.keys(data.viewedArtworks).length;
    data.stats.lastHistoryImportUserCount = Object.keys(data.viewedUsers).length;

    await PVM.storage.saveCollections({
      viewedArtworks: data.viewedArtworks,
      viewedUsers: data.viewedUsers,
      stats: data.stats
    });

    return {
      artworkCount: Object.keys(data.viewedArtworks).length,
      userCount: Object.keys(data.viewedUsers).length,
      parsedArtworkRecords,
      parsedUserRecords
    };
  }

  PVM.historyImporter = { importFromHistory };
  global.PVM = PVM;
})(globalThis);
