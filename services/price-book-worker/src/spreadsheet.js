/**
 * Deterministic XLSX / CSV parser for price-book ingestion.
 *
 * Replaces the old approach of dumping raw CSV text into the Gemini prompt
 * (lossy, truncated at 80KB, no column structure). Instead:
 *   1. Parse every sheet in the workbook deterministically via SheetJS.
 *   2. Emit a structured JSON representation of each sheet's data.
 *   3. Pass that structured JSON to Gemini for classification/labelling only
 *      (not for number reading).
 *
 * For PDFs/images Gemini still reads numbers directly (no change).
 */

import * as XLSX from 'xlsx';
import { interpretGridCell } from './normalize.js';

/**
 * Parse bytes from an XLSX or CSV file into an array of sheet objects.
 * Each sheet has: { name, headers[], rows[][], preview (first 50 rows as TSV) }
 *
 * @param {Uint8Array} bytes
 * @param {'xlsx'|'csv'} fileType
 * @returns {{ name: string, headers: string[], rows: (string|number|null)[][], preview: string }[]}
 */
export function parseSpreadsheet(bytes, fileType) {
  let workbook;
  if (fileType === 'csv') {
    const csvText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    workbook = XLSX.read(csvText, { type: 'string', raw: false });
  } else {
    workbook = XLSX.read(bytes, { type: 'buffer', raw: false, cellDates: true });
  }

  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    // Convert to array-of-arrays; header row included
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

    if (!aoa || aoa.length === 0) continue;

    // First non-empty row as headers
    let headerRow = 0;
    while (headerRow < aoa.length && aoa[headerRow].every((c) => c === null || c === '')) {
      headerRow++;
    }
    if (headerRow >= aoa.length) continue;

    const headers = (aoa[headerRow] ?? []).map((c) => (c !== null && c !== undefined ? String(c).trim() : ''));
    const rows = aoa.slice(headerRow + 1).map((row) => {
      const r = Array.isArray(row) ? row : [];
      return headers.map((_, i) => {
        const v = r[i];
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        return String(v).trim() || null;
      });
    }).filter((r) => r.some((c) => c !== null));

    // TSV preview for the Gemini catalog prompt (first 50 rows, max 2000 chars per row)
    const previewRows = [headers.join('\t'), ...rows.slice(0, 50).map((r) => r.map((c) => (c ?? '')).join('\t'))];
    const preview = previewRows.map((r) => r.slice(0, 2000)).join('\n');

    sheets.push({ name: sheetName, headers, rows, preview });
  }

  return sheets;
}

/**
 * Given a parsed sheet and row/column indices from the AI's extraction output,
 * build an ExtractedGrid with real numeric prices read from the sheet data.
 *
 * The AI supplies column_labels, row_labels, and column/row INDICES into the
 * sheet's data (0-based). This function validates and maps them to cells.
 *
 * @param {{ headers: string[], rows: (string|number|null)[][] }} sheet
 * @param {{ colIndices: number[], rowIndices: number[] }} mapping
 * @returns {{ columnLabels: string[], rowLabels: string[], cells: {row,col,price}[] }}
 */
export function extractGridFromSheet(sheet, mapping) {
  const { colIndices, rowIndices } = mapping;
  const columnLabels = colIndices.map((i) => sheet.headers[i] ?? String(i));
  const rowLabels = [];
  const cells = [];

  for (let ri = 0; ri < rowIndices.length; ri++) {
    const sheetRow = sheet.rows[rowIndices[ri]];
    if (!sheetRow) continue;
    // First non-price column is the row label (column index before the first colIndex)
    const labelColIdx = Math.min(...colIndices) - 1;
    const label = labelColIdx >= 0 && sheetRow[labelColIdx] != null
      ? String(sheetRow[labelColIdx])
      : String(rowIndices[ri]);
    rowLabels.push(label);

    for (let ci = 0; ci < colIndices.length; ci++) {
      const raw = sheetRow[colIndices[ci]];
      const interpreted = interpretGridCell(raw);
      if (interpreted) cells.push({ row: ri, col: ci, ...interpreted });
    }
  }

  return { columnLabels, rowLabels, cells };
}
