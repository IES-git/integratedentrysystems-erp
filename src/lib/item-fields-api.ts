/**
 * Per-item field management API.
 *
 * Implements a copy-on-write model on top of the global doors-wizard config:
 * - Reads merge global field_definitions / field_value_options /
 *   manufacturer_field_labels with per-item item_type_field_overrides /
 *   item_type_field_value_options / item_type_manufacturer_field_labels.
 * - Writes always go to the per-item tables; the global tables are never
 *   mutated from here.
 */

import { supabase } from './supabase';
import type {
  FieldDefinition,
  FieldValueOption,
  ManufacturerFieldLabel,
  ManufacturerFieldLabelStatus,
  ItemTypeFieldOverride,
  ItemTypeFieldValueOption,
  ItemTypeManufacturerFieldLabel,
  ItemFieldView,
  ItemFieldsView,
  AdderFieldSummary,
  ItemTypeRegistryEntry,
  ItemTypeBaseField,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BIG_FIVE_KEYS = ['series', 'gauge', 'opening_width', 'opening_height'] as const;
const BIG_FIVE_SET = new Set<string>(BIG_FIVE_KEYS);

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFieldDefinition(row: any): FieldDefinition {
  return {
    id: row.id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    valueType: row.value_type,
    description: row.description ?? null,
    status: row.status,
    usageCount: row.usage_count ?? 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFieldValueOption(row: any): FieldValueOption {
  return {
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    value: row.value,
    usageCount: row.usage_count ?? 0,
    sortOrder: row.sort_order ?? 0,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeFieldValueOption(row: any): ItemTypeFieldValueOption {
  return {
    id: row.id,
    canonicalCode: row.canonical_code,
    fieldDefinitionId: row.field_definition_id,
    value: row.value,
    sortOrder: row.sort_order ?? 0,
    isDefault: row.is_default ?? false,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeFieldOverride(row: any): ItemTypeFieldOverride {
  return {
    id: row.id,
    canonicalCode: row.canonical_code,
    fieldDefinitionId: row.field_definition_id,
    fieldLabelOverride: row.field_label_override ?? null,
    isRequired: row.is_required ?? false,
    isAdder: row.is_adder ?? false,
    isHidden: row.is_hidden ?? false,
    sortOrder: row.sort_order ?? null,
    isAddedLocally: row.is_added_locally ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapManufacturerFieldLabel(row: any): ManufacturerFieldLabel {
  return {
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    manufacturerId: row.manufacturer_id ?? null,
    manufacturerFieldLabel: row.manufacturer_field_label,
    status: (row.status as ManufacturerFieldLabelStatus) ?? 'pending',
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    manufacturer: row.companies ? { id: row.companies.id, name: row.companies.name } : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeManufacturerFieldLabel(row: any): ItemTypeManufacturerFieldLabel {
  return {
    id: row.id,
    canonicalCode: row.canonical_code,
    fieldDefinitionId: row.field_definition_id,
    manufacturerId: row.manufacturer_id ?? null,
    manufacturerFieldLabel: row.manufacturer_field_label,
    status: (row.status as ManufacturerFieldLabelStatus) ?? 'pending',
    isRemoved: row.is_removed ?? false,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    manufacturer: row.companies ? { id: row.companies.id, name: row.companies.name } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal helper — ensure an override row exists (upsert with no changes)
// ---------------------------------------------------------------------------

async function ensureOverrideRow(
  canonicalCode: string,
  fieldDefinitionId: string,
  isAddedLocally = false
): Promise<ItemTypeFieldOverride> {
  const { data, error } = await supabase
    .from('item_type_field_overrides')
    .upsert(
      { canonical_code: canonicalCode, field_definition_id: fieldDefinitionId, is_added_locally: isAddedLocally },
      { onConflict: 'canonical_code,field_definition_id', ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error || !data) {
    // Row may already exist — fetch it
    const { data: existing, error: fetchErr } = await supabase
      .from('item_type_field_overrides')
      .select('*')
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId)
      .single();
    if (fetchErr || !existing) throw new Error(`Failed to ensure override row: ${fetchErr?.message ?? 'unknown'}`);
    return mapItemTypeFieldOverride(existing);
  }
  return mapItemTypeFieldOverride(data);
}

// ---------------------------------------------------------------------------
// Read — merged view
// ---------------------------------------------------------------------------

/**
 * Returns the merged field view for a specific door item type.
 *
 * Resolution order:
 * 1. Global field set: Big Five + any field_definitions linked via item_type_fields
 *    for this canonical code. Fields locally added only in item_type_field_overrides
 *    (is_added_locally = true) are appended at the end.
 * 2. Per-item overrides from item_type_field_overrides win over global defaults
 *    for label, required, adder, hidden, sortOrder.
 * 3. Options: if any item_type_field_value_options rows exist for the
 *    (canonicalCode, fieldDefinitionId) pair, they replace the global set entirely.
 * 4. Aliases: global manufacturer_field_labels are merged with
 *    item_type_manufacturer_field_labels; rows with is_removed=true are excluded.
 */
export async function getItemFieldsView(canonicalCode: string): Promise<ItemFieldsView> {
  // Look up the item type for this canonical code so we can fetch the type-level
  // base fields that serve as the default "Other Fields" for all items of that type.
  const { data: itemRow } = await supabase
    .from('estimate_items')
    .select('item_type')
    .eq('canonical_code', canonicalCode)
    .not('item_type', 'is', null)
    .limit(1)
    .maybeSingle();

  const itemTypeSlug = (itemRow?.item_type as string | null) ?? null;

  // Fetch all data in parallel
  const [
    bigFiveResult,
    typeBaseFieldsResult,
    itemTypeFieldsResult,
    overridesResult,
    globalOptionsResult,
    perItemOptionsResult,
    globalAliasesResult,
    perItemAliasesResult,
  ] = await Promise.all([
    // Big Five are structural — fetch regardless of approval status
    supabase
      .from('field_definitions')
      .select('*')
      .in('field_key', [...BIG_FIVE_KEYS]),
    // Type-level base fields — the master default set for this item type
    itemTypeSlug
      ? supabase
          .from('item_type_base_fields')
          .select('*, field_definitions(*)')
          .eq('item_type_slug', itemTypeSlug)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('item_type_fields')
      .select('*, field_definitions(*)')
      .eq('canonical_code', canonicalCode),
    supabase
      .from('item_type_field_overrides')
      .select('*')
      .eq('canonical_code', canonicalCode),
    // Global options for all field_definitions — we'll filter by field_definition_id below
    supabase
      .from('field_value_options')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true }),
    supabase
      .from('item_type_field_value_options')
      .select('*')
      .eq('canonical_code', canonicalCode)
      .order('sort_order', { ascending: true }),
    supabase
      .from('manufacturer_field_labels')
      .select('*, companies(id, name)')
      .order('created_at', { ascending: true }),
    supabase
      .from('item_type_manufacturer_field_labels')
      .select('*, companies(id, name)')
      .eq('canonical_code', canonicalCode)
      .order('created_at', { ascending: true }),
  ]);

  if (bigFiveResult.error) throw new Error(`Failed to fetch Big Five fields: ${bigFiveResult.error.message}`);
  if (itemTypeFieldsResult.error) throw new Error(`Failed to fetch item type fields: ${itemTypeFieldsResult.error.message}`);
  if (overridesResult.error) throw new Error(`Failed to fetch overrides: ${overridesResult.error.message}`);

  // Build lookup maps
  const overridesByFieldId = new Map<string, ItemTypeFieldOverride>();
  for (const row of overridesResult.data ?? []) {
    const ov = mapItemTypeFieldOverride(row);
    overridesByFieldId.set(ov.fieldDefinitionId, ov);
  }

  // Global options indexed by field_definition_id
  const globalOptionsByField = new Map<string, FieldValueOption[]>();
  for (const row of globalOptionsResult.data ?? []) {
    const opt = mapFieldValueOption(row);
    const list = globalOptionsByField.get(opt.fieldDefinitionId) ?? [];
    list.push(opt);
    globalOptionsByField.set(opt.fieldDefinitionId, list);
  }

  // Per-item options indexed by field_definition_id
  const perItemOptionsByField = new Map<string, ItemTypeFieldValueOption[]>();
  for (const row of perItemOptionsResult.data ?? []) {
    const opt = mapItemTypeFieldValueOption(row);
    const list = perItemOptionsByField.get(opt.fieldDefinitionId) ?? [];
    list.push(opt);
    perItemOptionsByField.set(opt.fieldDefinitionId, list);
  }

  // Global aliases indexed by field_definition_id
  const globalAliasesByField = new Map<string, ManufacturerFieldLabel[]>();
  for (const row of globalAliasesResult.data ?? []) {
    const alias = mapManufacturerFieldLabel(row);
    const list = globalAliasesByField.get(alias.fieldDefinitionId) ?? [];
    list.push(alias);
    globalAliasesByField.set(alias.fieldDefinitionId, list);
  }

  // Per-item aliases indexed by field_definition_id
  const perItemAliasesByField = new Map<string, ItemTypeManufacturerFieldLabel[]>();
  for (const row of perItemAliasesResult.data ?? []) {
    const alias = mapItemTypeManufacturerFieldLabel(row);
    const list = perItemAliasesByField.get(alias.fieldDefinitionId) ?? [];
    list.push(alias);
    perItemAliasesByField.set(alias.fieldDefinitionId, list);
  }

  // Helper to build a single ItemFieldView
  function buildFieldView(definition: FieldDefinition, globalSortOrder: number): ItemFieldView {
    const override = overridesByFieldId.get(definition.id) ?? null;

    // Options — per-item set replaces global when present
    const perItemOpts = perItemOptionsByField.get(definition.id);
    const options: (FieldValueOption | ItemTypeFieldValueOption)[] =
      perItemOpts && perItemOpts.length > 0
        ? perItemOpts
        : (globalOptionsByField.get(definition.id) ?? []);

    // Aliases — merge global + per-item; filter removed
    const globalAliases = globalAliasesByField.get(definition.id) ?? [];
    const perItemAliases = perItemAliasesByField.get(definition.id) ?? [];

    // Per-item overrides take precedence: build a key to check is_removed
    const removedKeys = new Set(
      perItemAliases
        .filter((a) => a.isRemoved)
        .map((a) => `${a.manufacturerId ?? ''}::${a.manufacturerFieldLabel}`)
    );

    const filteredGlobal = globalAliases.filter(
      (a) => !removedKeys.has(`${a.manufacturerId ?? ''}::${a.manufacturerFieldLabel}`)
    );
    const newPerItem = perItemAliases.filter((a) => !a.isRemoved);
    const aliases: (ManufacturerFieldLabel | ItemTypeManufacturerFieldLabel)[] = [
      ...filteredGlobal,
      ...newPerItem,
    ];

    const effectiveLabel = override?.fieldLabelOverride ?? definition.fieldLabel;
    const sortOrder = override?.sortOrder ?? globalSortOrder;

    return {
      definition,
      effectiveLabel,
      isRequired: override?.isRequired ?? false,
      isAdder: override?.isAdder ?? false,
      isHidden: override?.isHidden ?? false,
      sortOrder,
      isAddedLocally: override?.isAddedLocally ?? false,
      options,
      aliases,
      override,
    };
  }

  // Build Big Five views (sort by the BIG_FIVE_KEYS order)
  const bigFiveDefs = new Map<string, FieldDefinition>();
  for (const row of bigFiveResult.data ?? []) {
    const def = mapFieldDefinition(row);
    bigFiveDefs.set(def.fieldKey, def);
  }

  const baseFields: ItemFieldView[] = BIG_FIVE_KEYS.flatMap((key, i) => {
    const def = bigFiveDefs.get(key);
    if (!def) return [];
    const view = buildFieldView(def, i);
    return view.isHidden ? [] : [view];
  });

  // Build "other" fields by merging two sources (deduplicated):
  //   1. Type-level base fields from item_type_base_fields (the master default for this type)
  //   2. Per-item legacy fields from item_type_fields (for existing/discovered items)
  // Per-item overrides (item_type_field_overrides) are applied on top for both sources.
  const seenIds = new Set<string>(baseFields.map((f) => f.definition.id));
  // Track insertion order with sort keys
  const mergedOther = new Map<string, { def: FieldDefinition; sortOrder: number }>();

  // 1. Type-level base fields (non-Big-Five) — inherit for ALL items of this type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (typeBaseFieldsResult.data ?? []) as any[]) {
    if (!row.field_definitions) continue;
    const def = mapFieldDefinition(row.field_definitions);
    if (seenIds.has(def.id) || BIG_FIVE_SET.has(def.fieldKey)) continue;
    if (!mergedOther.has(def.id)) {
      mergedOther.set(def.id, { def, sortOrder: row.sort_order ?? 9999 });
    }
  }

  // 2. Legacy per-item fields from item_type_fields (backward compat for existing items)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (itemTypeFieldsResult.data ?? []) as any[]) {
    if (!row.field_definitions) continue;
    const def = mapFieldDefinition(row.field_definitions);
    if (seenIds.has(def.id) || BIG_FIVE_SET.has(def.fieldKey)) continue;
    if (!mergedOther.has(def.id)) {
      mergedOther.set(def.id, { def, sortOrder: def.sortOrder });
    }
  }

  const otherFromSources: ItemFieldView[] = Array.from(mergedOther.values())
    .map(({ def, sortOrder }) => {
      const view = buildFieldView(def, sortOrder);
      return view;
    })
    .filter((v) => !v.isHidden);

  // 3. Append locally-added fields (is_added_locally = true, not in type template or legacy)
  const locallyAdded: ItemFieldView[] = [];
  for (const override of overridesByFieldId.values()) {
    if (!override.isAddedLocally || mergedOther.has(override.fieldDefinitionId) || seenIds.has(override.fieldDefinitionId)) continue;
    // Fetch the field_definition for this override
    const { data: defRow } = await supabase
      .from('field_definitions')
      .select('*')
      .eq('id', override.fieldDefinitionId)
      .single();
    if (!defRow) continue;
    const def = mapFieldDefinition(defRow);
    const view = buildFieldView(def, override.sortOrder ?? 9999);
    if (!view.isHidden) locallyAdded.push(view);
  }

  const otherFields = [...otherFromSources, ...locallyAdded].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  return { baseFields, otherFields };
}

// ---------------------------------------------------------------------------
// Write — field-level overrides
// ---------------------------------------------------------------------------

/** Override the display label for a field on a specific item type. */
export async function setItemFieldLabel(
  canonicalCode: string,
  fieldDefinitionId: string,
  label: string | null
): Promise<void> {
  await ensureOverrideRow(canonicalCode, fieldDefinitionId);
  const { error } = await supabase
    .from('item_type_field_overrides')
    .update({ field_label_override: label })
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId);
  if (error) throw new Error(`Failed to set field label: ${error.message}`);
}

/** Toggle is_required for a field on a specific item type. */
export async function setItemFieldRequired(
  canonicalCode: string,
  fieldDefinitionId: string,
  isRequired: boolean
): Promise<void> {
  await ensureOverrideRow(canonicalCode, fieldDefinitionId);
  const { error } = await supabase
    .from('item_type_field_overrides')
    .update({ is_required: isRequired })
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId);
  if (error) throw new Error(`Failed to set field required: ${error.message}`);
}

/** Toggle is_adder for a field on a specific item type. */
export async function setItemFieldAdder(
  canonicalCode: string,
  fieldDefinitionId: string,
  isAdder: boolean
): Promise<void> {
  await ensureOverrideRow(canonicalCode, fieldDefinitionId);
  const { error } = await supabase
    .from('item_type_field_overrides')
    .update({ is_adder: isAdder })
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId);
  if (error) throw new Error(`Failed to set field adder: ${error.message}`);
}

/** Toggle is_hidden for a field on a specific item type. */
export async function setItemFieldHidden(
  canonicalCode: string,
  fieldDefinitionId: string,
  isHidden: boolean
): Promise<void> {
  await ensureOverrideRow(canonicalCode, fieldDefinitionId);
  const { error } = await supabase
    .from('item_type_field_overrides')
    .update({ is_hidden: isHidden })
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId);
  if (error) throw new Error(`Failed to set field hidden: ${error.message}`);
}

/**
 * Persist the display order for "other" fields on a specific item type.
 * `orderedFieldIds` is the ordered array of field_definition_id values.
 */
export async function reorderItemFields(
  canonicalCode: string,
  orderedFieldIds: string[]
): Promise<void> {
  // Ensure override rows exist for all fields being reordered
  await Promise.all(orderedFieldIds.map((id) => ensureOverrideRow(canonicalCode, id)));

  const updates = orderedFieldIds.map((fieldDefinitionId, index) =>
    supabase
      .from('item_type_field_overrides')
      .update({ sort_order: index })
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Failed to reorder fields: ${failed.error.message}`);
}

/**
 * Add a new field to a specific item type only (is_added_locally = true).
 * The field_definition must already exist.
 */
export async function addItemField(
  canonicalCode: string,
  fieldDefinitionId: string
): Promise<ItemTypeFieldOverride> {
  const { data, error } = await supabase
    .from('item_type_field_overrides')
    .upsert(
      {
        canonical_code: canonicalCode,
        field_definition_id: fieldDefinitionId,
        is_added_locally: true,
      },
      { onConflict: 'canonical_code,field_definition_id', ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to add item field: ${error?.message ?? 'unknown'}`);
  return mapItemTypeFieldOverride(data);
}

/**
 * Remove a field from a specific item type.
 * - Locally-added fields: delete the override row entirely.
 * - Global fields: set is_hidden = true.
 */
export async function removeItemField(
  canonicalCode: string,
  fieldDefinitionId: string,
  isAddedLocally: boolean
): Promise<void> {
  if (isAddedLocally) {
    const { error } = await supabase
      .from('item_type_field_overrides')
      .delete()
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId);
    if (error) throw new Error(`Failed to remove item field: ${error.message}`);
  } else {
    await setItemFieldHidden(canonicalCode, fieldDefinitionId, true);
  }
}

// ---------------------------------------------------------------------------
// Options — per-item copy-on-write
// ---------------------------------------------------------------------------

/**
 * Returns the effective option list for a (canonicalCode, fieldDefinitionId) pair.
 * If per-item options exist, returns those; otherwise returns the global set.
 */
export async function getItemFieldOptions(
  canonicalCode: string,
  fieldDefinitionId: string
): Promise<(FieldValueOption | ItemTypeFieldValueOption)[]> {
  const [perItemResult, globalResult] = await Promise.all([
    supabase
      .from('item_type_field_value_options')
      .select('*')
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('field_value_options')
      .select('*')
      .eq('field_definition_id', fieldDefinitionId)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true }),
  ]);

  if (perItemResult.error) throw new Error(`Failed to fetch per-item options: ${perItemResult.error.message}`);
  if (globalResult.error) throw new Error(`Failed to fetch global options: ${globalResult.error.message}`);

  if ((perItemResult.data ?? []).length > 0) {
    return (perItemResult.data ?? []).map(mapItemTypeFieldValueOption);
  }
  return (globalResult.data ?? []).map(mapFieldValueOption);
}

/**
 * Snapshot global options into the per-item table if none exist yet, then
 * insert the new option. Returns the newly inserted row.
 */
export async function addItemFieldOption(
  canonicalCode: string,
  fieldDefinitionId: string,
  value: string
): Promise<ItemTypeFieldValueOption> {
  // Snapshot global options on first write
  await _snapshotGlobalOptionsIfNeeded(canonicalCode, fieldDefinitionId);

  // Determine next sort_order
  const { data: existing } = await supabase
    .from('item_type_field_value_options')
    .select('sort_order')
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextSortOrder = existing ? (existing.sort_order ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from('item_type_field_value_options')
    .insert({
      canonical_code: canonicalCode,
      field_definition_id: fieldDefinitionId,
      value,
      sort_order: nextSortOrder,
      is_default: false,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to add option: ${error?.message ?? 'unknown'}`);
  return mapItemTypeFieldValueOption(data);
}

/** Update a per-item option's value text. */
export async function updateItemFieldOption(
  id: string,
  updates: { value?: string; isDefault?: boolean }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (updates.value !== undefined) patch.value = updates.value;
  if (updates.isDefault !== undefined) patch.is_default = updates.isDefault;

  const { error } = await supabase
    .from('item_type_field_value_options')
    .update(patch)
    .eq('id', id);
  if (error) throw new Error(`Failed to update option: ${error.message}`);
}

/** Delete a per-item option. */
export async function deleteItemFieldOption(id: string): Promise<void> {
  const { error } = await supabase
    .from('item_type_field_value_options')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`Failed to delete option: ${error.message}`);
}

/**
 * Set a specific option as the default, clearing any existing default for
 * the (canonicalCode, fieldDefinitionId) pair.
 */
export async function setDefaultItemFieldOption(
  canonicalCode: string,
  fieldDefinitionId: string,
  optionId: string
): Promise<void> {
  await _snapshotGlobalOptionsIfNeeded(canonicalCode, fieldDefinitionId);

  // Clear existing default, then set the new one
  const [clearError] = await Promise.all([
    supabase
      .from('item_type_field_value_options')
      .update({ is_default: false })
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId)
      .then(({ error }) => error),
  ]);
  if (clearError) throw new Error(`Failed to clear existing default: ${clearError.message}`);

  const { error } = await supabase
    .from('item_type_field_value_options')
    .update({ is_default: true })
    .eq('id', optionId);
  if (error) throw new Error(`Failed to set default option: ${error.message}`);
}

/** Reorder per-item options. `orderedIds` is the ordered array of option IDs. */
export async function reorderItemFieldOptions(
  canonicalCode: string,
  fieldDefinitionId: string,
  orderedIds: string[]
): Promise<void> {
  await _snapshotGlobalOptionsIfNeeded(canonicalCode, fieldDefinitionId);

  const updates = orderedIds.map((id, index) =>
    supabase
      .from('item_type_field_value_options')
      .update({ sort_order: index })
      .eq('id', id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Failed to reorder options: ${failed.error.message}`);
}

/**
 * Internal: if no per-item options exist yet for (canonical, field), snapshot
 * the global field_value_options rows into item_type_field_value_options.
 */
async function _snapshotGlobalOptionsIfNeeded(
  canonicalCode: string,
  fieldDefinitionId: string
): Promise<void> {
  const { data: existing, error: checkErr } = await supabase
    .from('item_type_field_value_options')
    .select('id')
    .eq('canonical_code', canonicalCode)
    .eq('field_definition_id', fieldDefinitionId)
    .limit(1);

  if (checkErr) throw new Error(`Failed to check per-item options: ${checkErr.message}`);
  if ((existing ?? []).length > 0) return; // Already have per-item rows

  // Fetch global options
  const { data: globalOpts, error: globalErr } = await supabase
    .from('field_value_options')
    .select('*')
    .eq('field_definition_id', fieldDefinitionId)
    .order('sort_order', { ascending: true })
    .order('value', { ascending: true });

  if (globalErr) throw new Error(`Failed to fetch global options for snapshot: ${globalErr.message}`);
  if (!globalOpts || globalOpts.length === 0) return;

  const rows = globalOpts.map((opt, i) => ({
    canonical_code: canonicalCode,
    field_definition_id: fieldDefinitionId,
    value: opt.value,
    sort_order: i,
    is_default: opt.is_default ?? false,
  }));

  const { error: insertErr } = await supabase
    .from('item_type_field_value_options')
    .insert(rows);
  if (insertErr) throw new Error(`Failed to snapshot global options: ${insertErr.message}`);
}

// ---------------------------------------------------------------------------
// Aliases — per-item copy-on-write
// ---------------------------------------------------------------------------

/**
 * Returns the effective alias list for a (canonicalCode, fieldDefinitionId) pair.
 * Merges global aliases with per-item overrides; rows with is_removed=true excluded.
 */
export async function getItemFieldAliases(
  canonicalCode: string,
  fieldDefinitionId: string
): Promise<(ManufacturerFieldLabel | ItemTypeManufacturerFieldLabel)[]> {
  const [globalResult, perItemResult] = await Promise.all([
    supabase
      .from('manufacturer_field_labels')
      .select('*, companies(id, name)')
      .eq('field_definition_id', fieldDefinitionId)
      .order('created_at', { ascending: true }),
    supabase
      .from('item_type_manufacturer_field_labels')
      .select('*, companies(id, name)')
      .eq('canonical_code', canonicalCode)
      .eq('field_definition_id', fieldDefinitionId)
      .order('created_at', { ascending: true }),
  ]);

  if (globalResult.error) throw new Error(`Failed to fetch global aliases: ${globalResult.error.message}`);
  if (perItemResult.error) throw new Error(`Failed to fetch per-item aliases: ${perItemResult.error.message}`);

  const perItemAliases = (perItemResult.data ?? []).map(mapItemTypeManufacturerFieldLabel);

  const removedKeys = new Set(
    perItemAliases
      .filter((a) => a.isRemoved)
      .map((a) => `${a.manufacturerId ?? ''}::${a.manufacturerFieldLabel}`)
  );

  const filteredGlobal = (globalResult.data ?? [])
    .map(mapManufacturerFieldLabel)
    .filter((a) => !removedKeys.has(`${a.manufacturerId ?? ''}::${a.manufacturerFieldLabel}`));

  const newPerItem = perItemAliases.filter((a) => !a.isRemoved);

  return [...filteredGlobal, ...newPerItem];
}

/** Add a new alias for a field on a specific item type. */
export async function addItemFieldAlias(input: {
  canonicalCode: string;
  fieldDefinitionId: string;
  manufacturerId: string | null;
  manufacturerFieldLabel: string;
  notes?: string | null;
}): Promise<ItemTypeManufacturerFieldLabel> {
  const { data, error } = await supabase
    .from('item_type_manufacturer_field_labels')
    .insert({
      canonical_code: input.canonicalCode,
      field_definition_id: input.fieldDefinitionId,
      manufacturer_id: input.manufacturerId,
      manufacturer_field_label: input.manufacturerFieldLabel,
      notes: input.notes ?? null,
      is_removed: false,
      status: 'pending',
    })
    .select('*, companies(id, name)')
    .single();
  if (error || !data) throw new Error(`Failed to add alias: ${error?.message ?? 'unknown'}`);
  return mapItemTypeManufacturerFieldLabel(data);
}

/** Update the status of a per-item alias (pending → approved or vice versa). */
export async function updateItemFieldAliasStatus(
  id: string,
  status: ManufacturerFieldLabelStatus
): Promise<void> {
  const { error } = await supabase
    .from('item_type_manufacturer_field_labels')
    .update({ status })
    .eq('id', id);
  if (error) throw new Error(`Failed to update alias status: ${error.message}`);
}

/**
 * Mark a global alias as removed for a specific item type, or delete a
 * per-item alias by its ID.
 *
 * Pass `isGlobalAlias: true` to insert a "removal sentinel" row in
 * item_type_manufacturer_field_labels. Pass `isGlobalAlias: false` to delete
 * the per-item alias row outright.
 */
export async function deleteItemFieldAlias(
  id: string,
  options: {
    isGlobalAlias: boolean;
    canonicalCode?: string;
    fieldDefinitionId?: string;
    manufacturerId?: string | null;
    manufacturerFieldLabel?: string;
  }
): Promise<void> {
  if (options.isGlobalAlias) {
    // Insert a removal sentinel
    const { error } = await supabase
      .from('item_type_manufacturer_field_labels')
      .insert({
        canonical_code: options.canonicalCode!,
        field_definition_id: options.fieldDefinitionId!,
        manufacturer_id: options.manufacturerId ?? null,
        manufacturer_field_label: options.manufacturerFieldLabel!,
        is_removed: true,
        status: 'approved',
      });
    if (error) throw new Error(`Failed to mark global alias as removed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('item_type_manufacturer_field_labels')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Failed to delete alias: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Item Type Registry
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeRegistryEntry(row: any): ItemTypeRegistryEntry {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon ?? null,
    description: row.description ?? null,
    sortOrder: row.sort_order ?? 0,
    isSystem: row.is_system ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeBaseField(row: any): ItemTypeBaseField {
  return {
    id: row.id,
    itemTypeSlug: row.item_type_slug,
    fieldDefinitionId: row.field_definition_id,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    fieldDefinition: row.field_definitions ? mapFieldDefinition(row.field_definitions) : undefined,
  };
}

/** Returns all item types from item_type_registry ordered by sort_order. */
export async function getItemTypeRegistry(): Promise<ItemTypeRegistryEntry[]> {
  const { data, error } = await supabase
    .from('item_type_registry')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to fetch item type registry: ${error.message}`);
  return (data ?? []).map(mapItemTypeRegistryEntry);
}

/** Creates a new (non-system) item type in item_type_registry. */
export async function createItemType(input: {
  name: string;
  slug: string;
  icon?: string | null;
  description?: string | null;
}): Promise<ItemTypeRegistryEntry> {
  const { data, error } = await supabase
    .from('item_type_registry')
    .insert({
      name: input.name,
      slug: input.slug,
      icon: input.icon ?? null,
      description: input.description ?? null,
      is_system: false,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`Failed to create item type: ${error?.message ?? 'unknown'}`);
  return mapItemTypeRegistryEntry(data);
}

/**
 * Deletes a non-system item type from item_type_registry.
 * Guard: will throw if the type has is_system = true.
 * Throws if the delete is silently blocked (e.g. RLS denies it).
 */
export async function deleteItemType(slug: string): Promise<void> {
  const { data: existing, error: fetchErr } = await supabase
    .from('item_type_registry')
    .select('is_system')
    .eq('slug', slug)
    .single();
  if (fetchErr || !existing) throw new Error(`Item type '${slug}' not found`);
  if (existing.is_system) throw new Error(`Cannot delete system item type '${slug}'`);

  const { data: deleted, error } = await supabase
    .from('item_type_registry')
    .delete()
    .eq('slug', slug)
    .select('slug');
  if (error) throw new Error(`Failed to delete item type: ${error.message}`);
  if (!deleted || deleted.length === 0) {
    throw new Error('Delete was blocked — you may not have permission to delete this item type.');
  }
}

// ---------------------------------------------------------------------------
// Item Type Base Fields
// ---------------------------------------------------------------------------

/**
 * Returns the base fields for a given item type slug, joined with field_definitions.
 * Ordered by sort_order.
 */
export async function getItemTypeBaseFields(slug: string): Promise<ItemTypeBaseField[]> {
  const { data, error } = await supabase
    .from('item_type_base_fields')
    .select('*, field_definitions(*)')
    .eq('item_type_slug', slug)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch base fields for '${slug}': ${error.message}`);
  return (data ?? []).map(mapItemTypeBaseField);
}

/** Adds a field_definition as a base field for an item type. */
export async function addItemTypeBaseField(
  slug: string,
  fieldDefinitionId: string
): Promise<ItemTypeBaseField> {
  // Determine next sort_order
  const { data: existing } = await supabase
    .from('item_type_base_fields')
    .select('sort_order')
    .eq('item_type_slug', slug)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const nextSortOrder = existing ? (existing.sort_order ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from('item_type_base_fields')
    .insert({
      item_type_slug: slug,
      field_definition_id: fieldDefinitionId,
      sort_order: nextSortOrder,
    })
    .select('*, field_definitions(*)')
    .single();
  if (error || !data)
    throw new Error(`Failed to add base field to '${slug}': ${error?.message ?? 'unknown'}`);
  return mapItemTypeBaseField(data);
}

/** Removes a base field association from an item type. */
export async function removeItemTypeBaseField(
  slug: string,
  fieldDefinitionId: string
): Promise<void> {
  const { error } = await supabase
    .from('item_type_base_fields')
    .delete()
    .eq('item_type_slug', slug)
    .eq('field_definition_id', fieldDefinitionId);
  if (error) throw new Error(`Failed to remove base field from '${slug}': ${error.message}`);
}

/**
 * Updates sort_order for a set of item_type_base_fields rows.
 * Pass the ordered list of field_definition IDs; sort_orders are assigned
 * starting at `startOffset` so callers can keep Big Five and other fields in
 * separate numeric ranges if desired.
 */
export async function reorderItemTypeBaseFields(
  slug: string,
  orderedFieldDefinitionIds: string[],
  startOffset = 0
): Promise<void> {
  const updates = orderedFieldDefinitionIds.map((fieldDefinitionId, idx) =>
    supabase
      .from('item_type_base_fields')
      .update({ sort_order: startOffset + idx })
      .eq('item_type_slug', slug)
      .eq('field_definition_id', fieldDefinitionId)
  );
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) throw new Error(`Failed to reorder base fields for '${slug}': ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Adder fields — for the Pricing editor
// ---------------------------------------------------------------------------

/**
 * Returns all (canonicalCode, fieldDefinitionId) pairs where is_adder = true
 * for door items whose series field value matches `seriesValue`.
 *
 * Each entry includes the effective option values for that field so the
 * Adders tab can render one row per option.
 */
export async function getAdderFieldsForSeries(seriesValue: string): Promise<AdderFieldSummary[]> {
  // 1. Find canonical codes of door items with the given series value.
  //
  // item_fields.field_value may differ from the canonical field_value_options.value
  // (e.g. "Polystyrene" vs "UP - ULTRADOR (POLYSTYRENE, NON-HANDED)").
  // We fetch ALL series rows and match client-side using substring containment so
  // short extracted labels still resolve to the correct full series name.
  const { data: allSeriesItems, error: seriesErr } = await supabase
    .from('item_fields')
    .select('field_value, estimate_items!inner(canonical_code, item_label)')
    .eq('field_key', 'series');

  if (seriesErr) throw new Error(`Failed to fetch series items: ${seriesErr.message}`);

  const seriesLower = seriesValue.toLowerCase();

  const canonicalCodes = Array.from(
    new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (allSeriesItems ?? []).flatMap((r: any) => {
        const fv: string = (r.field_value ?? '').toLowerCase();
        // Exact match OR the full series name contains the extracted value as a substring
        const matches = fv === seriesLower || (fv.length > 2 && seriesLower.includes(fv));
        if (!matches) return [];
        const item = r.estimate_items;
        return item ? [item.canonical_code as string] : [];
      }).filter(Boolean)
    )
  );

  if (canonicalCodes.length === 0) return [];

  // 2. Fetch adder overrides for those codes
  const { data: adderRows, error: adderErr } = await supabase
    .from('item_type_field_overrides')
    .select('canonical_code, field_definition_id, field_definitions(field_label)')
    .in('canonical_code', canonicalCodes)
    .eq('is_adder', true);

  if (adderErr) throw new Error(`Failed to fetch adder fields: ${adderErr.message}`);

  if (!adderRows || adderRows.length === 0) return [];

  // 3. Resolve item labels for each canonical code from estimate_items
  const { data: itemRows } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_label')
    .in('canonical_code', canonicalCodes);

  const itemLabelByCode = new Map<string, string>();
  for (const row of itemRows ?? []) {
    if (row.canonical_code && !itemLabelByCode.has(row.canonical_code)) {
      itemLabelByCode.set(row.canonical_code, row.item_label ?? row.canonical_code);
    }
  }

  // 4. For each adder field, fetch the effective option values (per-item first, fall back to global)
  const fieldDefIds = Array.from(new Set(adderRows.map((r) => r.field_definition_id as string)));

  const [perItemOptsResult, globalOptsResult] = await Promise.all([
    supabase
      .from('item_type_field_value_options')
      .select('canonical_code, field_definition_id, value, sort_order')
      .in('canonical_code', canonicalCodes)
      .in('field_definition_id', fieldDefIds)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true }),
    supabase
      .from('field_value_options')
      .select('field_definition_id, value, sort_order')
      .in('field_definition_id', fieldDefIds)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true }),
  ]);

  // Per-item options keyed by "canonicalCode::fieldDefinitionId"
  const perItemOptsByKey = new Map<string, string[]>();
  for (const row of perItemOptsResult.data ?? []) {
    const key = `${row.canonical_code}::${row.field_definition_id}`;
    const list = perItemOptsByKey.get(key) ?? [];
    list.push(row.value as string);
    perItemOptsByKey.set(key, list);
  }

  // Global options keyed by fieldDefinitionId
  const globalOptsByField = new Map<string, string[]>();
  for (const row of globalOptsResult.data ?? []) {
    const list = globalOptsByField.get(row.field_definition_id as string) ?? [];
    list.push(row.value as string);
    globalOptsByField.set(row.field_definition_id as string, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (adderRows ?? []).map((row: any) => {
    const canonicalCode = row.canonical_code as string;
    const fieldDefinitionId = row.field_definition_id as string;
    const perItemKey = `${canonicalCode}::${fieldDefinitionId}`;
    const options =
      perItemOptsByKey.get(perItemKey) ??
      globalOptsByField.get(fieldDefinitionId) ??
      [];

    return {
      canonicalCode,
      fieldDefinitionId,
      fieldLabel: (row.field_definitions?.field_label ?? fieldDefinitionId) as string,
      itemLabel: itemLabelByCode.get(canonicalCode) ?? canonicalCode,
      options,
    };
  });
}
