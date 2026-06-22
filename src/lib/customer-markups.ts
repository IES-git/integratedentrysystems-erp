export type MarkupTargetType = 'category' | 'subcategory' | 'item' | 'legacy';

export interface MarkupCategoryOption {
  key: string;
  type: 'category';
  slug: string;
  label: string;
  itemCount: number;
  subcategoryCount: number;
}

export interface MarkupSubcategoryOption {
  key: string;
  type: 'subcategory';
  categorySlug: string;
  slug: string;
  label: string;
  itemCount: number;
}

export interface MarkupItemOption {
  key: string;
  type: 'item';
  categorySlug: string;
  subcategorySlug: string | null;
  canonicalCode: string;
  label: string;
  usageCount: number;
}

export interface MarkupTargetCatalog {
  categories: MarkupCategoryOption[];
  subcategories: MarkupSubcategoryOption[];
  items: MarkupItemOption[];
}

export interface MarkupItemLike {
  itemLabel?: string | null;
  canonicalCode?: string | null;
  itemType?: string | null;
  subcategory?: string | null;
  chargeCategory?: string | null;
}

export interface MarkupOverrideMatch {
  key: string;
  value: number;
  type: MarkupTargetType;
}

interface ParsedTargetKey {
  type: MarkupTargetType;
  categorySlug?: string;
  subcategorySlug?: string;
  canonicalCode?: string;
}

const CATEGORY_ALIASES: Record<string, string> = {
  doors: 'door',
  frames: 'frame',
  panels: 'panel',
  lites_louvers_glass: 'lite_kit',
};

const COMPATIBLE_CATEGORY_KEYS: Record<string, string[]> = {
  door: ['doors'],
  frame: ['frames'],
  panel: ['panels'],
  lite_kit: ['lites_louvers_glass'],
  louver: ['lites_louvers_glass'],
  glass: ['lites_louvers_glass'],
  glazing_tape: ['lites_louvers_glass'],
};

const MARKUP_KEY_PREFIXES = ['category:', 'subcategory:', 'item:'];
const HARDWARE_LABEL_PATTERN =
  /\b(anchor|bolt|closer|cylinder|deadbolt|exit|flush|hinge|holder|kick|latch|lock|panic|pull|push|seal|silencer|sweep|threshold|weatherstrip)\b/i;

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

export function categoryMarkupKey(slug: string): string {
  return `category:${normalizeKeyPart(slug)}`;
}

export function subcategoryMarkupKey(categorySlug: string, subcategorySlug: string): string {
  return `subcategory:${normalizeKeyPart(categorySlug)}:${normalizeKeyPart(subcategorySlug)}`;
}

export function itemMarkupKey(canonicalCode: string): string {
  return `item:${canonicalCode.trim()}`;
}

export function isStructuredMarkupTargetKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return MARKUP_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function humanizeMarkupToken(value: string): string {
  return value
    .replace(/^hardware-/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeMarkupCategory(
  itemType?: string | null,
  subcategory?: string | null,
): string | null {
  const raw = itemType?.trim().toLowerCase();
  const aliased = raw ? CATEGORY_ALIASES[raw] ?? raw : null;

  if (subcategory && (!aliased || aliased === 'hardware' || aliased.startsWith('hardware-'))) {
    return 'hardware';
  }
  if (aliased?.startsWith('hardware-')) return 'hardware';
  return aliased;
}

export function inferMarkupCategoryFromLabel(label?: string | null): string | null {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) return null;
  if (HARDWARE_LABEL_PATTERN.test(normalized)) return 'hardware';
  if (normalized.includes('frame')) return 'frame';
  if (normalized.includes('louver')) return 'louver';
  if (normalized.includes('glass')) return 'glass';
  if (normalized.includes('lite')) return 'lite_kit';
  if (normalized.includes('door')) return 'door';
  return null;
}

function uniqueCandidates(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function parseMarkupTargetKey(key: string): ParsedTargetKey {
  const trimmed = key.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized.startsWith('category:')) {
    return { type: 'category', categorySlug: normalizeKeyPart(trimmed.slice('category:'.length)) };
  }

  if (normalized.startsWith('subcategory:')) {
    const parts = trimmed.slice('subcategory:'.length).split(':');
    return {
      type: 'subcategory',
      categorySlug: normalizeKeyPart(parts[0] ?? ''),
      subcategorySlug: normalizeKeyPart(parts.slice(1).join(':')),
    };
  }

  if (normalized.startsWith('item:')) {
    return { type: 'item', canonicalCode: trimmed.slice('item:'.length).trim() };
  }

  return { type: 'legacy' };
}

export function getMarkupTargetLabel(key: string, catalog?: MarkupTargetCatalog): string {
  const found =
    catalog?.categories.find((target) => target.key.toLowerCase() === key.toLowerCase()) ??
    catalog?.subcategories.find((target) => target.key.toLowerCase() === key.toLowerCase()) ??
    catalog?.items.find((target) => target.key.toLowerCase() === key.toLowerCase());

  if (found) {
    if (found.type === 'item') return found.label;
    return `${found.label}`;
  }

  const parsed = parseMarkupTargetKey(key);
  if (parsed.type === 'category' && parsed.categorySlug) {
    return `${humanizeMarkupToken(parsed.categorySlug)}`;
  }
  if (parsed.type === 'subcategory' && parsed.subcategorySlug) {
    return `${humanizeMarkupToken(parsed.subcategorySlug)}`;
  }
  if (parsed.type === 'item' && parsed.canonicalCode) {
    return parsed.canonicalCode;
  }
  return key;
}

export function getMarkupTargetKindLabel(key: string): string {
  const type = parseMarkupTargetKey(key).type;
  if (type === 'category') return 'Category';
  if (type === 'subcategory') return 'Subcategory';
  if (type === 'item') return 'Item';
  return 'Legacy';
}

export function getMarkupOverrideMatch(
  overrides: Record<string, number>,
  item: MarkupItemLike,
): MarkupOverrideMatch | undefined {
  const entries = Object.entries(overrides).map(([key, value]) => ({
    key,
    keyLower: key.trim().toLowerCase(),
    value,
    parsed: parseMarkupTargetKey(key),
  }));

  const findByKey = (candidate: string, type: MarkupTargetType): MarkupOverrideMatch | undefined => {
    const normalized = candidate.trim().toLowerCase();
    const found = entries.find((entry) => entry.keyLower === normalized);
    return found ? { key: found.key, value: found.value, type } : undefined;
  };

  const code = item.canonicalCode?.trim();
  if (code) {
    const structuredItem = findByKey(itemMarkupKey(code), 'item');
    if (structuredItem) return structuredItem;
  }

  const codeLower = code?.toLowerCase();
  const labelLower = item.itemLabel?.trim().toLowerCase();
  const legacyItem = entries.find((entry) => {
    if (entry.parsed.type !== 'legacy') return false;
    return entry.keyLower === codeLower || (!!labelLower && entry.keyLower === labelLower);
  });
  if (legacyItem) return { key: legacyItem.key, value: legacyItem.value, type: 'legacy' };

  const primaryCategorySlug =
    normalizeMarkupCategory(item.itemType, item.subcategory) ??
    inferMarkupCategoryFromLabel(item.itemLabel);
  const categorySlugs = uniqueCandidates([
    primaryCategorySlug,
    ...(primaryCategorySlug ? COMPATIBLE_CATEGORY_KEYS[primaryCategorySlug] ?? [] : []),
  ]);
  const subcategorySlugs = uniqueCandidates([item.subcategory, item.chargeCategory]);

  for (const subcategorySlug of subcategorySlugs) {
    const subcategoryCandidates = [
      ...categorySlugs.map((categorySlug) => subcategoryMarkupKey(categorySlug, subcategorySlug)),
      subcategoryMarkupKey('hardware', subcategorySlug),
    ].filter((candidate): candidate is string => !!candidate);

    for (const candidate of subcategoryCandidates) {
      const match = findByKey(candidate, 'subcategory');
      if (match) return match;
    }
  }

  for (const categorySlug of categorySlugs) {
    const category = findByKey(categoryMarkupKey(categorySlug), 'category');
    if (category) return category;
  }

  if (subcategorySlugs.length > 0) {
    return findByKey(categoryMarkupKey('hardware'), 'category');
  }

  return undefined;
}
