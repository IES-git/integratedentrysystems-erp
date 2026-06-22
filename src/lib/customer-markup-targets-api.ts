import { supabase } from './supabase';
import { loadBaseSignatures, loadHardwareCategories } from '@/lib/cpq-catalog-api';
import { loadNgpCatalog } from '@/lib/ngp-catalog-api';
import {
  categoryMarkupKey,
  humanizeMarkupToken,
  itemMarkupKey,
  subcategoryMarkupKey,
  type MarkupCategoryOption,
  type MarkupItemOption,
  type MarkupSubcategoryOption,
  type MarkupTargetCatalog,
} from './customer-markups';

const CATEGORY_LABELS: Record<string, string> = {
  door: 'Doors',
  frame: 'Frames',
  panel: 'Panels',
  specialty: 'Specialty',
  lite_kit: 'Lite Kits',
  louver: 'Louvers',
  glass: 'Glass',
  glazing_tape: 'Glazing Tape',
  prep: 'Preparations',
  hardware: 'Hardware',
  anchor: 'Anchors',
  packaging: 'Packaging',
  stick: 'Sticks',
};

const CATEGORY_ORDER = [
  'door',
  'frame',
  'panel',
  'lite_kit',
  'louver',
  'glass',
  'glazing_tape',
  'hardware',
  'prep',
  'anchor',
  'packaging',
  'stick',
  'specialty',
];

interface EngineRuleTargetRow {
  entity_type: string | null;
  charge_category: string | null;
  item_or_option_code: string | null;
  price_table?: { name?: string | null } | { name?: string | null }[] | null;
}

interface HardwareVariantTargetRow {
  id: string;
  sku: string | null;
  finish: string | null;
  function: string | null;
  size: string | null;
  hand: string | null;
  hardware_product: {
    category?: string | null;
    subcategory?: string | null;
    description?: string | null;
  } | null;
}

function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? humanizeMarkupToken(slug);
}

function categorySort(slug: string): number {
  const index = CATEGORY_ORDER.indexOf(slug);
  return index === -1 ? 1000 : index;
}

function addCategory(
  categories: Map<string, MarkupCategoryOption>,
  slug: string,
  count = 0,
): void {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return;

  const key = categoryMarkupKey(normalized);
  const existing = categories.get(key);
  if (existing) {
    existing.itemCount += count;
    return;
  }

  categories.set(key, {
    key,
    type: 'category',
    slug: normalized,
    label: categoryLabel(normalized),
    itemCount: count,
    subcategoryCount: 0,
  });
}

function addSubcategory(
  subcategories: Map<string, MarkupSubcategoryOption>,
  categorySlug: string,
  slug: string,
  label?: string,
  count = 0,
): void {
  const normalizedCategory = categorySlug.trim().toLowerCase();
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedCategory || !normalizedSlug) return;

  const key = subcategoryMarkupKey(normalizedCategory, normalizedSlug);
  const existing = subcategories.get(key);
  if (existing) {
    existing.itemCount += count;
    return;
  }

  subcategories.set(key, {
    key,
    type: 'subcategory',
    categorySlug: normalizedCategory,
    slug: normalizedSlug,
    label: label ?? humanizeMarkupToken(normalizedSlug),
    itemCount: count,
  });
}

function addItem(
  items: Map<string, MarkupItemOption>,
  input: {
    categorySlug: string;
    subcategorySlug?: string | null;
    code: string | null | undefined;
    label: string | null | undefined;
  },
): void {
  const code = input.code?.trim();
  if (!code) return;

  const key = itemMarkupKey(code);
  const existing = items.get(key);
  if (existing) {
    existing.usageCount += 1;
    return;
  }

  items.set(key, {
    key,
    type: 'item',
    categorySlug: input.categorySlug.trim().toLowerCase(),
    subcategorySlug: input.subcategorySlug?.trim().toLowerCase() || null,
    canonicalCode: code,
    label: input.label?.trim() || code,
    usageCount: 1,
  });
}

function hardwareVariantLabel(row: HardwareVariantTargetRow): string {
  const product = row.hardware_product;
  const parts = [
    product?.description,
    row.sku ? `(${row.sku})` : null,
    row.function,
    row.finish,
    row.size,
    row.hand,
  ].filter((part): part is string => !!part && part.trim().length > 0);

  return parts.length > 0 ? parts.join(' · ') : row.sku ?? row.id;
}

function relationName(
  relation: EngineRuleTargetRow['price_table'],
): string | null {
  const value = Array.isArray(relation) ? relation[0] : relation;
  return value?.name?.trim() || null;
}

async function listEngineRuleTargets(): Promise<EngineRuleTargetRow[]> {
  const rows: EngineRuleTargetRow[] = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('price_rule')
      .select(`
        entity_type,
        charge_category,
        item_or_option_code,
        price_table ( name ),
        price_book_document!inner(status, source_verified)
      `)
      .eq('review_status', 'APPROVED')
      .eq('price_book_document.status', 'published')
      .eq('price_book_document.source_verified', true)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Failed to load pricing-engine targets: ${error.message}`);
    rows.push(...((data ?? []) as EngineRuleTargetRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  return rows;
}

async function listHardwareVariantTargets(): Promise<HardwareVariantTargetRow[]> {
  const rows: HardwareVariantTargetRow[] = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('hardware_variant')
      .select('id, sku, finish, function, size, hand, hardware_product!inner(category, subcategory, description, active)')
      .eq('hardware_product.active', true)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Failed to load hardware variant targets: ${error.message}`);
    rows.push(...((data ?? []) as HardwareVariantTargetRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  return rows;
}

export async function listCustomerMarkupTargets(): Promise<MarkupTargetCatalog> {
  const [baseSignatures, hardwareCategories, ngpCatalog, engineRuleRows, hardwareVariantRows] =
    await Promise.all([
      loadBaseSignatures(),
      loadHardwareCategories(),
      loadNgpCatalog(),
      listEngineRuleTargets(),
      listHardwareVariantTargets(),
    ]);

  const categories = new Map<string, MarkupCategoryOption>();
  const subcategories = new Map<string, MarkupSubcategoryOption>();
  const items = new Map<string, MarkupItemOption>();

  for (const [entityType, signatures] of Object.entries(baseSignatures)) {
    if (signatures.length > 0) addCategory(categories, entityType, signatures.length);
  }

  for (const row of engineRuleRows) {
    const categorySlug = row.entity_type?.trim().toLowerCase();
    if (!categorySlug) continue;

    addCategory(categories, categorySlug, 1);
    if (row.charge_category) {
      addSubcategory(subcategories, categorySlug, row.charge_category, undefined, 1);
    }
    if (row.item_or_option_code) {
      const priceTableName = relationName(row.price_table);
      addItem(items, {
        categorySlug,
        subcategorySlug: row.charge_category,
        code: row.item_or_option_code,
        label: `${row.item_or_option_code}${priceTableName ? ` · ${priceTableName}` : ''}`,
      });
    }
  }

  if (ngpCatalog.products.length > 0) {
    const categoryByNgpCategory: Record<string, string> = {
      LITE_KIT: 'lite_kit',
      LOUVER: 'louver',
      GLASS: 'glass',
      GLAZING_TAPE: 'glazing_tape',
    };

    for (const product of ngpCatalog.products) {
      const categorySlug = categoryByNgpCategory[product.category] ?? product.category.toLowerCase();
      addCategory(categories, categorySlug);
      if (product.subcategory) addSubcategory(subcategories, categorySlug, product.subcategory);
      addItem(items, {
        categorySlug,
        subcategorySlug: product.subcategory,
        code: product.model ?? product.productId,
        label: product.productName ?? product.model ?? product.productId,
      });
    }
  }

  if (hardwareCategories.length > 0 || hardwareVariantRows.length > 0) {
    addCategory(categories, 'hardware');
  }

  for (const category of hardwareCategories) {
    addSubcategory(subcategories, 'hardware', category.category, category.label, category.variantCount);
  }

  for (const row of hardwareVariantRows) {
    const hardwareCategory = row.hardware_product?.category?.trim().toLowerCase();
    if (!hardwareCategory) continue;

    addSubcategory(subcategories, 'hardware', hardwareCategory);
    addItem(items, {
      categorySlug: 'hardware',
      subcategorySlug: hardwareCategory,
      code: row.sku ?? row.id,
      label: hardwareVariantLabel(row),
    });
  }

  const itemList = [...items.values()].sort((a, b) => {
    const categoryCompare = categorySort(a.categorySlug) - categorySort(b.categorySlug);
    if (categoryCompare !== 0) return categoryCompare;
    const subcategoryCompare = (a.subcategorySlug ?? '').localeCompare(b.subcategorySlug ?? '');
    if (subcategoryCompare !== 0) return subcategoryCompare;
    return a.label.localeCompare(b.label);
  });

  const itemCountsByCategory = new Map<string, number>();
  const itemCountsBySubcategory = new Map<string, number>();
  for (const item of itemList) {
    itemCountsByCategory.set(item.categorySlug, (itemCountsByCategory.get(item.categorySlug) ?? 0) + 1);
    if (item.subcategorySlug) {
      const key = subcategoryMarkupKey(item.categorySlug, item.subcategorySlug);
      itemCountsBySubcategory.set(key, (itemCountsBySubcategory.get(key) ?? 0) + 1);
    }
  }

  const subcategoryList = [...subcategories.values()]
    .map((subcategory) => ({
      ...subcategory,
      itemCount: Math.max(subcategory.itemCount, itemCountsBySubcategory.get(subcategory.key) ?? 0),
    }))
    .filter((subcategory) => subcategory.itemCount > 0)
    .sort((a, b) => {
      const categoryCompare = categorySort(a.categorySlug) - categorySort(b.categorySlug);
      if (categoryCompare !== 0) return categoryCompare;
      return a.label.localeCompare(b.label);
    });

  const subcategoryCountsByCategory = new Map<string, number>();
  for (const subcategory of subcategoryList) {
    subcategoryCountsByCategory.set(
      subcategory.categorySlug,
      (subcategoryCountsByCategory.get(subcategory.categorySlug) ?? 0) + 1,
    );
  }

  const categoryList = [...categories.values()]
    .map((category) => ({
      ...category,
      itemCount: Math.max(category.itemCount, itemCountsByCategory.get(category.slug) ?? 0),
      subcategoryCount: subcategoryCountsByCategory.get(category.slug) ?? 0,
    }))
    .filter((category) => category.itemCount > 0 || category.subcategoryCount > 0)
    .sort((a, b) => {
      const orderCompare = categorySort(a.slug) - categorySort(b.slug);
      if (orderCompare !== 0) return orderCompare;
      return a.label.localeCompare(b.label);
    });

  return {
    categories: categoryList,
    subcategories: subcategoryList,
    items: itemList,
  };
}
