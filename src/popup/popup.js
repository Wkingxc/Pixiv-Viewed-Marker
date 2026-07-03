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
  const authorGridDecrementEl = document.querySelector('[data-action="grid-decrement"]');
  const authorGridIncrementEl = document.querySelector('[data-action="grid-increment"]');
  const authorMinPageCountEl = document.getElementById("authorMinPageCount");
  const authorHighResEl = document.getElementById("authorHighRes");
  const authorHoverPreviewEl = document.getElementById("authorHoverPreview");
  const relatedWorksEnabledEl = document.getElementById("relatedWorksEnabled");
  const relatedGridColumnsEl = document.getElementById("relatedGridColumns");
  const relatedGridDecrementEl = document.querySelector('[data-action="related-grid-decrement"]');
  const relatedGridIncrementEl = document.querySelector('[data-action="related-grid-increment"]');
  const relatedMinPageCountEl = document.getElementById("relatedMinPageCount");
  const relatedHoverPreviewEl = document.getElementById("relatedHoverPreview");
  const artworkHideAuthorWorksEl = document.getElementById("artworkHideAuthorWorks");
  const artworkHideCommentsEl = document.getElementById("artworkHideComments");
  const smoothScrollEnabledEl = document.getElementById("smoothScrollEnabled");
  const smoothScrollScreensEl = document.getElementById("smoothScrollScreens");
  const smoothScrollValueEl = document.getElementById("smoothScrollValue");
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

  function clampFloat(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, min), max);
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
    relatedWorksEnabledEl.checked = settings.relatedWorksEnabled !== false;
    relatedGridColumnsEl.value = String(clampNumber(settings.relatedWorksGridColumns, 2, 6, 6));
    relatedMinPageCountEl.value = String(clampNumber(settings.relatedWorksMinPageCount, 0, 999, 0));
    relatedHoverPreviewEl.checked = Boolean(settings.relatedWorksHoverPreviewEnabled);
    artworkHideAuthorWorksEl.checked = Boolean(settings.artworkPageHideAuthorWorks);
    artworkHideCommentsEl.checked = Boolean(settings.artworkPageHideComments);
    smoothScrollEnabledEl.checked = Boolean(settings.smoothScrollEnabled);
    smoothScrollScreensEl.value = String(clampFloat(settings.smoothScrollScreens, 0.3, 3.0, 1.0));
    updateSmoothScrollLabel();
    updateGridStepperState();
    updateRelatedControlsState();
    updateSmoothScrollControlsState();
  }

  function updateGridStepperState() {
    const authorValue = clampNumber(authorGridColumnsEl.value, 2, 6, 6);
    authorGridDecrementEl.disabled = authorValue <= 2;
    authorGridIncrementEl.disabled = authorValue >= 6;
    const relatedValue = clampNumber(relatedGridColumnsEl.value, 2, 6, 6);
    relatedGridDecrementEl.disabled = relatedValue <= 2;
    relatedGridIncrementEl.disabled = relatedValue >= 6;
  }

  function updateRelatedControlsState() {
    const disabled = !relatedWorksEnabledEl.checked;
    relatedGridColumnsEl.disabled = disabled;
    relatedGridDecrementEl.disabled = disabled || clampNumber(relatedGridColumnsEl.value, 2, 6, 6) <= 2;
    relatedGridIncrementEl.disabled = disabled || clampNumber(relatedGridColumnsEl.value, 2, 6, 6) >= 6;
    relatedMinPageCountEl.disabled = disabled;
    relatedHoverPreviewEl.disabled = disabled;
  }

  function updateSmoothScrollLabel() {
    const value = clampFloat(smoothScrollScreensEl.value, 0.3, 3.0, 1.0);
    smoothScrollValueEl.textContent = `${value.toFixed(1)} 屏`;
  }

  function updateSmoothScrollControlsState() {
    smoothScrollScreensEl.disabled = !smoothScrollEnabledEl.checked;
  }

  function adjustGridColumns(delta) {
    const next = clampNumber(Number(authorGridColumnsEl.value) + delta, 2, 6, 6);
    if (String(next) === authorGridColumnsEl.value) {
      updateGridStepperState();
      return;
    }
    authorGridColumnsEl.value = String(next);
    updateGridStepperState();
    scheduleSettingsSave();
  }

  function adjustRelatedGridColumns(delta) {
    const next = clampNumber(Number(relatedGridColumnsEl.value) + delta, 2, 6, 6);
    if (String(next) === relatedGridColumnsEl.value) {
      updateGridStepperState();
      return;
    }
    relatedGridColumnsEl.value = String(next);
    updateGridStepperState();
    scheduleSettingsSave();
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
    // 已经有任何访问记录就视为完成过初始化，不再显示导入入口
    const hasAnyVisits =
      Object.keys(currentData.viewedArtworks || {}).length > 0 ||
      Object.keys(currentData.viewedUsers || {}).length > 0;
    setupSectionEl.hidden = hasAnyVisits;
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
        authorPageHighResThumbnailQuality: "original",
        authorPageHoverPreviewEnabled: authorHoverPreviewEl.checked,
        authorPageHoverPreviewQuality: authorHoverPreviewEl.checked ? "original" : "off",
        relatedWorksEnabled: relatedWorksEnabledEl.checked,
        relatedWorksGridColumns: clampNumber(relatedGridColumnsEl.value, 2, 6, 6),
        relatedWorksMinPageCount: clampNumber(relatedMinPageCountEl.value, 0, 999, 0),
        relatedWorksUseHighResThumbnails: false,
        relatedWorksHighResThumbnailQuality: "original",
        relatedWorksHoverPreviewEnabled: relatedHoverPreviewEl.checked,
        relatedWorksHoverPreviewQuality: relatedHoverPreviewEl.checked ? "original" : "off",
        artworkPageHideAuthorWorks: artworkHideAuthorWorksEl.checked,
        artworkPageHideComments: artworkHideCommentsEl.checked,
        smoothScrollEnabled: smoothScrollEnabledEl.checked,
        smoothScrollScreens: clampFloat(smoothScrollScreensEl.value, 0.3, 3.0, 1.0)
      };

      currentData.settings = await PVM.storage.saveSettings(settings);
      authorGridColumnsEl.value = String(currentData.settings.authorPageGridColumns);
      authorMinPageCountEl.value = String(currentData.settings.authorPageMinPageCount);
      relatedGridColumnsEl.value = String(currentData.settings.relatedWorksGridColumns);
      relatedMinPageCountEl.value = String(currentData.settings.relatedWorksMinPageCount);
      updateGridStepperState();
      updateRelatedControlsState();
      updateSmoothScrollControlsState();
      colorValueEl.textContent = visitedColorEl.value.toUpperCase();
      overlayValueEl.textContent = `${Math.round(Number(overlayOpacityEl.value) * 100)}%`;
      setStatus("设置已保存。");
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
      activateTab(tab.dataset.tab);
    });
  });

  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-active", item.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `tab-${name}`));
  }

  async function autoSelectTabForActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tabs?.[0]?.url || "";
      const parsed = PVM.parsePixivUrl(url);
      if (parsed?.type === "user") activateTab("author");
      else if (parsed?.type === "artwork") activateTab("related");
    } catch (_error) {
      // ignore: 没有标签权限或非 Pixiv 页面，保持默认 tab。
    }
  }

  autoSelectTabForActiveTab();

  [visitedColorEl, markTitleEl, markImageEl, hideViewedEl, overlayOpacityEl, authorGridColumnsEl, authorMinPageCountEl, authorHighResEl, authorHoverPreviewEl, relatedWorksEnabledEl, relatedGridColumnsEl, relatedMinPageCountEl, relatedHoverPreviewEl, artworkHideAuthorWorksEl, artworkHideCommentsEl, smoothScrollEnabledEl, smoothScrollScreensEl].forEach((control) => {
    control.addEventListener("input", () => {
      if (control === smoothScrollScreensEl) updateSmoothScrollLabel();
      scheduleSettingsSave();
    });
    control.addEventListener("change", () => {
      if (control === relatedWorksEnabledEl) updateRelatedControlsState();
      if (control === smoothScrollEnabledEl) updateSmoothScrollControlsState();
      scheduleSettingsSave();
    });
  });

  authorGridDecrementEl.addEventListener("click", () => adjustGridColumns(-1));
  authorGridIncrementEl.addEventListener("click", () => adjustGridColumns(1));
  relatedGridDecrementEl.addEventListener("click", () => adjustRelatedGridColumns(-1));
  relatedGridIncrementEl.addEventListener("click", () => adjustRelatedGridColumns(1));

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
