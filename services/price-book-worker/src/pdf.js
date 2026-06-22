import { PDFDocument } from 'pdf-lib';

/** Read the actual physical page count from PDF bytes. */
export async function getPdfPageCount(bytes) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return source.getPageCount();
}

/**
 * Parse a catalog page hint into a one-based inclusive range.
 * Spreadsheet row hints intentionally return null.
 */
export function parsePageRange(pageHint) {
  const text = String(pageHint ?? '').trim();
  if (!text || /\bsheet\b/i.test(text)) return null;
  const physical = text.match(/\b(?:physical|pdf)\s*(?:p{1,2}\.?|pages?)?\s*#?\s*(\d{1,4})(?:\s*(?:[-–—]|to)\s*(\d{1,4}))?/i);
  const explicit = text.match(/\b(?:p{1,2}\.?|pages?)\s*#?\s*(\d{1,4})(?:\s*(?:[-–—]|to)\s*(\d{1,4}))?/i);
  const plain = text.match(/^\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*$/);
  const match = physical ?? explicit ?? plain;
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;
  return { start, end };
}

/**
 * Copy a small page window around a table hint. The padding tolerates cover/
 * front-matter offsets and slightly imprecise catalog hints while keeping the
 * extraction model focused on one printed table instead of a 100+ page book.
 */
export async function slicePdfToPageHint(bytes, pageHint, padding = 2, maxPages = 12) {
  const requested = parsePageRange(pageHint);
  if (!requested) return null;

  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (pageCount === 0) return null;

  let start = Math.max(1, requested.start - padding);
  let end = Math.min(pageCount, requested.end + padding);
  if (end - start + 1 > maxPages) end = start + maxPages - 1;
  if (start > pageCount) return null;

  const output = await PDFDocument.create();
  const indexes = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const copied = await output.copyPages(source, indexes);
  for (const page of copied) output.addPage(page);
  const slicedBytes = await output.save();

  return {
    bytes: new Uint8Array(slicedBytes),
    sourceStartPage: start,
    sourceEndPage: end,
    sourcePageCount: pageCount,
  };
}
