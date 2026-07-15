import { describe, expect, it } from 'vitest';
import { parseEnumOptions } from '@/lib/cpq-catalog-api';

describe('parseEnumOptions', () => {
  it('expands the legacy STC and gasket shorthand into separate choices', () => {
    expect(parseEnumOptions(
      'OPN-019',
      'Enum',
      'STC35/37/42/44/45/46/48/52; gasket A/B',
    )).toEqual([
      'STC35',
      'STC37',
      'STC42',
      'STC44',
      'STC45',
      'STC46',
      'STC48',
      'STC52',
      'gasket A',
      'gasket B',
    ]);
  });

  it('keeps the normalized semicolon-separated STC ratings unchanged', () => {
    expect(parseEnumOptions('OPN-019', 'Enum', '35; 37; 42; 44')).toEqual([
      '35',
      '37',
      '42',
      '44',
    ]);
  });

  it('keeps the canonical explicit STC and gasket choices unchanged', () => {
    expect(parseEnumOptions(
      'OPN-019',
      'Enum',
      'STC35; STC37; gasket A; gasket B',
    )).toEqual(['STC35', 'STC37', 'gasket A', 'gasket B']);
  });

  it('does not split meaningful slashes on other fields', () => {
    expect(parseEnumOptions('OPN-014', 'Enum', 'WHI/Intertek; UL; other')).toEqual([
      'WHI/Intertek',
      'UL',
      'other',
    ]);
  });
});
