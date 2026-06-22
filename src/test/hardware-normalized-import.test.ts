import { describe, expect, it } from 'vitest';
import * as XLSX from '../../services/price-book-worker/node_modules/xlsx/xlsx.mjs';
import {
  isNormalizedHardwareWorkbook,
  normalizedPriceReviewStatus,
  summarizeNormalizedHardwareWorkbook,
} from '../../services/price-book-worker/src/hardware.js';

function normalizedWorkbook() {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  add('Product Master', [
    ['Title'],
    ['product_id', 'import_status', 'category_id', 'subcategory_id', 'description', 'data_confidence'],
    ['HWP-1', 'READY', 'hinges', 'butt_hinge', 'Ready hinge', 'HIGH'],
    ['HWP-2', 'REVIEW', 'locks', 'cylindrical_lock', 'Review lock', 'LOW'],
  ]);
  add('Price Records', [
    ['Title'],
    ['price_id', 'product_id', 'price_status', 'list_unit_price', 'discount_multiplier', 'computed_net_unit', 'recommended_net_unit', 'conflict_flag', 'uom'],
    ['HPR-1', 'HWP-1', 'PRICED', 100, 0.4, 40, 40, false, 'EA'],
    ['HPR-2', 'HWP-2', 'REVIEW_CONFLICT', 100, 0.4, 40, null, true, 'EA'],
  ]);
  add('Ingestion View', [
    ['import_ready', 'price_id'],
    [true, 'HPR-1'],
    [false, 'HPR-2'],
  ]);
  add('Product Attributes', [
    ['attribute_id', 'product_id', 'attribute_name', 'attribute_value'],
    ['A-1', 'HWP-1', 'finish_code', '630'],
  ]);
  add('Prep Crosswalk', [
    ['subcategory_id', 'selection_cue', 'door_prep', 'frame_prep'],
    ['butt_hinge', 'standard', '450--', '450--'],
  ]);
  add('QA Issues', [
    ['issue_id', 'severity'],
    ['Q-1', 'WARNING'],
  ]);
  return wb;
}

describe('normalized hardware master importer', () => {
  it('detects and summarizes the normalized relational workbook', () => {
    const wb = normalizedWorkbook();
    expect(isNormalizedHardwareWorkbook(wb)).toBe(true);
    expect(summarizeNormalizedHardwareWorkbook(wb)).toMatchObject({
      valid: true,
      products: 2,
      prices: 2,
      approvedPrices: 1,
      reviewPrices: 1,
      attributes: 1,
      prepCrosswalk: 1,
      workbookQaIssues: 1,
    });
  });

  it('approves only READY, PRICED, conflict-free rows with a positive net', () => {
    const ready = { import_status: 'READY' };
    expect(normalizedPriceReviewStatus(ready, {
      price_status: 'PRICED',
      recommended_net_unit: 40,
      conflict_flag: false,
    }, true)).toBe('APPROVED');
    expect(normalizedPriceReviewStatus({ import_status: 'REVIEW' }, {
      price_status: 'PRICED',
      recommended_net_unit: 40,
      conflict_flag: false,
    }, false)).toBe('NEEDS_REVIEW');
    expect(normalizedPriceReviewStatus(ready, {
      price_status: 'PRICED',
      recommended_net_unit: null,
      computed_net_unit: 0,
      conflict_flag: false,
    }, true)).toBe('NEEDS_REVIEW');
  });
});
