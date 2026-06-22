import { describe, expect, it } from 'vitest';
import {
  canonicalizePageHint,
  parsePageRange,
} from '../../services/price-book-worker/src/pdf.js';
import { catalogTableIdentity } from '../../services/price-book-worker/src/jobs.js';

describe('price-book catalog physical-page identity', () => {
  it('canonicalizes equivalent physical page labels', () => {
    expect(canonicalizePageHint('14')).toBe('PDF p. 14');
    expect(canonicalizePageHint('p. 14')).toBe('PDF p. 14');
    expect(canonicalizePageHint('PDF p. 14')).toBe('PDF p. 14');
    expect(canonicalizePageHint('physical pages 14-16')).toBe('PDF pp. 14-16');
  });

  it('deduplicates title/location pairs even when Gemini changes page-label format', () => {
    const plain = catalogTableIdentity({
      title: 'H SERIES - LOCKSEAM EDGE - GLUED CORE',
      page_hint: '14',
    });
    const explicit = catalogTableIdentity({
      title: '  H SERIES - LOCKSEAM EDGE - GLUED CORE  ',
      page_hint: 'PDF p. 14',
    });
    expect(plain).toBe(explicit);
  });

  it('keeps the same heading on different physical pages distinct', () => {
    expect(catalogTableIdentity({ title: 'Material Selection', page_hint: 'PDF p. 29' }))
      .not.toBe(catalogTableIdentity({ title: 'Material Selection', page_hint: 'PDF p. 59' }));
  });

  it('preserves non-PDF spreadsheet locations', () => {
    expect(parsePageRange("Sheet 'Doors', row 3")).toBeNull();
    expect(canonicalizePageHint("Sheet 'Doors', row 3")).toBe("Sheet 'Doors', row 3");
  });
});
