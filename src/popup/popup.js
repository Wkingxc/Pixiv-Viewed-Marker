(function initPopup() {
  const statusEl = document.getElementById("status");
  const backupFileEl = document.getElementById("backupFile");
  const setupSectionEl = document.getElementById("setupSection");
  const visitedColorEl = document.getElementById("visitedColor");
  const colorValueEl = document.getElementById("colorValue");
  const markTitleEl = document.getElementById("markTitle");
  const markImageEl = document.getElementById("markImage");
  const hideViewedEl = document.getElementById("hideViewed");
  const overlayOpacityEl = document.getElementById("overlayOpacity");
  const overlayValueEl = document.getElementById("overlayValue");
  const authorGridColumnsEl = document.getElementById("authorGridColumns");
  const authorMinPageCountEl = document.getElementById("authorMinPageCount");
  const authorHighResEl = document.getElementById("authorHighRes");
  const authorHoverPreviewEl = document.getElementById("authorHoverPreview");
  const excludeFormEl = document.getElementById("excludeForm");
  const excludeUrlEl = document.getElementById("excludeUrl");
  const excludedPagesEl = document.getElementById("excludedPages");

  let currentData = null;
  let saveTimer = null;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function colorToHex(color) {
    const value = { ...PVM.DEFAULT_COLOR, ...(color || {}) };
    const toHex = (part) => Number(part).toString(16).padStart(2, "0");
    return `#${toHex(value.r)}${toHex(value.g)}${toHex(value.b)}`;
  }

  function hexToColor(hex) {
    const normalized = hex.replace("#", "");
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
      a: 1
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
  }

  function renderSettings(settings) {
    const hex = colorToHex(settings.artworkVisitedColor);
    visitedColorEl.value = hex;
    colorValueEl.textContent = hex.toUpperCase();
    markTitleEl.checked = Boolean(settings.markArtworkTitle);
    markImageEl.checked = Boolean(settings.markArtworkImage);
    hideViewedEl.checked = Boolean(settings.hideViewedArtwork);
    overlayOpacityEl.value = String(settings.artworkImageOverlayOpacity ?? 0.28);
    overlayValueEl.textContent = `${Math.round(Number(overlayOpacityEl.value) * 100)}%`;
    authorGridColumnsEl.value = String(clampNumber(settings.authorPageGridColumns, 2, 6, 6));
    authorMinPageCountEl.value = String(clampNumber(settings.authorPageMinPageCount, 0, 999, 0));
    authorHighResEl.checked = Boolean(settings.authorPageUseHighResThumbnails);
    authorHoverPreviewEl.checked = Boolean(settings.authorPageHoverPreviewEnabled);
  }

  function renderExcludedPages(target, records) {
    target.replaceChildren();
    const entries = Object.values(records).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "暂无排除项";
      target.append(empty);
      return;
    }

    entries.forEach((record) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      const link = document.createElement("a");
      const action = document.createElement("button");

      link.href = `https://www.pixiv.net${record.pattern}`;
      link.target = "_blank";
      link.textContent = record.label || record.pattern;
      action.type = "button";
      action.textContent = "移除";
      action.addEventListener("click", async () => {
        await PVM.storage.removeExcludedPage(record.pattern);
        await refreshData();
        setStatus("已移除排除页面。");
      });

      text.append(link);
      item.append(text, action);
      target.append(item);
    });
  }

  async function refreshData() {
    currentData = await PVM.storage.getAllData();
    setupSectionEl.hidden = Boolean(currentData.stats.lastHistoryImportAt);
    renderSettings(currentData.settings);
    renderExcludedPages(excludedPagesEl, currentData.exclusions.pages || {});
  }

  function scheduleSettingsSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const settings = {
        artworkVisitedColor: hexToColor(visitedColorEl.value),
        markArtworkTitle: markTitleEl.checked,
        markArtworkImage: markImageEl.checked,
        hideViewedArtwork: hideViewedEl.checked,
        artworkImageOverlayOpacity: Number(overlayOpacityEl.value),
        authorPageGridColumns: clampNumber(authorGridColumnsEl.value, 2, 6, 6),
        authorPageMinPageCount: clampNumber(authorMinPageCountEl.value, 0, 999, 0),
        authorPageUseHighResThumbnails: authorHighResEl.checked,
        authorPageHoverPreviewEnabled: authorHoverPreviewEl.checked
      };

      currentData.settings = await PVM.storage.saveSettings(settings);
      authorGridColumnsEl.value = String(currentData.settings.authorPageGridColumns);
      authorMinPageCountEl.value = String(currentData.settings.authorPageMinPageCount);
      colorValueEl.textContent = visitedColorEl.value.toUpperCase();
      overlayValueEl.textContent = `${Math.round(Number(overlayOpacityEl.value) * 100)}%`;
      setStatus("标记设置已保存。");
    }, 180);
  }

  function backupName() {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+$/, "")
      .replace("T", "-");
    return `pixiv-viewed-marker-backup-${stamp}.json`;
  }

  async function handleHistoryImport() {
    setStatus("正在请求 history 权限...");
    const granted = await chrome.permissions.request({ permissions: ["history"] });
    if (!granted) {
      setStatus("未获得 history 权限，已取消导入。");
      return;
    }

    setStatus("正在扫描 Pixiv 浏览历史...");
    try {
      const result = await PVM.historyImporter.importFromHistory();
      await refreshData();
      setStatus(`初始化完成：作品 ${result.artworkCount}，作者 ${result.userCount}。`);
    } finally {
      await chrome.permissions.remove({ permissions: ["history"] });
    }
  }

  async function handleExcludeSubmit(event) {
    event.preventDefault();
    const pagePattern = PVM.normalizePixivPagePattern(excludeUrlEl.value.trim());
    if (!pagePattern) {
      setStatus("请输入 Pixiv 页面 URL。");
      return;
    }

    await PVM.storage.addExcludedPage(pagePattern);
    excludeUrlEl.value = "";
    await refreshData();
    setStatus(`已排除页面 ${pagePattern.pattern}。`);
  }

  async function handleExport() {
    const data = await PVM.storage.getAllData();
    const blob = new Blob(
      [JSON.stringify({ ...data, exportedAt: Date.now() }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupName();
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("备份已导出。");
  }

  function handleImportClick() {
    backupFileEl.value = "";
    backupFileEl.click();
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed.schemaVersion !== PVM.SCHEMA_VERSION) {
        throw new Error("不支持的备份版本。");
      }
      if (!parsed.viewedArtworks || !parsed.viewedUsers) {
        throw new Error("备份文件缺少必要数据。");
      }

      const result = await PVM.storage.mergeImportedData(parsed, "manual");
      await refreshData();
      setStatus(`导入完成：作品 ${result.artworkCount}，作者 ${result.userCount}。`);
    } catch (error) {
      setStatus(error.message || "导入失败。");
    }
  }

  async function handleClear() {
    const confirmed = confirm("确定要清空全部 Pixiv 已访问记录吗？此操作不可恢复。");
    if (!confirmed) return;

    await PVM.storage.clearAllData();
    await refreshData();
    setStatus("记录已清空。");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("is-active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("is-active");
    });
  });

  [visitedColorEl, markTitleEl, markImageEl, hideViewedEl, overlayOpacityEl, authorGridColumnsEl, authorMinPageCountEl, authorHighResEl, authorHoverPreviewEl].forEach((control) => {
    control.addEventListener("input", scheduleSettingsSave);
    control.addEventListener("change", scheduleSettingsSave);
  });

  excludeFormEl.addEventListener("submit", (event) => {
    handleExcludeSubmit(event).catch((error) => setStatus(error.message || "排除失败。"));
  });
  document.getElementById("importHistory").addEventListener("click", () => {
    handleHistoryImport().catch((error) => setStatus(error.message || "历史导入失败。"));
  });
  document.getElementById("exportBackup").addEventListener("click", () => {
    handleExport().catch((error) => setStatus(error.message || "导出失败。"));
  });
  document.getElementById("importBackup").addEventListener("click", handleImportClick);
  document.getElementById("clearData").addEventListener("click", () => {
    handleClear().catch((error) => setStatus(error.message || "清空失败。"));
  });
  backupFileEl.addEventListener("change", handleImportFile);

  refreshData().catch((error) => setStatus(error.message || "读取数据失败。"));
})();
