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
      const parsed = PVM.parsePixivUrl(item.url);
      if (!parsed) return;

      const timestamp = item.lastVisitTime || now;

      if (parsed.type === "artwork") {
        parsedArtworkRecords += 1;
        PVM.storage.mergeRecord(data.viewedArtworks, parsed.id, timestamp);
      }

      if (parsed.type === "user") {
        parsedUserRecords += 1;
        PVM.storage.mergeRecord(data.viewedUsers, parsed.id, timestamp);
      }
    });

    await PVM.storage.saveCollections({
      viewedArtworks: data.viewedArtworks,
      viewedUsers: data.viewedUsers
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
