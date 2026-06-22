import { describe, expect, it } from 'vitest';
import * as XLSX from '../../services/price-book-worker/node_modules/xlsx/xlsx.mjs';
import { summarizeNgpWorkbook } from '../../services/price-book-worker/src/ngp.js';

function ngpWorkbook() {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  add('Products', [
    ['product_id', 'category', 'model'],
    ['P1', 'LITE_KIT', 'KIT-1'],
    ['P2', 'LOUVER', 'LOUVER-1'],
    ['P3', 'GLASS', 'GLASS-1'],
    ['P4', 'GLAZING_ACCESSORY', 'TAPE-1'],
  ]);
  add('Product Attributes', [['attribute_id', 'product_id'], ['A1', 'P1']]);
  add('Kit Glass Capacity', [['capacity_id', 'kit_model'], ['C1', 'KIT-1']]);
  add('Glass Ratings', [['rating_id', 'glass_model'], ['R1', 'GLASS-1']]);
  add('Size Rules', [['size_rule_id', 'model_or_family'], ['S1', 'KIT-1']]);
  add('Relationships', [['relationship_id', 'source_model'], ['REL1', 'KIT-1']]);
  add('Finish Codes', [['finish_code'], ['GPZ']]);
  add('Commercial Policies', [['policy_id'], ['POL1']]);
  add('Price Tables', [['price_table_id', 'entity_type'], ['PT1', 'LITE_KIT']]);
  add('Base Price Rules', [
    ['price_rule_id', 'price_table_id', 'order_width_in', 'order_height_in', 'list_price', 'source_page'],
    ['B1', 'PT1', 12, 12, 100, 'p. 1'],
  ]);
  add('Price Table Map', [['map_id', 'price_table_id', 'model'], ['M1', 'PT1', 'KIT-1']]);
  add('Direct Price Rules', [
    ['direct_rule_id', 'model', 'list_price', 'source_page'],
    ['D1', 'TAPE-1', 10, 'p. 2'],
  ]);
  add('Option Price Rules', [
    ['option_rule_id', 'option_code', 'amount', 'source_page'],
    ['O1', 'GPZ', 5, 'p. 3'],
  ]);
  add('Options Adders', [['option_id', 'option_code'], ['OA1', 'GPZ']]);
  return wb;
}

describe('NGP normalized workbook preflight', () => {
  it('validates table references, categories, rule IDs, and source pages', () => {
    expect(summarizeNgpWorkbook(ngpWorkbook())).toMatchObject({
      valid: true,
      products: 4,
      priceTables: 1,
      baseRules: 1,
      tableMaps: 1,
      directRules: 1,
      optionRules: 1,
      totalPricingRules: 3,
      missingSourcePages: 0,
    });
  });

  it('fails loudly when a required normalized sheet is missing', () => {
    const wb = ngpWorkbook();
    delete wb.Sheets['Base Price Rules'];
    wb.SheetNames = wb.SheetNames.filter((name) => name !== 'Base Price Rules');
    const result = summarizeNgpWorkbook(wb);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Base Price Rules');
  });
});
