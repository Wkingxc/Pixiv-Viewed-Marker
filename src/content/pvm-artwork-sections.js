// 作品页区块控制：根据设置隐藏"作者其他作品横幅"和"评论区"。
// 只在 /artworks/{id} 路由生效。
(function initArtworkSections(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};
  const artworkSections = author.artworkSections = author.artworkSections || {};

  const HIDDEN_AUTHOR_WORKS_CLASS = "pvm-hidden-author-works-banner";
  const HIDDEN_COMMENTS_CLASS = "pvm-hidden-comments-section";
  const COMMENT_TITLE_PATTERN = /^(コメント|comments?|评论|評論|댓글)$/i;

  function clearAll() {
    document.querySelectorAll(`.${HIDDEN_AUTHOR_WORKS_CLASS}`).forEach((node) => {
      node.classList.remove(HIDDEN_AUTHOR_WORKS_CLASS);
    });
    document.querySelectorAll(`.${HIDDEN_COMMENTS_CLASS}`).forEach((node) => {
      node.classList.remove(HIDDEN_COMMENTS_CLASS);
    });
  }

  // 作者其他作品横幅的稳定特征（与 Pixiv 的动态 class 无关）：
  //   - 含一个 <h2>，里面是 <a href="/users/{userId}">（作者用户名/头像区域，标题级链接）
  //   - 同一容器里有多张 data-ga4-label="thumbnail_link" 且 data-gtm-user-id="{userId}" 的缩略图链接
  //   - 整页只有这一个横幅
  // 主作品所在区块带 <h1>（作品标题），用来排除外层包装。
  function findAuthorWorksBanner(authorUserId, currentArtworkId) {
    if (!authorUserId) return null;
    const main = document.querySelector("main") || document.body;
    // 锚点：作者用户名的 <a> 一定包在 <h2> 里
    const headings = main.querySelectorAll("h2");
    for (const heading of headings) {
      const authorAnchor = heading.querySelector(`a[href^="/users/${authorUserId}"]`);
      if (!authorAnchor) continue;

      // 从 h2 向上找：第一个同时包含 ≥ 3 张该作者缩略图、且不含 <h1> 的祖先
      let node = heading.parentElement;
      let banner = null;
      while (node && node !== main && node !== document.body) {
        if (node.querySelector("h1")) break;

        const thumbs = node.querySelectorAll(
          `a[data-ga4-label="thumbnail_link"][data-gtm-user-id="${authorUserId}"]`
        );
        const others = new Set();
        thumbs.forEach((anchor) => {
          const match = (anchor.getAttribute("href") || "").match(/\/artworks\/(\d+)/);
          if (match && match[1] !== currentArtworkId) others.add(match[1]);
        });

        if (others.size >= 3) {
          banner = node;
          break;
        }
        node = node.parentElement;
      }
      if (banner) return banner;
    }
    return null;
  }

  function findCommentsSection() {
    const candidates = document.querySelectorAll("main section, main aside");
    for (const section of candidates) {
      if (section.closest("#pvm-author-panel")) continue;
      const heading = section.querySelector("h1, h2, h3");
      if (!heading) continue;
      const text = (heading.textContent || "").trim();
      if (COMMENT_TITLE_PATTERN.test(text)) return section;
    }
    return null;
  }

  function applyArtworkSections() {
    const routeContext = author.getRouteContext();
    if (routeContext?.type !== "artwork") {
      clearAll();
      return;
    }
    const settings = author.getSettings();
    const hideAuthorWorks = settings.artworkPageHideAuthorWorks === true;
    const hideComments = settings.artworkPageHideComments === true;

    // 作者横幅
    if (hideAuthorWorks) {
      const state = author.getState();
      const banner = findAuthorWorksBanner(state.userId, routeContext.artworkId);
      if (banner && !banner.classList.contains(HIDDEN_AUTHOR_WORKS_CLASS)) {
        banner.classList.add(HIDDEN_AUTHOR_WORKS_CLASS);
      }
    } else {
      document.querySelectorAll(`.${HIDDEN_AUTHOR_WORKS_CLASS}`).forEach((node) => {
        node.classList.remove(HIDDEN_AUTHOR_WORKS_CLASS);
      });
    }

    // 评论区
    if (hideComments) {
      const section = findCommentsSection();
      if (section && !section.classList.contains(HIDDEN_COMMENTS_CLASS)) {
        section.classList.add(HIDDEN_COMMENTS_CLASS);
      }
    } else {
      document.querySelectorAll(`.${HIDDEN_COMMENTS_CLASS}`).forEach((node) => {
        node.classList.remove(HIDDEN_COMMENTS_CLASS);
      });
    }
  }

  let scheduleTimer = null;
  function scheduleApply(delay = 120) {
    window.clearTimeout(scheduleTimer);
    scheduleTimer = window.setTimeout(() => {
      try { applyArtworkSections(); }
      catch (error) { console.warn("[PVM] Failed to apply artwork section toggles.", error); }
    }, delay);
  }

  artworkSections.HIDDEN_AUTHOR_WORKS_CLASS = HIDDEN_AUTHOR_WORKS_CLASS;
  artworkSections.HIDDEN_COMMENTS_CLASS = HIDDEN_COMMENTS_CLASS;
  artworkSections.apply = applyArtworkSections;
  artworkSections.scheduleApply = scheduleApply;
  artworkSections.clear = clearAll;
})(globalThis);
