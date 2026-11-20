// Text pdf-lib's standard fonts can draw: they encode WinAnsi only, and throw on
// anything else. Accents are folded, smart quotes and dashes made plain, and
// whatever is left over becomes '?'. Moved here from lib/background-report-export.ts
// so a light module can use it without that one's dependencies.
export function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}
