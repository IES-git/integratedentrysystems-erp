import { describe, expect, it } from 'vitest';
// The worker owns the XLSX runtime because workbook ingestion executes there.
// @ts-expect-error worker-local package has no root-project declaration mapping
import * as XLSX from '../../services/price-book-worker/node_modules/xlsx/xlsx.mjs';
import {
  auditPriceBookSource,
  summarizeSourceAudit,
} from '../../services/price-book-worker/src/source-audit.js';

function workbookBytes(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function minimalHardwareWorkbook(): Uint8Array {
  return workbookBytes({
    'Product Master': [['product_id', 'import_status'], ['P1', 'READY']],
    'Price Records': [[
      'price_id', 'product_id', 'price_status', 'recommended_net_unit', 'conflict_flag',
    ], ['PR1', 'P1', 'PRICED', 10, false]],
    'Ingestion View': [['import_ready', 'price_id'], [true, 'PR1']],
    'Product Attributes': [['attribute_id'], ['A1']],
    'Prep Crosswalk': [['subcategory_id'], ['S1']],
    'QA Issues': [['issue_id']],
  });
}

describe('source audit', () => {
  it('runs the production hardware preflight and distinguishes alias from exact identity', async () => {
    const result = await auditPriceBookSource({
      bytes: minimalHardwareWorkbook(),
      fileName: 'Hardware_Normalized_Ingestion_Master.xlsx',
    });
    expect(result).toMatchObject({
      profileKey: 'hardware-normalized-master',
      sourceIdentity: 'profile_alias',
      workbookKind: 'hardware_normalized_workbook',
      verificationPassed: true,
      productionReady: true,
    });
    expect(result.preflight).toMatchObject({
      valid: true,
      products: 1,
      prices: 1,
      approvedPrices: 1,
    });
  });

  it('rejects an arbitrary workbook that matches neither normalized contract', async () => {
    const result = await auditPriceBookSource({
      bytes: workbookBytes({ Sheet1: [['hello'], ['world']] }),
      fileName: 'unknown.xlsx',
    });
    expect(result.verificationPassed).toBe(false);
    expect(result.productionReady).toBe(false);
    expect(result.errors.join(' ')).toContain('does not match');
  });

  it('allows verified source evidence without counting it as a production input', () => {
    const report = summarizeSourceAudit([
      {
        role: 'source_evidence',
        sourceIdentity: 'exact_sha256',
        verificationPassed: true,
        productionReady: false,
      },
      {
        role: 'production_input',
        sourceIdentity: 'exact_sha256',
        verificationPassed: true,
        productionReady: true,
      },
    ] as never[], '2026-06-21T00:00:00.000Z');
    expect(report).toMatchObject({
      passed: true,
      sourceCount: 2,
      productionInputCount: 1,
      productionReadyCount: 1,
      evidenceSourceCount: 1,
    });
  });
});
