(function initUrlParser(global) {
  const PVM = global.PVM || {};

  function toUrl(input) {
    try {
      return new URL(input, "https://www.pixiv.net");
    } catch (_error) {
      return null;
    }
  }

  function stripLocale(pathname) {
    return pathname.replace(/^\/(?:en|ja|zh|ko|zh-tw|zh-cn)(?=\/)/i, "");
  }

  function parsePixivUrl(input, options = {}) {
    const url = toUrl(input);
    if (!url) return null;

    const isPixivHost = /(^|\.)pixiv\.net$/i.test(url.hostname);
    if (!isPixivHost && url.hostname !== "") return null;

    const pathname = stripLocale(url.pathname);

    const artworkMatch = pathname.match(/^\/artworks\/(\d+)(?:\/|$)/);
    if (artworkMatch) {
      return {
        type: "artwork",
        id: artworkMatch[1],
        normalized: `/artworks/${artworkMatch[1]}`
      };
    }

    const userMatch = pathname.match(/^\/users\/(\d+)(?:\/|$)/);
    if (userMatch) {
      return {
        type: "user",
        id: userMatch[1],
        normalized: `/users/${userMatch[1]}`
      };
    }

    if (options.importBookmarkAddUrls && pathname === "/bookmark_add.php") {
      const illustId = url.searchParams.get("illust_id");
      const type = url.searchParams.get("type");
      if (type === "illust" && /^\d+$/.test(illustId || "")) {
        return {
          type: "artwork",
          id: illustId,
          normalized: `/artworks/${illustId}`
        };
      }
    }

    return null;
  }

  function normalizePixivPagePattern(input) {
    const url = toUrl(input);
    if (!url) return null;

    const isPixivHost = /(^|\.)pixiv\.net$/i.test(url.hostname);
    if (!isPixivHost && url.hostname !== "") return null;

    const pathname = stripLocale(url.pathname).replace(/\/+$/, "") || "/";
    return {
      id: pathname,
      pattern: pathname,
      label: pathname
    };
  }

  PVM.parsePixivUrl = parsePixivUrl;
  PVM.normalizePixivPagePattern = normalizePixivPagePattern;
  global.PVM = PVM;
})(globalThis);
