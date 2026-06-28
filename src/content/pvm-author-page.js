(function initAuthorPage(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};
  const authorPage = author.authorPage = author.authorPage || {};

  let enhancementTimer = null;
  let applyingEnhancements = false;

  // --- DOM 扫描：当前作者页作品卡片网格 ----------------------------------
  function getArtworkListContainer() {
    const entries = [];
    document.querySelectorAll('a[href*="/artworks/"]').forEach((anchor) => {
      if (anchor.closest("#pvm-author-panel")) return;
      const parsed = PVM.parsePixivUrl(anchor.href);
      if (!parsed || parsed.type !== "artwork") return;

      let node = anchor;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const parent = node.parentElement;
        if (!parent || parent.closest("#pvm-author-panel")) continue;
        const siblingCount = Array.from(parent.children).filter((child) => {
          if (child.matches?.('a[href*="/artworks/"]')) return true;
          return child.querySelector?.('a[href*="/artworks/"]');
        }).length;
        if (siblingCount >= 4) {
          entries.push({ id: parsed.id, anchor, card: node, parent });
          return;
        }
      }
    });

    const groups = new Map();
    entries.forEach((entry) => {
      const group = groups.get(entry.parent) || [];
      group.push(entry);
      groups.set(entry.parent, group);
    });

    let best = null;
    groups.forEach((group, parent) => {
      if (!best || group.length > best.entries.length) best = { parent, entries: group };
    });
    return best;
  }

  function getEntryImage(entry) {
    return entry?.card?.querySelector?.("img") || entry?.anchor?.querySelector?.("img") || null;
  }

  // --- 原始属性记忆 / 恢复 -----------------------------------------------
  function rememberOriginalAttribute(node, attribute) {
    const property = attribute.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const valueKey = `pvmOriginal${property[0].toUpperCase()}${property.slice(1)}`;
    const hadKey = `pvmOriginalHad${property[0].toUpperCase()}${property.slice(1)}`;
    if (node.dataset[hadKey] !== undefined) return;
    node.dataset[valueKey] = node.getAttribute(attribute) || "";
    node.dataset[hadKey] = node.hasAttribute(attribute) ? "true" : "false";
  }

  function restoreOriginalAttribute(node, attribute) {
    const property = attribute.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const valueKey = `pvmOriginal${property[0].toUpperCase()}${property.slice(1)}`;
    const hadKey = `pvmOriginalHad${property[0].toUpperCase()}${property.slice(1)}`;
    if (node.dataset[hadKey] === "true") {
      node.setAttribute(attribute, node.dataset[valueKey] || "");
    } else {
      node.removeAttribute(attribute);
    }
    delete node.dataset[valueKey];
    delete node.dataset[hadKey];
  }

  function getResponsiveSources(img) {
    const picture = img.closest("picture");
    return picture ? Array.from(picture.querySelectorAll("source")) : [];
  }

  function rememberOriginalImage(img) {
    if (!img || img.dataset.pvmOriginalImageStored === "true") return;
    img.dataset.pvmOriginalImageStored = "true";
    ["src", "srcset", "sizes", "data-src", "data-srcset"].forEach((attribute) => {
      rememberOriginalAttribute(img, attribute);
    });
    getResponsiveSources(img).forEach((source) => {
      source.dataset.pvmHighResSourceTouched = "true";
      ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
        rememberOriginalAttribute(source, attribute);
      });
    });
  }

  function restoreHighResSource(source) {
    if (!source || source.dataset.pvmHighResSourceTouched !== "true") return;
    ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
      restoreOriginalAttribute(source, attribute);
    });
    delete source.dataset.pvmHighResSourceTouched;
  }

  function restoreHighResImage(img) {
    if (!img || img.dataset.pvmHighResImageApplied !== "true") return;
    getResponsiveSources(img).forEach(restoreHighResSource);
    ["src", "srcset", "sizes", "data-src", "data-srcset"].forEach((attribute) => {
      restoreOriginalAttribute(img, attribute);
    });
    delete img.dataset.pvmHighResImageApplied;
    delete img.dataset.pvmHighResImageUrl;
    delete img.dataset.pvmOriginalImageStored;
  }

  function restoreUserArtworkCardImages(root = document) {
    root.querySelectorAll?.('img[data-pvm-high-res-image-applied="true"]').forEach(restoreHighResImage);
    root.querySelectorAll?.('source[data-pvm-high-res-source-touched="true"]').forEach(restoreHighResSource);
  }

  // --- 高清缩略图替换 -----------------------------------------------------
  async function ensureHighResUrlsForEntry(entry, quality) {
    const state = author.getState();
    const work = state.workMap[entry.id];
    if (!work) return null;
    if (author.resolveQualityUrl(work.urls, quality)) return work.urls;

    const urls = await author.fetchHighResUrls(entry.id);
    if (!urls || Object.keys(urls).length === 0) return work.urls || null;
    state.workMap[entry.id] = {
      ...work,
      urls: { ...(work.urls || {}), ...urls }
    };
    return state.workMap[entry.id].urls;
  }

  function applyHighResImageToEntry(entry, displaySettings) {
    const state = author.getState();
    const quality = displaySettings.highResQuality;
    const work = state.workMap[entry.id];
    if (!work) return;
    const highResImage = author.pickHighResImage(work, quality);
    if (!highResImage) return;

    const img = getEntryImage(entry);
    if (!img || img.closest("#pvm-author-panel")) return;

    const highResImageSet = author.pickHighResImageSet(work, quality) || `${highResImage} 1x, ${highResImage} 2x`;
    const alreadyApplied = img.dataset.pvmHighResImageUrl === highResImage
      && img.getAttribute("src") === highResImage
      && img.getAttribute("srcset") === highResImageSet;
    if (alreadyApplied) return;

    rememberOriginalImage(img);
    img.dataset.pvmHighResImageApplied = "true";
    img.dataset.pvmHighResImageUrl = highResImage;
    img.setAttribute("src", highResImage);
    img.setAttribute("srcset", highResImageSet);
    img.setAttribute("data-src", highResImage);
    img.setAttribute("data-srcset", highResImageSet);
    img.removeAttribute("sizes");
    getResponsiveSources(img).forEach((source) => {
      source.dataset.pvmHighResSourceTouched = "true";
      ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
        rememberOriginalAttribute(source, attribute);
      });
      source.setAttribute("srcset", highResImageSet);
      source.setAttribute("data-srcset", highResImageSet);
      source.removeAttribute("sizes");
    });
  }

  // --- 网格列数 / 缩放 ----------------------------------------------------
  function applyUserArtworkGrid(container, displaySettings) {
    const columns = displaySettings.gridColumns;
    const scale = Math.max(1, author.HOME_GRID_MAX_COLUMNS / columns);
    document.documentElement.style.setProperty("--pvm-author-home-columns", String(columns));
    document.documentElement.style.setProperty("--pvm-author-home-scale", String(scale));
    document.querySelectorAll(`.${author.HOME_GRID_CLASS}`).forEach((node) => {
      if (node !== container?.parent) {
        node.classList.remove(author.HOME_GRID_CLASS);
        node.style.removeProperty("grid-template-columns");
        node.style.removeProperty("justify-content");
        node.style.removeProperty("align-items");
        if (node.dataset.pvmOriginalDisplay !== undefined) {
          if (node.dataset.pvmOriginalDisplay) {
            node.style.display = node.dataset.pvmOriginalDisplay;
          } else {
            node.style.removeProperty("display");
          }
          delete node.dataset.pvmOriginalDisplay;
        }
      }
    });

    if (!container?.parent || container.entries.length < 4) return;

    const parent = container.parent;
    parent.classList.add(author.HOME_GRID_CLASS);
    const display = getComputedStyle(parent).display;
    if (!display.includes("grid")) {
      if (parent.dataset.pvmOriginalDisplay === undefined) {
        parent.dataset.pvmOriginalDisplay = parent.style.display || "";
      }
      parent.style.display = "grid";
    }
  }

  // --- 清理 ---------------------------------------------------------------
  function clearUserArtworkPageEnhancements() {
    if (author.hover) author.hover.clearHoverPreview();
    restoreUserArtworkCardImages();
    document.documentElement.style.removeProperty("--pvm-author-home-columns");
    document.documentElement.style.removeProperty("--pvm-author-home-scale");
    document.querySelectorAll(`.${author.HOME_GRID_CLASS}`).forEach((node) => {
      node.classList.remove(author.HOME_GRID_CLASS);
      if (node.dataset.pvmOriginalDisplay !== undefined) {
        if (node.dataset.pvmOriginalDisplay) {
          node.style.display = node.dataset.pvmOriginalDisplay;
        } else {
          node.style.removeProperty("display");
        }
        delete node.dataset.pvmOriginalDisplay;
      }
    });
    document.querySelectorAll(`.${author.HOME_HIDDEN_CLASS}`).forEach((node) => {
      node.classList.remove(author.HOME_HIDDEN_CLASS);
    });
  }

  // --- 主入口：在作者页 / 作品页应用网格增强 ----------------------------
  async function applyUserArtworkPageEnhancements() {
    if (applyingEnhancements) return;
    const routeContext = author.getRouteContext();
    const routeType = routeContext?.type;
    if (routeType !== "userArtworks" && routeType !== "artwork") {
      clearUserArtworkPageEnhancements();
      return;
    }
    const displaySettings = author.getDisplaySettingsForRoute(routeContext);
    if (!displaySettings) {
      clearUserArtworkPageEnhancements();
      return;
    }

    applyingEnhancements = true;
    try {
      const container = getArtworkListContainer();
      const entries = container?.entries || [];
      // 作品页（相关作品）需要排除当前作品本身
      const currentArtworkId = routeType === "artwork" ? routeContext.artworkId : null;
      const filteredEntries = currentArtworkId
        ? entries.filter(({ id }) => id !== currentArtworkId)
        : entries;
      const entryIds = Array.from(new Set(filteredEntries.map(({ id }) => id)));
      applyUserArtworkGrid(container, displaySettings);
      if (author.hover) author.hover.applyHoverPreviewBindings(filteredEntries);

      const minPageCount = displaySettings.minPageCount;
      const useHighResThumbnails = displaySettings.useHighResThumbnails;
      // 相关作品作者各异，需要按 id 单拉详情，避免命中错误的 userId 批量接口。
      const perId = routeType === "artwork";
      if (minPageCount > 1 || useHighResThumbnails) {
        await author.ensureDetailsForIds(entryIds, { requireHighRes: useHighResThumbnails, perId });
      }

      if (useHighResThumbnails) {
        const highResQuality = displaySettings.highResQuality;
        if (highResQuality === "medium" || highResQuality === "original") {
          await Promise.all(filteredEntries.map((entry) => ensureHighResUrlsForEntry(entry, highResQuality)));
        }
        filteredEntries.forEach((entry) => applyHighResImageToEntry(entry, displaySettings));
      } else {
        restoreUserArtworkCardImages();
      }

      if (minPageCount <= 1) {
        filteredEntries.forEach(({ card }) => card.classList.remove(author.HOME_HIDDEN_CLASS));
        document.querySelectorAll(`.${author.HOME_HIDDEN_CLASS}`).forEach((node) => node.classList.remove(author.HOME_HIDDEN_CLASS));
        return;
      }

      const state = author.getState();
      filteredEntries.forEach(({ id, card }) => {
        const pageCount = state.workMap[id]?.pageCount;
        if (!Number.isFinite(Number(pageCount))) {
          card.classList.remove(author.HOME_HIDDEN_CLASS);
          return;
        }
        card.classList.toggle(author.HOME_HIDDEN_CLASS, Number(pageCount) < minPageCount);
      });
    } catch (error) {
      console.warn("[PVM] Failed to apply page enhancements.", error);
    } finally {
      applyingEnhancements = false;
    }
  }

  function scheduleUserArtworkEnhancements(delay = 120) {
    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(() => {
      applyUserArtworkPageEnhancements().catch(console.error);
    }, delay);
  }

  authorPage.getArtworkListContainer = getArtworkListContainer;
  authorPage.applyUserArtworkPageEnhancements = applyUserArtworkPageEnhancements;
  authorPage.scheduleUserArtworkEnhancements = scheduleUserArtworkEnhancements;
  authorPage.clearUserArtworkPageEnhancements = clearUserArtworkPageEnhancements;
})(globalThis);
