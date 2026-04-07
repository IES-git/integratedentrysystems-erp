/**
 * Supabase-backed CRUD operations for Estimates, Estimate Items, Item Fields,
 * and Field Definitions.  Also provides the client for invoking the
 * `process-estimate` Edge Function (Gemini 3 Flash with Agentic Vision).
 */

import { supabase } from './supabase';
import type {
  Estimate,
  EstimateItem,
  EstimateItemWithHardware,
  EstimateOpening,
  EstimateOpeningWithItems,
  EstimateWithItems,
  ItemField,
  FieldDefinition,
  FieldDefinitionStatus,
  FieldValueType,
  FieldValueOption,
  ItemType,
  ItemCategory,
  ItemTypeField,
  ManufacturerFieldLabel,
  ManufacturerFieldLabelStatus,
  BlockedFieldLabel,
  HardwareCatalogItem,
  HardwareSubcategory,
} from '@/types';

// ---------------------------------------------------------------------------
// Upload & Process
// ---------------------------------------------------------------------------

/** Upload a file to Supabase Storage and create the estimate record. */
export async function uploadEstimateFile(
  file: File,
  userId: string
): Promise<{ estimateId: string; filePath: string }> {
  const fileType = file.type === 'application/pdf' ? 'pdf' : 'image';

  // Build a unique storage path
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${userId}/${timestamp}-${safeName}`;

  // 1. Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('estimate-files')
    .upload(filePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // 2. Create estimate row
  const { data: estimate, error: insertError } = await supabase
    .from('estimates')
    .insert({
      uploaded_by_user_id: userId,
      source: 'upload',
      original_file_url: filePath,
      original_file_name: file.name,
      file_type: fileType,
      ocr_status: 'pending',
    })
    .select('id')
    .single();

  if (insertError || !estimate) {
    // Rollback: remove the uploaded file
    await supabase.storage.from('estimate-files').remove([filePath]);
    throw new Error(`Failed to create estimate: ${insertError?.message}`);
  }

  return { estimateId: estimate.id, filePath };
}

/**
 * Invoke the `process-estimate` Edge Function which uses Gemini 3 Flash
 * with Agentic Vision (code execution) to extract structured data.
 */
export async function processEstimate(
  estimateId: string
): Promise<{
  success: boolean;
  itemCount: number;
  newFieldsDiscovered: number;
}> {
  const { data, error } = await supabase.functions.invoke('process-estimate', {
    body: { estimateId },
  });

  if (error) {
    throw new Error(error.message || 'Estimate processing failed');
  }

  return data;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Fetch a single estimate by ID. Returns null if not found. */
export async function getEstimate(id: string): Promise<Estimate | null> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to fetch estimate: ${error.message}`);
  }

  return mapEstimateRow(data);
}

/** Fetch an estimate together with its items, their fields, and openings. */
export async function getEstimateWithItems(
  id: string
): Promise<{
  estimate: Estimate;
  items: (EstimateItem & { fields: ItemField[] })[];
  openings: EstimateOpeningWithItems[];
} | null> {
  const [estimateRes, openingsRes] = await Promise.all([
    supabase
      .from('estimates')
      .select(`
        *,
        estimate_items (
          *,
          item_fields (*)
        )
      `)
      .eq('id', id)
      .order('sort_order', { referencedTable: 'estimate_items', ascending: true })
      .single(),
    supabase
      .from('estimate_openings')
      .select('*')
      .eq('estimate_id', id)
      .order('sort_order', { ascending: true }),
  ]);

  if (estimateRes.error) {
    if (estimateRes.error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch estimate: ${estimateRes.error.message}`);
  }

  const data = estimateRes.data;
  const estimate = mapEstimateRow(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems = (data.estimate_items || []).map((row: any) => ({
    ...mapEstimateItemRow(row),
    fields: (row.item_fields || []).map(mapItemFieldRow),
  }));

  // Build openings with nested items (hardware nested under parent door/frame)
  const openingRows = openingsRes.data ?? [];
  const openings: EstimateOpeningWithItems[] = openingRows.map((openingRow) => {
    const openingItems = allItems.filter((i) => i.openingId === openingRow.id);
    const topLevel = openingItems.filter((i) => !i.parentItemId);
    const itemsWithHardware: EstimateItemWithHardware[] = topLevel.map((item) => ({
      ...item,
      hardware: openingItems.filter((i) => i.parentItemId === item.id),
    }));
    return {
      ...mapEstimateOpeningRow(openingRow),
      items: itemsWithHardware,
    };
  });

  return { estimate, items: allItems, openings };
}

/** Fetch items (with fields) for a given estimate. */
export async function getEstimateItems(
  estimateId: string
): Promise<(EstimateItem & { fields: ItemField[] })[]> {
  const { data, error } = await supabase
    .from('estimate_items')
    .select('*, item_fields (*)')
    .eq('estimate_id', estimateId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch items: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => ({
    ...mapEstimateItemRow(row),
    fields: (row.item_fields || []).map(mapItemFieldRow),
  }));
}

/** List all estimates (most recent first). */
export async function listEstimates(): Promise<Estimate[]> {
  const { data, error } = await supabase
    .from('estimates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list estimates: ${error.message}`);
  return (data || []).map(mapEstimateRow);
}

/**
 * List all estimates with their line items (id, canonical_code, item_label only)
 * and the full name of the user who created each estimate.
 * Uses parallel flat queries instead of embedded relations to avoid
 * PostgREST join resolution issues.
 */
export async function getEstimatesWithItems(): Promise<EstimateWithItems[]> {
  const [estimatesRes, itemsRes, openingsRes] = await Promise.all([
    supabase
      .from('estimates')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('estimate_items')
      .select('id, estimate_id, canonical_code, item_label'),
    supabase
      .from('estimate_openings')
      .select('id, estimate_id'),
  ]);

  if (estimatesRes.error)
    throw new Error(`Failed to list estimates: ${estimatesRes.error.message}`);
  if (itemsRes.error)
    throw new Error(`Failed to fetch estimate items: ${itemsRes.error.message}`);

  // Collect unique user IDs so we can fetch names in one query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userIds = [...new Set((estimatesRes.data || []).map((r: any) => r.uploaded_by_user_id).filter(Boolean))];
  const userNameMap = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .in('id', userIds);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (usersData || []) as any[]) {
      userNameMap.set(u.id, `${u.first_name} ${u.last_name}`.trim());
    }
  }

  // Group items by estimate_id for O(1) lookup
  const itemsByEstimate = new Map<string, { id: string; canonicalCode: string; itemLabel: string }[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (itemsRes.data || []) as any[]) {
    const list = itemsByEstimate.get(item.estimate_id) ?? [];
    list.push({
      id: item.id,
      canonicalCode: item.canonical_code ?? '',
      itemLabel: item.item_label ?? '',
    });
    itemsByEstimate.set(item.estimate_id, list);
  }

  // Count openings per estimate
  const openingsCountByEstimate = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const opening of (openingsRes.data || []) as any[]) {
    openingsCountByEstimate.set(
      opening.estimate_id,
      (openingsCountByEstimate.get(opening.estimate_id) ?? 0) + 1
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (estimatesRes.data || []).map((row: any) => ({
    ...mapEstimateRow(row),
    items: itemsByEstimate.get(row.id) ?? [],
    createdByUserName: userNameMap.get(row.uploaded_by_user_id) ?? null,
    openingsCount: openingsCountByEstimate.get(row.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Update top-level estimate fields (company info, status, etc.). */
export async function updateEstimate(
  id: string,
  updates: Partial<
    Pick<
      Estimate,
      | 'companyId'
      | 'extractedCustomerName'
      | 'extractedCustomerContact'
      | 'extractedCustomerEmail'
      | 'extractedCustomerPhone'
      | 'totalPrice'
    >
  >
): Promise<Estimate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.companyId !== undefined) row.company_id = updates.companyId;
  if (updates.extractedCustomerName !== undefined)
    row.extracted_customer_name = updates.extractedCustomerName;
  if (updates.extractedCustomerContact !== undefined)
    row.extracted_customer_contact = updates.extractedCustomerContact;
  if (updates.extractedCustomerEmail !== undefined)
    row.extracted_customer_email = updates.extractedCustomerEmail;
  if (updates.extractedCustomerPhone !== undefined)
    row.extracted_customer_phone = updates.extractedCustomerPhone;
  if (updates.totalPrice !== undefined)
    row.total_price = updates.totalPrice;

  const { data, error } = await supabase
    .from('estimates')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update estimate: ${error.message}`);
  return mapEstimateRow(data);
}

/** Update an estimate line item. */
export async function updateEstimateItem(
  id: string,
  updates: Partial<
    Pick<EstimateItem, 'itemLabel' | 'canonicalCode' | 'quantity' | 'unitPrice' | 'sortOrder' | 'openingId'>
  >
): Promise<EstimateItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.itemLabel !== undefined) row.item_label = updates.itemLabel;
  if (updates.canonicalCode !== undefined)
    row.canonical_code = updates.canonicalCode;
  if (updates.quantity !== undefined) row.quantity = updates.quantity;
  if (updates.unitPrice !== undefined) row.unit_price = updates.unitPrice;
  if (updates.sortOrder !== undefined) row.sort_order = updates.sortOrder;
  if (updates.openingId !== undefined) row.opening_id = updates.openingId;

  const { data, error } = await supabase
    .from('estimate_items')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update item: ${error.message}`);
  return mapEstimateItemRow(data);
}

/** Update an individual item field value. */
export async function updateItemField(
  id: string,
  updates: Partial<Pick<ItemField, 'fieldValue' | 'fieldLabel' | 'valueType'>>
): Promise<ItemField> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.fieldValue !== undefined) row.field_value = updates.fieldValue;
  if (updates.fieldLabel !== undefined) row.field_label = updates.fieldLabel;
  if (updates.valueType !== undefined) row.value_type = updates.valueType;

  const { data, error } = await supabase
    .from('item_fields')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update field: ${error.message}`);
  return mapItemFieldRow(data);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Create a blank manual estimate (no file, no OCR). Returns the new estimate ID. */
export async function createManualEstimate(userId: string): Promise<{ estimateId: string }> {
  const { data: estimate, error } = await supabase
    .from('estimates')
    .insert({
      uploaded_by_user_id: userId,
      source: 'manual',
      // Placeholder values required by NOT NULL DB constraints — no actual file exists
      original_file_url: '',
      original_file_name: 'Manual Estimate',
      file_type: 'pdf',
      ocr_status: 'done',
    })
    .select('id')
    .single();

  if (error || !estimate) {
    throw new Error(`Failed to create estimate: ${error?.message}`);
  }

  return { estimateId: estimate.id };
}

/** Add a new line item to an estimate. */
export async function addEstimateItem(
  estimateId: string,
  item: {
    itemLabel: string;
    canonicalCode?: string;
    quantity?: number;
    sortOrder?: number;
    openingId?: string | null;
    parentItemId?: string | null;
    subcategory?: string | null;
  }
): Promise<EstimateItem> {
  const { data, error } = await supabase
    .from('estimate_items')
    .insert({
      estimate_id: estimateId,
      item_label: item.itemLabel,
      canonical_code: item.canonicalCode || null,
      quantity: item.quantity ?? 1,
      sort_order: item.sortOrder ?? 0,
      opening_id: item.openingId ?? null,
      parent_item_id: item.parentItemId ?? null,
      subcategory: item.subcategory ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add item: ${error.message}`);
  return mapEstimateItemRow(data);
}

/** Add a new field to a line item. */
export async function addItemField(
  estimateItemId: string,
  field: {
    fieldKey: string;
    fieldLabel: string;
    fieldValue: string;
    valueType: FieldValueType;
    fieldDefinitionId?: string;
  }
): Promise<ItemField> {
  const { data, error } = await supabase
    .from('item_fields')
    .insert({
      estimate_item_id: estimateItemId,
      field_definition_id: field.fieldDefinitionId || null,
      field_key: field.fieldKey,
      field_label: field.fieldLabel,
      field_value: field.fieldValue,
      value_type: field.valueType,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add field: ${error.message}`);
  return mapItemFieldRow(data);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete an estimate line item (cascades to its fields). */
export async function deleteEstimateItem(id: string): Promise<void> {
  const { error } = await supabase.from('estimate_items').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete item: ${error.message}`);
}

/** Delete a single item field. */
export async function deleteItemField(id: string): Promise<void> {
  const { error } = await supabase.from('item_fields').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete field: ${error.message}`);
}

/** Duplicate an existing estimate (same file, no re-OCR) and return the new estimate ID. */
export async function duplicateEstimate(
  sourceId: string,
  userId: string
): Promise<{ estimateId: string }> {
  const result = await getEstimateWithItems(sourceId);
  if (!result) throw new Error('Source estimate not found');
  const { estimate, items } = result;

  const { data: newEstimate, error: estimateError } = await supabase
    .from('estimates')
    .insert({
      uploaded_by_user_id: userId,
      source: 'duplicate',
      original_file_url: estimate.originalFileUrl,
      original_file_name: `Copy of ${estimate.originalFileName}`,
      file_type: estimate.fileType,
      ocr_status: 'done',
      company_id: estimate.companyId,
      extracted_customer_name: estimate.extractedCustomerName,
      extracted_customer_contact: estimate.extractedCustomerContact,
      extracted_customer_email: estimate.extractedCustomerEmail,
      extracted_customer_phone: estimate.extractedCustomerPhone,
      customer_confidence: estimate.customerConfidence,
      total_price: estimate.totalPrice,
      extracted_at: estimate.extractedAt,
    })
    .select('id')
    .single();

  if (estimateError || !newEstimate) {
    throw new Error(`Failed to duplicate estimate: ${estimateError?.message}`);
  }

  try {
    for (const item of items) {
      const { data: newItem, error: itemError } = await supabase
        .from('estimate_items')
        .insert({
          estimate_id: newEstimate.id,
          item_label: item.itemLabel,
          canonical_code: item.canonicalCode,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          sort_order: item.sortOrder,
        })
        .select('id')
        .single();

      if (itemError || !newItem) {
        throw new Error(`Failed to copy item: ${itemError?.message}`);
      }

      if (item.fields.length > 0) {
        const { error: fieldsError } = await supabase.from('item_fields').insert(
          item.fields.map((field) => ({
            estimate_item_id: newItem.id,
            field_definition_id: field.fieldDefinitionId,
            field_key: field.fieldKey,
            field_label: field.fieldLabel,
            field_value: field.fieldValue,
            value_type: field.valueType,
            source_confidence: field.sourceConfidence,
          }))
        );

        if (fieldsError) {
          throw new Error(`Failed to copy item fields: ${fieldsError.message}`);
        }
      }
    }
  } catch (err) {
    // Rollback: delete the new estimate (cascades to items/fields; file is shared so not deleted)
    await supabase.from('estimates').delete().eq('id', newEstimate.id);
    throw err;
  }

  return { estimateId: newEstimate.id };
}

/** Delete an estimate and its associated file from storage. */
export async function deleteEstimate(id: string): Promise<void> {
  // First, get the estimate to find the file path
  const estimate = await getEstimate(id);
  if (!estimate) {
    throw new Error('Estimate not found');
  }

  // Delete the file from storage
  if (estimate.originalFileUrl) {
    const { error: storageError } = await supabase.storage
      .from('estimate-files')
      .remove([estimate.originalFileUrl]);
    
    if (storageError) {
      console.warn('Failed to delete file from storage:', storageError);
      // Continue with estimate deletion even if file deletion fails
    }
  }

  // Delete the estimate (cascades to items and fields)
  const { error } = await supabase.from('estimates').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete estimate: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Estimate Openings CRUD
// ---------------------------------------------------------------------------

/** Create a new opening for an estimate. */
export async function createEstimateOpening(
  estimateId: string,
  name: string,
  quantity: number = 1
): Promise<EstimateOpening> {
  // Determine next sort_order
  const { count } = await supabase
    .from('estimate_openings')
    .select('id', { count: 'exact', head: true })
    .eq('estimate_id', estimateId);

  const { data, error } = await supabase
    .from('estimate_openings')
    .insert({
      estimate_id: estimateId,
      name,
      quantity,
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create opening: ${error.message}`);
  return mapEstimateOpeningRow(data);
}

/** Update an existing opening's name, quantity, or sort_order. */
export async function updateEstimateOpening(
  id: string,
  updates: Partial<Pick<EstimateOpening, 'name' | 'quantity' | 'sortOrder'>>
): Promise<EstimateOpening> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.quantity !== undefined) row.quantity = updates.quantity;
  if (updates.sortOrder !== undefined) row.sort_order = updates.sortOrder;

  const { data, error } = await supabase
    .from('estimate_openings')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update opening: ${error.message}`);
  return mapEstimateOpeningRow(data);
}

/** Delete an opening. Items with this opening_id will be SET NULL (unlinked) by the DB. */
export async function deleteEstimateOpening(id: string): Promise<void> {
  const { error } = await supabase.from('estimate_openings').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete opening: ${error.message}`);
}

/** Fetch all openings for an estimate, with nested items (hardware under parent). */
export async function getEstimateOpenings(
  estimateId: string
): Promise<EstimateOpeningWithItems[]> {
  const [openingsRes, itemsRes] = await Promise.all([
    supabase
      .from('estimate_openings')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('estimate_items')
      .select('*, item_fields(*)')
      .eq('estimate_id', estimateId)
      .not('opening_id', 'is', null)
      .order('sort_order', { ascending: true }),
  ]);

  if (openingsRes.error) throw new Error(`Failed to fetch openings: ${openingsRes.error.message}`);
  if (itemsRes.error) throw new Error(`Failed to fetch opening items: ${itemsRes.error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems = (itemsRes.data ?? []).map((row: any) => ({
    ...mapEstimateItemRow(row),
    fields: (row.item_fields ?? []).map(mapItemFieldRow),
  }));

  return (openingsRes.data ?? []).map((openingRow) => buildOpeningWithItems(openingRow, allItems));
}

/**
 * Assemble an EstimateOpeningWithItems from a raw opening row and a flat item list.
 *
 * Items with parent_item_id set → legacy hardware nested under their parent door/frame.
 * Items with parent_item_id = null and subcategory set → opening-level hardware (new style).
 * Items with parent_item_id = null and subcategory null → door / frame items.
 */
function buildOpeningWithItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openingRow: any,
  allItems: (EstimateItem & { fields: ReturnType<typeof mapItemFieldRow>[] })[]
): EstimateOpeningWithItems {
  const openingItems = allItems.filter((i) => i.openingId === openingRow.id);

  // Split top-level items by whether they carry a subcategory (hardware) or not (door/frame)
  const topLevelItems = openingItems.filter((i) => !i.parentItemId);
  const doorFrameItems = topLevelItems.filter((i) => !i.subcategory);
  const openingHardware: EstimateItem[] = topLevelItems.filter((i) => !!i.subcategory);

  // Legacy: hardware stored under a door/frame parent
  const itemsWithHardware: EstimateItemWithHardware[] = doorFrameItems.map((item) => ({
    ...item,
    hardware: openingItems.filter((i) => i.parentItemId === item.id),
  }));

  return { ...mapEstimateOpeningRow(openingRow), items: itemsWithHardware, hardware: openingHardware };
}

/**
 * Returns distinct openings with their items from all estimates, for use
 * in the "Choose Existing Opening" dialog.  Openings are deduplicated by name
 * and ordered by most-recently created.
 */
export async function listReusableOpenings(): Promise<EstimateOpeningWithItems[]> {
  const [openingsRes, itemsRes] = await Promise.all([
    supabase
      .from('estimate_openings')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('estimate_items')
      .select('*, item_fields(*)')
      .not('opening_id', 'is', null)
      .order('sort_order', { ascending: true }),
  ]);

  if (openingsRes.error) throw new Error(`Failed to fetch reusable openings: ${openingsRes.error.message}`);
  if (itemsRes.error) throw new Error(`Failed to fetch opening items: ${itemsRes.error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems = (itemsRes.data ?? []).map((row: any) => ({
    ...mapEstimateItemRow(row),
    fields: (row.item_fields ?? []).map(mapItemFieldRow),
  }));

  return (openingsRes.data ?? []).map((openingRow) => buildOpeningWithItems(openingRow, allItems));
}

/**
 * Deep-copy a source opening (and all its items + fields) into a target estimate.
 * Top-level items are copied first; hardware is then re-linked to the new parent item ids.
 */
export async function copyOpeningToEstimate(
  sourceOpeningId: string,
  targetEstimateId: string
): Promise<EstimateOpening> {
  // 1. Fetch the source opening
  const { data: sourceOpening, error: openingError } = await supabase
    .from('estimate_openings')
    .select('*')
    .eq('id', sourceOpeningId)
    .single();

  if (openingError || !sourceOpening) {
    throw new Error(`Source opening not found: ${openingError?.message}`);
  }

  // 2. Determine the next sort_order in the target
  const { count: existingCount } = await supabase
    .from('estimate_openings')
    .select('id', { count: 'exact', head: true })
    .eq('estimate_id', targetEstimateId);

  // 3. Create the new opening in the target estimate
  const { data: newOpening, error: newOpeningError } = await supabase
    .from('estimate_openings')
    .insert({
      estimate_id: targetEstimateId,
      name: sourceOpening.name,
      quantity: sourceOpening.quantity,
      sort_order: existingCount ?? 0,
    })
    .select()
    .single();

  if (newOpeningError || !newOpening) {
    throw new Error(`Failed to copy opening: ${newOpeningError?.message}`);
  }

  // 4. Fetch all items (with fields) from the source opening
  const { data: sourceItems, error: itemsError } = await supabase
    .from('estimate_items')
    .select('*, item_fields(*)')
    .eq('opening_id', sourceOpeningId)
    .order('sort_order', { ascending: true });

  if (itemsError) throw new Error(`Failed to fetch source items: ${itemsError.message}`);
  if (!sourceItems || sourceItems.length === 0) return mapEstimateOpeningRow(newOpening);

  // 5. Separate top-level items from hardware items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topLevelItems = (sourceItems as any[]).filter((i) => !i.parent_item_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hardwareItems = (sourceItems as any[]).filter((i) => !!i.parent_item_id);

  // 6. Copy top-level items and build an old-id → new-id map
  const idMap = new Map<string, string>();

  for (const item of topLevelItems) {
    const { data: newItem, error: itemError } = await supabase
      .from('estimate_items')
      .insert({
        estimate_id: targetEstimateId,
        opening_id: newOpening.id,
        parent_item_id: null,
        item_label: item.item_label,
        canonical_code: item.canonical_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sort_order: item.sort_order,
        manufacturer_id: item.manufacturer_id,
        subcategory: item.subcategory ?? null,
      })
      .select('id')
      .single();

    if (itemError || !newItem) throw new Error(`Failed to copy item: ${itemError?.message}`);
    idMap.set(item.id, newItem.id);

    if (item.item_fields?.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('item_fields').insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item.item_fields.map((f: any) => ({
          estimate_item_id: newItem.id,
          field_definition_id: f.field_definition_id,
          field_key: f.field_key,
          field_label: f.field_label,
          field_value: f.field_value,
          value_type: f.value_type,
          source_confidence: f.source_confidence,
        }))
      );
    }
  }

  // 7. Copy hardware items using the id map to set the new parent_item_id
  for (const item of hardwareItems) {
    const newParentId = idMap.get(item.parent_item_id);
    if (!newParentId) continue;

    const { data: newItem, error: itemError } = await supabase
      .from('estimate_items')
      .insert({
        estimate_id: targetEstimateId,
        opening_id: newOpening.id,
        parent_item_id: newParentId,
        item_label: item.item_label,
        canonical_code: item.canonical_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
        sort_order: item.sort_order,
        manufacturer_id: item.manufacturer_id,
        subcategory: item.subcategory ?? null,
      })
      .select('id')
      .single();

    if (itemError || !newItem) throw new Error(`Failed to copy hardware item: ${itemError?.message}`);

    if (item.item_fields?.length > 0) {
      await supabase.from('item_fields').insert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item.item_fields.map((f: any) => ({
          estimate_item_id: newItem.id,
          field_definition_id: f.field_definition_id,
          field_key: f.field_key,
          field_label: f.field_label,
          field_value: f.field_value,
          value_type: f.value_type,
          source_confidence: f.source_confidence,
        }))
      );
    }
  }

  return mapEstimateOpeningRow(newOpening);
}

// ---------------------------------------------------------------------------
// File URLs
// ---------------------------------------------------------------------------

/** Generate a temporary signed URL for an estimate file (1-hour expiry). */
export async function getEstimateFileUrl(filePath: string): Promise<string> {
  if (!filePath) throw new Error('No file path provided');

  const { data } = await supabase.storage
    .from('estimate-files')
    .createSignedUrl(filePath, 3600);

  if (!data?.signedUrl) {
    throw new Error('Failed to generate signed URL');
  }

  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Field Definitions
// ---------------------------------------------------------------------------

/**
 * Return field definitions that have been used on items matching the given
 * item label or canonical code, ordered by usage frequency (most-used first).
 * Falls back to an empty array if neither parameter is provided.
 */
export async function getFieldDefinitionsForItemType(
  itemLabel?: string,
  canonicalCode?: string
): Promise<FieldDefinition[]> {
  if (!itemLabel && !canonicalCode) return [];

  // Build OR filters for item_label / canonical_code
  const orFilters: string[] = [];
  if (itemLabel) orFilters.push(`item_label.ilike.${itemLabel}`);
  if (canonicalCode) orFilters.push(`canonical_code.ilike.${canonicalCode}`);

  // Fetch matching estimate_item ids
  const { data: matchingItems, error: itemsError } = await supabase
    .from('estimate_items')
    .select('id')
    .or(orFilters.join(','));

  if (itemsError) throw new Error(`Failed to fetch item types: ${itemsError.message}`);
  if (!matchingItems || matchingItems.length === 0) return [];

  const matchingItemIds = matchingItems.map((r) => r.id);

  // Fetch distinct field_definition_ids used on those items
  const { data: itemFields, error: fieldsError } = await supabase
    .from('item_fields')
    .select('field_definition_id')
    .in('estimate_item_id', matchingItemIds)
    .not('field_definition_id', 'is', null);

  if (fieldsError) throw new Error(`Failed to fetch item fields: ${fieldsError.message}`);
  if (!itemFields || itemFields.length === 0) return [];

  const uniqueDefIds = [
    ...new Set(itemFields.map((r) => r.field_definition_id as string)),
  ];

  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .in('id', uniqueDefIds)
    .eq('status', 'approved')
    .order('usage_count', { ascending: false });

  if (error) throw new Error(`Failed to fetch field definitions: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map(mapFieldDefinitionRow);
}

/** List field definitions, optionally filtered by status. */
export async function getFieldDefinitions(
  status?: FieldDefinitionStatus
): Promise<FieldDefinition[]> {
  let query = supabase
    .from('field_definitions')
    .select('*')
    .order('usage_count', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error)
    throw new Error(`Failed to fetch field definitions: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map(mapFieldDefinitionRow);
}

/** Update a field definition's status (approve or reject). */
export async function updateFieldDefinitionStatus(
  id: string,
  status: FieldDefinitionStatus
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from('field_definitions')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error)
    throw new Error(`Failed to update field definition: ${error.message}`);
  return mapFieldDefinitionRow(data);
}

/** Update a field definition's label, description, or value type. */
export async function updateFieldDefinition(
  id: string,
  updates: Partial<Pick<FieldDefinition, 'fieldLabel' | 'description' | 'valueType'>>
): Promise<FieldDefinition> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.fieldLabel !== undefined) row.field_label = updates.fieldLabel;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.valueType !== undefined) row.value_type = updates.valueType;

  const { data, error } = await supabase
    .from('field_definitions')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error)
    throw new Error(`Failed to update field definition: ${error.message}`);
  return mapFieldDefinitionRow(data);
}

/** Delete a field definition (e.g. rejected/unwanted fields). */
export async function deleteFieldDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('field_definitions')
    .delete()
    .eq('id', id);
  if (error)
    throw new Error(`Failed to delete field definition: ${error.message}`);
}

/**
 * Upsert a field definition by field_key: inserts with status='approved' if it doesn't exist,
 * or updates the label and status to 'approved' if it does.  Used when the user manually
 * creates a new field from the line-items wizard so it becomes discoverable for future items.
 */
export async function createOrApproveFieldDefinition(input: {
  fieldKey: string;
  fieldLabel: string;
  valueType?: FieldValueType;
}): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from('field_definitions')
    .upsert(
      {
        field_key: input.fieldKey,
        field_label: input.fieldLabel,
        value_type: input.valueType ?? 'string',
        status: 'approved',
      },
      { onConflict: 'field_key', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to create field definition: ${error.message}`);
  return mapFieldDefinitionRow(data);
}

// ---------------------------------------------------------------------------
// Field Value Options
// ---------------------------------------------------------------------------

/** Fetch previously used values for a field definition, ordered by usage frequency. */
export async function getFieldValueOptions(
  fieldDefinitionId: string
): Promise<FieldValueOption[]> {
  const { data, error } = await supabase
    .from('field_value_options')
    .select('*')
    .eq('field_definition_id', fieldDefinitionId)
    .order('usage_count', { ascending: false });

  if (error) throw new Error(`Failed to fetch field value options: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => ({
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    value: row.value,
    usageCount: row.usage_count,
    createdAt: row.created_at,
  }));
}

/**
 * Record (or increment) usage of a value for a given field definition.
 * Upserts into field_value_options: inserts with usage_count=1 on first use,
 * increments usage_count on subsequent uses.
 */
export async function recordFieldValueUsage(
  fieldDefinitionId: string,
  value: string
): Promise<void> {
  const { error } = await supabase.rpc('upsert_field_value_option', {
    p_field_definition_id: fieldDefinitionId,
    p_value: value,
  });

  if (error) {
    // Fallback: manual upsert if the RPC doesn't exist yet
    const { data: existing } = await supabase
      .from('field_value_options')
      .select('id, usage_count')
      .eq('field_definition_id', fieldDefinitionId)
      .eq('value', value)
      .single();

    if (existing) {
      await supabase
        .from('field_value_options')
        .update({ usage_count: existing.usage_count + 1 })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('field_value_options')
        .insert({ field_definition_id: fieldDefinitionId, value, usage_count: 1 });
    }
  }
}

// ---------------------------------------------------------------------------
// Item Types & Item Type Fields
// ---------------------------------------------------------------------------

/**
 * Returns item types grouped by category (doors / frames / hardware).
 *
 * Within the Doors and Frames categories, items that share identical values for
 * series + material + opening_width + opening_height are collapsed into a single
 * group (same physical product, different hardware/finish codes).  Items that
 * are missing any of those four key fields each remain their own group.
 *
 * Hardware items always remain per-canonical-code.
 *
 * The returned `canonicalCode` is the primary (most-used) code for field
 * management; `canonicalCodes` lists every code in the group.
 */
export async function getItemTypes(): Promise<ItemType[]> {
  const KEY_FIELDS = ['series', 'material', 'opening_width', 'opening_height'] as const;

  const [itemsResult, keyFieldsResult, catalogResult] = await Promise.all([
    supabase.from('estimate_items').select('canonical_code, item_label'),
    supabase
      .from('item_fields')
      .select('field_value, field_key, estimate_items!inner(canonical_code)')
      .in('field_key', [...KEY_FIELDS]),
    supabase
      .from('hardware_catalog')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (itemsResult.error) throw new Error(`Failed to fetch item types: ${itemsResult.error.message}`);

  // Build per-canonical-code value-count maps: code -> fieldKey -> value -> count
  const fieldValueCounts = new Map<string, Map<string, Map<string, number>>>();
  for (const row of keyFieldsResult.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (row.estimate_items as any)?.canonical_code as string | undefined;
    if (!code || !row.field_value || !row.field_key) continue;
    if (!fieldValueCounts.has(code)) fieldValueCounts.set(code, new Map());
    const byKey = fieldValueCounts.get(code)!;
    if (!byKey.has(row.field_key)) byKey.set(row.field_key, new Map());
    const counts = byKey.get(row.field_key)!;
    counts.set(row.field_value, (counts.get(row.field_value) ?? 0) + 1);
  }

  const getMostCommon = (code: string, key: string): string | undefined => {
    const counts = fieldValueCounts.get(code)?.get(key);
    if (!counts || counts.size === 0) return undefined;
    return [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  };

  // Aggregate estimate_items by canonical_code
  const codeMap = new Map<string, { itemLabel: string; usageCount: number }>();
  for (const row of itemsResult.data ?? []) {
    const code = row.canonical_code ?? '';
    const existing = codeMap.get(code);
    if (existing) {
      existing.usageCount += 1;
    } else {
      codeMap.set(code, { itemLabel: row.item_label, usageCount: 1 });
    }
  }

  type CodeInfo = {
    canonicalCode: string;
    itemLabel: string;
    usageCount: number;
    category: ItemCategory;
    series?: string;
    material?: string;
    openingWidth?: string;
    openingHeight?: string;
    groupKey: string;
  };

  const codeInfos: CodeInfo[] = Array.from(codeMap.entries()).map(
    ([code, { itemLabel, usageCount }]) => {
      const series = getMostCommon(code, 'series');
      const material = getMostCommon(code, 'material');
      const openingWidth = getMostCommon(code, 'opening_width');
      const openingHeight = getMostCommon(code, 'opening_height');

      const labelLower = itemLabel.toLowerCase();
      let category: ItemCategory;
      if (labelLower.includes('door')) {
        category = 'doors';
      } else if (labelLower.includes('frame')) {
        category = 'frames';
      } else {
        category = 'hardware';
      }

      // Only collapse into a group when ALL four key fields are present;
      // otherwise keep this code as its own singleton group.
      const hasAllKeyFields = series && material && openingWidth && openingHeight;
      const groupKey = hasAllKeyFields
        ? `${category}::${series}::${material}::${openingWidth}::${openingHeight}`
        : `${category}::${code}`;

      return {
        canonicalCode: code,
        itemLabel,
        usageCount,
        category,
        series,
        material,
        openingWidth,
        openingHeight,
        groupKey,
      };
    }
  );

  // Collapse codes that share a group key
  const groups = new Map<string, { items: CodeInfo[]; totalUsage: number }>();
  for (const info of codeInfos) {
    if (!groups.has(info.groupKey)) groups.set(info.groupKey, { items: [], totalUsage: 0 });
    const group = groups.get(info.groupKey)!;
    group.items.push(info);
    group.totalUsage += info.usageCount;
  }

  const discoveredItems = Array.from(groups.values())
    .map(({ items, totalUsage }) => {
      // Elect the most-used code as the representative for field management
      const primary = items.reduce((a, b) => (b.usageCount > a.usageCount ? b : a));
      return {
        canonicalCode: primary.canonicalCode,
        canonicalCodes: items.map((i) => i.canonicalCode),
        itemLabel: primary.series ?? primary.itemLabel,
        usageCount: totalUsage,
        category: primary.category,
        series: primary.series,
        material: primary.material,
        openingWidth: primary.openingWidth,
        openingHeight: primary.openingHeight,
      } as ItemType;
    })
    .sort((a, b) => b.usageCount - a.usageCount);

  // Merge hardware catalog items into the hardware category, de-duped by canonical_code.
  // Catalog items that already appear as discovered items are skipped to avoid duplication.
  const discoveredCodes = new Set(
    discoveredItems.flatMap((i) => i.canonicalCodes)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalogItems: ItemType[] = (catalogResult.data ?? []).map((row: any) => ({
    canonicalCode: row.canonical_code,
    canonicalCodes: [row.canonical_code],
    itemLabel: row.name,
    usageCount: 0,
    category: 'hardware' as ItemCategory,
    subcategory: row.subcategory as HardwareSubcategory,
  })).filter((item) => !discoveredCodes.has(item.canonicalCode));

  return [...discoveredItems, ...catalogItems];
}

/**
 * Returns all item_type_fields rows for one or more canonical codes, joined
 * with their field_definition.  Passing an array is needed for grouped items
 * that have multiple variant codes so fields stored under any variant are
 * included.
 */
export async function getItemTypeFields(
  canonicalCode: string | string[]
): Promise<ItemTypeField[]> {
  const codes = Array.isArray(canonicalCode) ? canonicalCode : [canonicalCode];
  const { data, error } = await supabase
    .from('item_type_fields')
    .select('*, field_definitions(*)')
    .in('canonical_code', codes)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch item type fields: ${error.message}`);

  // Deduplicate by field_definition_id — the DB has a unique constraint, but guard
  // against any edge cases that might produce duplicates.
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const unique = rows.filter((row) => {
    if (seen.has(row.field_definition_id)) return false;
    seen.add(row.field_definition_id);
    return true;
  });

  return unique.map((row) => mapItemTypeFieldRow(row));
}

/**
 * Insert or update a field association for an item type.
 * Uses ON CONFLICT DO UPDATE to toggle is_required on re-insert.
 */
export async function upsertItemTypeField(
  canonicalCode: string,
  fieldDefinitionId: string,
  isRequired: boolean
): Promise<ItemTypeField> {
  const { data, error } = await supabase
    .from('item_type_fields')
    .upsert(
      {
        canonical_code: canonicalCode,
        field_definition_id: fieldDefinitionId,
        is_required: isRequired,
      },
      { onConflict: 'canonical_code,field_definition_id', ignoreDuplicates: false }
    )
    .select('*, field_definitions(*)')
    .single();

  if (error) throw new Error(`Failed to upsert item type field: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapItemTypeFieldRow(data as any);
}

/** Remove an explicit field association for an item type. */
export async function deleteItemTypeField(id: string): Promise<void> {
  const { error } = await supabase
    .from('item_type_fields')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete item type field: ${error.message}`);
}

/**
 * Delete an item type group by removing all estimate_items rows for every
 * canonical code in the group, and all item_type_fields for those codes.
 * - item_fields cascade-delete automatically.
 * - quote_items.estimate_item_id is SET NULL automatically.
 */
export async function deleteItemType(canonicalCodes: string[]): Promise<void> {
  if (canonicalCodes.length === 0) return;

  const [fieldsError, itemsError] = await Promise.all([
    supabase
      .from('item_type_fields')
      .delete()
      .in('canonical_code', canonicalCodes)
      .then(({ error }) => error),
    supabase
      .from('estimate_items')
      .delete()
      .in('canonical_code', canonicalCodes)
      .then(({ error }) => error),
  ]);

  if (fieldsError) throw new Error(`Failed to delete item type fields: ${fieldsError.message}`);
  if (itemsError) throw new Error(`Failed to delete item type: ${itemsError.message}`);
}

/**
 * Rename an item type by updating item_label for all estimate_items rows that
 * share any of the given canonical codes.
 */
export async function renameItemType(
  canonicalCodes: string[],
  newLabel: string
): Promise<void> {
  if (canonicalCodes.length === 0) return;

  const { error } = await supabase
    .from('estimate_items')
    .update({ item_label: newLabel })
    .in('canonical_code', canonicalCodes);

  if (error) throw new Error(`Failed to rename item type: ${error.message}`);
}

/**
 * Fetches the most recently used field values for a given set of canonical codes.
 * Returns a map of fieldKey → fieldValue, drawn from the most recently created
 * estimate_item that matches any of the provided codes.  Used to pre-populate
 * required fields in the Build Opening dialog.
 */
export async function getMostRecentFieldValuesForItem(
  canonicalCodes: string[]
): Promise<Record<string, string>> {
  if (canonicalCodes.length === 0) return {};

  const { data: recentItem, error: itemError } = await supabase
    .from('estimate_items')
    .select('id')
    .in('canonical_code', canonicalCodes)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (itemError || !recentItem) return {};

  const { data: fields, error: fieldsError } = await supabase
    .from('item_fields')
    .select('field_key, field_value')
    .eq('estimate_item_id', recentItem.id);

  if (fieldsError || !fields) return {};

  const result: Record<string, string> = {};
  for (const field of fields) {
    if (field.field_key && field.field_value != null) {
      result[field.field_key] = field.field_value;
    }
  }
  return result;
}

/**
 * Returns item_type_fields where is_required = true for a given canonical_code,
 * joined with their field_definition. Used by the estimate wizard to
 * auto-insert required fields when an item is added.
 */
export async function getRequiredFieldsForItem(
  canonicalCode: string
): Promise<ItemTypeField[]> {
  const { data, error } = await supabase
    .from('item_type_fields')
    .select('*, field_definitions(*)')
    .eq('canonical_code', canonicalCode)
    .eq('is_required', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch required fields: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => mapItemTypeFieldRow(row));
}

// ---------------------------------------------------------------------------
// Manufacturer Field Labels
// ---------------------------------------------------------------------------

/**
 * Returns all manufacturer field label aliases for a given field definition,
 * joined with the manufacturer company name.
 */
export async function getManufacturerFieldLabels(
  fieldDefinitionId: string
): Promise<ManufacturerFieldLabel[]> {
  const { data, error } = await supabase
    .from('manufacturer_field_labels')
    .select('*, companies(id, name)')
    .eq('field_definition_id', fieldDefinitionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch manufacturer field labels: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => mapManufacturerFieldLabelRow(row));
}

/**
 * Insert or update a manufacturer field label alias.
 * Upserts on (field_definition_id, manufacturer_id, manufacturer_field_label).
 */
export async function upsertManufacturerFieldLabel(input: {
  fieldDefinitionId: string;
  manufacturerId: string | null;
  manufacturerFieldLabel: string;
  notes?: string | null;
}): Promise<ManufacturerFieldLabel> {
  const { data, error } = await supabase
    .from('manufacturer_field_labels')
    .upsert(
      {
        field_definition_id: input.fieldDefinitionId,
        manufacturer_id: input.manufacturerId,
        manufacturer_field_label: input.manufacturerFieldLabel,
        notes: input.notes ?? null,
      },
      { onConflict: 'field_definition_id,manufacturer_id,manufacturer_field_label' }
    )
    .select('*, companies(id, name)')
    .single();

  if (error) throw new Error(`Failed to save manufacturer field label: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapManufacturerFieldLabelRow(data as any);
}

/** Permanently delete a manufacturer field label alias by its row ID. */
export async function deleteManufacturerFieldLabel(id: string): Promise<void> {
  const { error } = await supabase
    .from('manufacturer_field_labels')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete manufacturer field label: ${error.message}`);
}

/** Approve or revert a manufacturer field label alias by updating its status. */
export async function updateManufacturerFieldLabelStatus(
  id: string,
  status: ManufacturerFieldLabelStatus
): Promise<ManufacturerFieldLabel> {
  const { data, error } = await supabase
    .from('manufacturer_field_labels')
    .update({ status })
    .eq('id', id)
    .select('*, companies(id, name)')
    .single();

  if (error) throw new Error(`Failed to update manufacturer field label status: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapManufacturerFieldLabelRow(data as any);
}

/** Move a manufacturer field label alias to a different field definition. */
export async function moveManufacturerFieldLabel(
  id: string,
  newFieldDefinitionId: string
): Promise<ManufacturerFieldLabel> {
  const { data, error } = await supabase
    .from('manufacturer_field_labels')
    .update({ field_definition_id: newFieldDefinitionId })
    .eq('id', id)
    .select('*, companies(id, name)')
    .single();

  if (error) throw new Error(`Failed to move manufacturer field label: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapManufacturerFieldLabelRow(data as any);
}

// ---------------------------------------------------------------------------
// Blocked Field Labels
// ---------------------------------------------------------------------------

/**
 * Return all blocked field labels. Used to display the blocked list in the
 * Items page and to seed the Edge Function's exclusion list.
 */
export async function getBlockedFieldLabels(): Promise<BlockedFieldLabel[]> {
  const { data, error } = await supabase
    .from('blocked_field_labels')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch blocked field labels: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map(mapBlockedFieldLabelRow);
}

/**
 * Add a field label to the blocked list so the AI never extracts it again.
 * Silently ignores duplicates (same label already blocked).
 */
export async function addBlockedFieldLabel(input: {
  fieldLabel: string;
  fieldKey?: string | null;
  fieldDefinitionId?: string | null;
  blockedByUserId?: string | null;
  notes?: string | null;
}): Promise<BlockedFieldLabel> {
  const { data, error } = await supabase
    .from('blocked_field_labels')
    .insert({
      field_label: input.fieldLabel,
      field_key: input.fieldKey ?? null,
      field_definition_id: input.fieldDefinitionId ?? null,
      blocked_by_user_id: input.blockedByUserId ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    // Unique constraint violation (field_label already blocked) — fetch and return existing row
    if (error.code === '23505') {
      const { data: existing, error: fetchError } = await supabase
        .from('blocked_field_labels')
        .select()
        .ilike('field_label', input.fieldLabel)
        .single();
      if (fetchError) throw new Error(`Failed to block field label: ${fetchError.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mapBlockedFieldLabelRow(existing as any);
    }
    throw new Error(`Failed to block field label: ${error.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapBlockedFieldLabelRow(data as any);
}

/** Remove a field label from the blocked list (unblock it). */
export async function removeBlockedFieldLabel(id: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_field_labels')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to unblock field label: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Hardware Catalog
// ---------------------------------------------------------------------------

/**
 * Fetch hardware catalog items, optionally filtered by subcategory,
 * ordered by sort_order ascending.
 * By default only active items are returned; pass `{ includeInactive: true }`
 * to fetch all items regardless of active status (e.g. for admin management).
 */
export async function getHardwareCatalog(
  subcategory?: HardwareSubcategory,
  options?: { includeInactive?: boolean }
): Promise<HardwareCatalogItem[]> {
  let query = supabase
    .from('hardware_catalog')
    .select('*')
    .order('sort_order', { ascending: true });

  if (!options?.includeInactive) {
    query = query.eq('active', true);
  }

  if (subcategory) {
    query = query.eq('subcategory', subcategory);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch hardware catalog: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map(mapHardwareCatalogRow);
}

/** Admin: create a new hardware catalog item. */
export async function createHardwareCatalogItem(
  item: Omit<HardwareCatalogItem, 'id'>
): Promise<HardwareCatalogItem> {
  const { data, error } = await supabase
    .from('hardware_catalog')
    .insert({
      name: item.name,
      canonical_code: item.canonicalCode,
      subcategory: item.subcategory,
      description: item.description ?? null,
      active: item.active,
      sort_order: item.sortOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create hardware catalog item: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapHardwareCatalogRow(data as any);
}

/** Admin: update fields on an existing hardware catalog item. */
export async function updateHardwareCatalogItem(
  id: string,
  updates: Partial<Omit<HardwareCatalogItem, 'id'>>
): Promise<HardwareCatalogItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.canonicalCode !== undefined) row.canonical_code = updates.canonicalCode;
  if (updates.subcategory !== undefined) row.subcategory = updates.subcategory;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.active !== undefined) row.active = updates.active;
  if (updates.sortOrder !== undefined) row.sort_order = updates.sortOrder;

  const { data, error } = await supabase
    .from('hardware_catalog')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update hardware catalog item: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapHardwareCatalogRow(data as any);
}

/** Admin: permanently delete a hardware catalog item. */
export async function deleteHardwareCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from('hardware_catalog').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete hardware catalog item: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Row Mappers  (snake_case DB rows  ->  camelCase TypeScript types)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEstimateRow(row: any): Estimate {
  return {
    id: row.id,
    companyId: row.company_id,
    uploadedByUserId: row.uploaded_by_user_id,
    source: row.source,
    originalFileUrl: row.original_file_url,
    originalFileName: row.original_file_name,
    fileType: row.file_type,
    ocrStatus: row.ocr_status,
    ocrError: row.ocr_error,
    extractedCustomerName: row.extracted_customer_name,
    extractedCustomerContact: row.extracted_customer_contact,
    extractedCustomerEmail: row.extracted_customer_email,
    extractedCustomerPhone: row.extracted_customer_phone,
    customerConfidence: row.customer_confidence,
    totalPrice: row.total_price,
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEstimateItemRow(row: any): EstimateItem {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    itemLabel: row.item_label,
    canonicalCode: row.canonical_code,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    sortOrder: row.sort_order,
    manufacturerId: row.manufacturer_id ?? null,
    openingId: row.opening_id ?? null,
    parentItemId: row.parent_item_id ?? null,
    subcategory: row.subcategory ?? null,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEstimateOpeningRow(row: any): EstimateOpening {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    name: row.name,
    quantity: row.quantity,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemFieldRow(row: any): ItemField {
  return {
    id: row.id,
    estimateItemId: row.estimate_item_id,
    fieldDefinitionId: row.field_definition_id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    fieldValue: row.field_value,
    valueType: row.value_type,
    sourceConfidence: row.source_confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFieldDefinitionRow(row: any): FieldDefinition {
  return {
    id: row.id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    valueType: row.value_type,
    description: row.description,
    status: row.status,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItemTypeFieldRow(row: any): ItemTypeField {
  return {
    id: row.id,
    canonicalCode: row.canonical_code,
    fieldDefinitionId: row.field_definition_id,
    isRequired: row.is_required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fieldDefinition: row.field_definitions
      ? mapFieldDefinitionRow(row.field_definitions)
      : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapManufacturerFieldLabelRow(row: any): ManufacturerFieldLabel {
  return {
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    manufacturerId: row.manufacturer_id ?? null,
    manufacturerFieldLabel: row.manufacturer_field_label,
    status: (row.status as ManufacturerFieldLabelStatus) ?? 'pending',
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    manufacturer: row.companies
      ? { id: row.companies.id, name: row.companies.name }
      : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBlockedFieldLabelRow(row: any): BlockedFieldLabel {
  return {
    id: row.id,
    fieldLabel: row.field_label,
    fieldKey: row.field_key ?? null,
    fieldDefinitionId: row.field_definition_id ?? null,
    blockedByUserId: row.blocked_by_user_id ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapHardwareCatalogRow(row: any): HardwareCatalogItem {
  return {
    id: row.id,
    name: row.name,
    canonicalCode: row.canonical_code,
    subcategory: row.subcategory as HardwareSubcategory,
    description: row.description ?? undefined,
    active: row.active,
    sortOrder: row.sort_order,
  };
}
