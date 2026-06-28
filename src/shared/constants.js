(function initConstants(global) {
  const PVM = global.PVM || {};

  PVM.SCHEMA_VERSION = 1;
  PVM.DEFAULT_COLOR = { r: 244, g: 118, b: 162, a: 1 };
  PVM.VIEWED_CLASS = "pvm-viewed-artwork";

  PVM.DEFAULT_SETTINGS = {
    artworkVisitedColor: PVM.DEFAULT_COLOR,
    markArtworkTitle: true,
    markArtworkImage: false,
    hideViewedArtwork: false,
    artworkImageOverlayOpacity: 0.28,
    authorPageGridColumns: 6,
    authorPageMinPageCount: 0,
    authorPageUseHighResThumbnails: false,
    authorPageHighResThumbnailQuality: "original",
    authorPageHoverPreviewEnabled: false,
    authorPageHoverPreviewQuality: "off",
    markUserName: false,
    importBookmarkAddUrls: false
  };

  PVM.DEFAULT_STATS = {
    lastHistoryImportAt: null,
    lastHistoryImportArtworkCount: 0,
    lastHistoryImportUserCount: 0
  };

  PVM.DEFAULT_EXCLUSIONS = {
    pages: {}
  };

  global.PVM = PVM;
})(globalThis);
