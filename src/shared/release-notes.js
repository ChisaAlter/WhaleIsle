'use strict';

(() => {
// Shared by the main-owned update dialog and the launcher's release details.
// Release bodies remain plain reading text; no HTML is interpreted.
  function plainReleaseNotes(body) {
    return String(body || '')
    .replace(/<\/?(?:details|summary)>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  }

  // Published releases put the English translation in one folded section.
  // Split before stripping markup so the two complete translations stay apart.
  function releaseNotesTabs(body) {
    const source = String(body || '');
    const english = /<details>\s*<summary>\s*English\s*<\/summary>([\s\S]*?)<\/details>/i.exec(source);
    if (!english) return [];
    const chineseText = plainReleaseNotes(source.slice(0, english.index) + source.slice(english.index + english[0].length));
    const englishText = plainReleaseNotes(english[1]);
    if (!chineseText || !englishText) return [];
    return [
      { id: 'zh-CN', label: '中文', text: chineseText },
      { id: 'en', label: 'English', text: englishText },
    ];
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { plainReleaseNotes, releaseNotesTabs };
  }
  if (typeof window !== 'undefined') {
    window.releaseNotes = { plainReleaseNotes, releaseNotesTabs };
  }
})();
