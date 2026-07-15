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
  OpeningTemplateType,
} from '@/types';
import {
  buildEstimateSpecSummary,
  type OpeningSnapshotRow,
} from '@/lib/cpq/estimate-spec-summary';

// ---------------------------------------------------------------------------
// Upload & Process
// ---------------------------------------------------------------------------

/** Upload a file to Supabase Storage and create the estimate record. */
export async function uploadEstimateFile(
  file: File,
  userId: string
): Promise<{ estimateId: string; filePath: string }> {
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The maximum upload size is 50 MB.`);
  }
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
  const [estimatesRes, itemsRes, openingsRes, quotesRes] = await Promise.all([
    supabase
      .from('estimates')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('estimate_items')
      .select('id, estimate_id, canonical_code, item_label, item_type, subcategory'),
    supabase
      .from('estimate_openings')
      .select('id, estimate_id, name, sort_order, spec_snapshot'),
    supabase
      .from('quotes')
      .select('id, estimate_id, status, created_at')
      .order('created_at', { ascending: false }),
  ]);

  if (estimatesRes.error)
    throw new Error(`Failed to list estimates: ${estimatesRes.error.message}`);
  if (itemsRes.error)
    throw new Error(`Failed to fetch estimate items: ${itemsRes.error.message}`);
  if (quotesRes.error)
    throw new Error(`Failed to fetch quote statuses: ${quotesRes.error.message}`);

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
  const itemsByEstimate = new Map<
    string,
    EstimateWithItems['items']
  >();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (itemsRes.data || []) as any[]) {
    const list = itemsByEstimate.get(item.estimate_id) ?? [];
    list.push({
      id: item.id,
      canonicalCode: item.canonical_code ?? '',
      itemLabel: item.item_label ?? '',
      itemType: item.item_type ?? null,
      subcategory: item.subcategory ?? null,
    });
    itemsByEstimate.set(item.estimate_id, list);
  }

  // Count openings per estimate and collect their spec snapshots (for the
  // spec-driven quick-reference summary shown in the list).
  const openingsCountByEstimate = new Map<string, number>();
  const openingNamesByEstimate = new Map<string, string[]>();
  const snapshotsByEstimate = new Map<string, OpeningSnapshotRow[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const opening of (openingsRes.data || []) as any[]) {
    openingsCountByEstimate.set(
      opening.estimate_id,
      (openingsCountByEstimate.get(opening.estimate_id) ?? 0) + 1
    );
    const names = openingNamesByEstimate.get(opening.estimate_id) ?? [];
    if (opening.name) names.push(opening.name);
    openingNamesByEstimate.set(opening.estimate_id, names);
    if (opening.spec_snapshot) {
      const list = snapshotsByEstimate.get(opening.estimate_id) ?? [];
      list.push({
        sortOrder: (opening.sort_order as number) ?? 0,
        snapshot: opening.spec_snapshot,
      });
      snapshotsByEstimate.set(opening.estimate_id, list);
    }
  }

  const quoteSummaryByEstimate = new Map<string, { latestStatus: EstimateWithItems['latestQuoteStatus']; count: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const quote of (quotesRes.data || []) as any[]) {
    const current = quoteSummaryByEstimate.get(quote.estimate_id);
    quoteSummaryByEstimate.set(quote.estimate_id, {
      latestStatus: current?.latestStatus ?? quote.status ?? null,
      count: (current?.count ?? 0) + 1,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (estimatesRes.data || []).map((row: any) => ({
    ...mapEstimateRow(row),
    items: itemsByEstimate.get(row.id) ?? [],
    createdByUserName: userNameMap.get(row.uploaded_by_user_id) ?? null,
    openingsCount: openingsCountByEstimate.get(row.id) ?? 0,
    openingNames: openingNamesByEstimate.get(row.id) ?? [],
    latestQuoteStatus: quoteSummaryByEstimate.get(row.id)?.latestStatus ?? null,
    quoteCount: quoteSummaryByEstimate.get(row.id)?.count ?? 0,
    specSummary: buildEstimateSpecSummary(snapshotsByEstimate.get(row.id) ?? []),
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
      | 'jobName'
      | 'jobLocation'
      | 'jobNumber'
      | 'customerPo'
      | 'quoteDate'
      | 'shippingMethod'
      | 'terms'
      | 'delivery'
      | 'shipToSource'
      | 'shipToAddress'
      | 'shipToCity'
      | 'shipToState'
      | 'shipToZip'
      | 'customerContactId'
      | 'customerRepName'
      | 'customerRepPhone'
      | 'customerRepEmail'
      | 'internalNotes'
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
  if (updates.jobName !== undefined) row.job_name = updates.jobName;
  if (updates.jobLocation !== undefined) row.job_location = updates.jobLocation;
  if (updates.jobNumber !== undefined) row.job_number = updates.jobNumber;
  if (updates.customerPo !== undefined) row.customer_po = updates.customerPo;
  if (updates.quoteDate !== undefined) row.quote_date = updates.quoteDate;
  if (updates.shippingMethod !== undefined) row.shipping_method = updates.shippingMethod;
  if (updates.terms !== undefined) row.terms = updates.terms;
  if (updates.delivery !== undefined) row.delivery = updates.delivery;
  if (updates.shipToSource !== undefined) row.ship_to_source = updates.shipToSource;
  if (updates.shipToAddress !== undefined) row.ship_to_address = updates.shipToAddress;
  if (updates.shipToCity !== undefined) row.ship_to_city = updates.shipToCity;
  if (updates.shipToState !== undefined) row.ship_to_state = updates.shipToState;
  if (updates.shipToZip !== undefined) row.ship_to_zip = updates.shipToZip;
  if (updates.customerContactId !== undefined) row.customer_contact_id = updates.customerContactId;
  if (updates.customerRepName !== undefined) row.customer_rep_name = updates.customerRepName;
  if (updates.customerRepPhone !== undefined) row.customer_rep_phone = updates.customerRepPhone;
  if (updates.customerRepEmail !== undefined) row.customer_rep_email = updates.customerRepEmail;
  if (updates.internalNotes !== undefined) row.internal_notes = updates.internalNotes;

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
    Pick<EstimateItem, 'itemLabel' | 'canonicalCode' | 'quantity' | 'unitPrice' | 'sortOrder' | 'openingId' | 'manufacturerId' | 'priceSource' | 'priceLookupMetadata' | 'isManualPriceOverride'>
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
  if (updates.manufacturerId !== undefined) row.manufacturer_id = updates.manufacturerId;
  if (updates.priceSource !== undefined) row.price_source = updates.priceSource;
  if (updates.priceLookupMetadata !== undefined) row.price_lookup_metadata = updates.priceLookupMetadata;
  if (updates.isManualPriceOverride !== undefined) row.is_manual_price_override = updates.isManualPriceOverride;

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
    itemType?: string | null;
    manufacturerId?: string | null;
    unitPrice?: number | null;
    priceSource?: 'lookup' | 'manual' | 'ocr' | null;
    priceLookupMetadata?: Record<string, unknown> | null;
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
      item_type: item.itemType ?? null,
      manufacturer_id: item.manufacturerId ?? null,
      unit_price: item.unitPrice ?? null,
      price_source: item.priceSource ?? null,
      price_lookup_metadata: item.priceLookupMetadata ?? null,
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
      job_name: estimate.jobName,
      job_location: estimate.jobLocation,
      job_number: estimate.jobNumber,
      customer_po: estimate.customerPo,
      quote_date: estimate.quoteDate,
      shipping_method: estimate.shippingMethod,
      terms: estimate.terms,
      delivery: estimate.delivery,
      ship_to_source: estimate.shipToSource,
      ship_to_address: estimate.shipToAddress,
      ship_to_city: estimate.shipToCity,
      ship_to_state: estimate.shipToState,
      ship_to_zip: estimate.shipToZip,
      customer_contact_id: estimate.customerContactId,
      customer_rep_name: estimate.customerRepName,
      customer_rep_phone: estimate.customerRepPhone,
      customer_rep_email: estimate.customerRepEmail,
      internal_notes: estimate.internalNotes,
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
  quantity: number = 1,
  templateType?: OpeningTemplateType | null
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
      ...(templateType !== undefined ? { template_type: templateType } : {}),
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

/** Update the option type (selection | string | integer) for a field definition. */
export async function updateFieldOptionType(
  fieldDefinitionId: string,
  optionType: import('@/types').OptionType
): Promise<void> {
  const { error } = await supabase
    .from('field_definitions')
    .update({ option_type: optionType })
    .eq('id', fieldDefinitionId);
  if (error)
    throw new Error(`Failed to update field option type: ${error.message}`);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFieldValueOptionRow(row: any): FieldValueOption {
  return {
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    value: row.value,
    usageCount: row.usage_count ?? 0,
    sortOrder: row.sort_order ?? 0,
    isDefault: row.is_default ?? false,
    codeToken: row.code_token ?? null,
    createdAt: row.created_at,
  };
}

/**
 * For a set of field definitions, returns the best default value for each field.
 * Priority:
 *   1. item-specific is_default from item_type_field_value_options
 *   2. global is_default from field_value_options
 *   3. first option by sort_order from field_value_options
 *
 * Returns a map of fieldKey → default value string (only populated entries included).
 */
export async function getDefaultValuesForFields(
  fieldDefinitionIds: string[],
  canonicalCode: string,
  fieldKeyById: Record<string, string>
): Promise<Record<string, string>> {
  if (fieldDefinitionIds.length === 0) return {};

  const [globalResult, itemResult] = await Promise.all([
    supabase
      .from('field_value_options')
      .select('field_definition_id, value, is_default, sort_order')
      .in('field_definition_id', fieldDefinitionIds)
      .order('sort_order', { ascending: true })
      .order('value', { ascending: true }),
    supabase
      .from('item_type_field_value_options')
      .select('field_definition_id, value, is_default, sort_order')
      .eq('canonical_code', canonicalCode)
      .in('field_definition_id', fieldDefinitionIds)
      .order('sort_order', { ascending: true }),
  ]);

  if (globalResult.error) throw new Error(`Failed to fetch field options: ${globalResult.error.message}`);
  if (itemResult.error) throw new Error(`Failed to fetch item field options: ${itemResult.error.message}`);

  type FieldOptionDbRow = { field_definition_id: string; value: string; is_default: boolean | null };
  const globalByDef = new Map<string, Array<{ value: string; isDefault: boolean }>>();
  for (const row of (globalResult.data ?? []) as FieldOptionDbRow[]) {
    const list = globalByDef.get(row.field_definition_id) ?? [];
    list.push({ value: row.value, isDefault: row.is_default ?? false });
    globalByDef.set(row.field_definition_id, list);
  }

  const itemByDef = new Map<string, Array<{ value: string; isDefault: boolean }>>();
  for (const row of (itemResult.data ?? []) as FieldOptionDbRow[]) {
    const list = itemByDef.get(row.field_definition_id) ?? [];
    list.push({ value: row.value, isDefault: row.is_default ?? false });
    itemByDef.set(row.field_definition_id, list);
  }

  const result: Record<string, string> = {};
  for (const defId of fieldDefinitionIds) {
    const fieldKey = fieldKeyById[defId];
    if (!fieldKey) continue;

    // Only pre-select if an item-specific default is starred on the items page.
    // Global field_value_options defaults (from the master item fields page) are
    // intentionally ignored so that dropdowns start blank unless the user has
    // explicitly starred an option for this particular item.
    const itemOpts = itemByDef.get(defId) ?? [];
    const itemDefault = itemOpts.find((o) => o.isDefault);
    if (itemDefault) { result[fieldKey] = itemDefault.value; continue; }
  }

  return result;
}

/**
 * Returns the effective option list for a (canonicalCode, fieldDefinitionId) pair
 * as used by the estimate wizard.
 *
 * If item-specific options exist in item_type_field_value_options for this item,
 * those are returned (respecting any per-item ordering / additions the user made
 * on the Items page).  Otherwise falls back to the global field_value_options set.
 */
export async function getItemFieldValueOptionsForWizard(
  canonicalCode: string,
  fieldDefinitionId: string
): Promise<FieldValueOption[]> {
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

  const perItemRows = perItemResult.data ?? [];
  if (perItemRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return perItemRows.map((row: any) => ({
      id: row.id,
      fieldDefinitionId: row.field_definition_id,
      value: row.value,
      usageCount: 0,
      sortOrder: row.sort_order ?? 0,
      isDefault: row.is_default ?? false,
      codeToken: row.code_token ?? null,
      createdAt: row.created_at,
    }));
  }

  return (globalResult.data ?? []).map(mapFieldValueOptionRow);
}

/** Fetch options for a field definition, ordered by sort_order then alphabetically. */
export async function getFieldValueOptions(
  fieldDefinitionId: string
): Promise<FieldValueOption[]> {
  const { data, error } = await supabase
    .from('field_value_options')
    .select('*')
    .eq('field_definition_id', fieldDefinitionId)
    .order('sort_order', { ascending: true })
    .order('value', { ascending: true });

  if (error) throw new Error(`Failed to fetch field value options: ${error.message}`);
  return (data || []).map(mapFieldValueOptionRow);
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

/** Add a brand-new option for a field definition (sort_order defaults to 0; user can reorder). */
export async function addFieldValueOption(
  fieldDefinitionId: string,
  value: string
): Promise<FieldValueOption> {
  const { data, error } = await supabase
    .from('field_value_options')
    .insert({ field_definition_id: fieldDefinitionId, value, usage_count: 0, sort_order: 0, is_default: false })
    .select()
    .single();

  if (error) throw new Error(`Failed to add field value option: ${error.message}`);
  return mapFieldValueOptionRow(data);
}

/** Update the display value of an existing field value option. */
export async function updateFieldValueOption(
  id: string,
  value: string
): Promise<FieldValueOption> {
  const { data, error } = await supabase
    .from('field_value_options')
    .update({ value })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update field value option: ${error.message}`);
  return mapFieldValueOptionRow(data);
}

/** Permanently remove a field value option. */
export async function deleteFieldValueOption(id: string): Promise<void> {
  const { error } = await supabase
    .from('field_value_options')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete field value option: ${error.message}`);
}

/**
 * Set a single default option for a field definition. Clears any previous default
 * for that field first, then marks the given option (or no option if null).
 */
export async function setDefaultFieldValueOption(
  fieldDefinitionId: string,
  optionId: string | null
): Promise<void> {
  // Clear current default
  const { error: clearErr } = await supabase
    .from('field_value_options')
    .update({ is_default: false })
    .eq('field_definition_id', fieldDefinitionId)
    .eq('is_default', true);
  if (clearErr) throw new Error(`Failed to clear default option: ${clearErr.message}`);

  if (optionId) {
    const { error: setErr } = await supabase
      .from('field_value_options')
      .update({ is_default: true })
      .eq('id', optionId);
    if (setErr) throw new Error(`Failed to set default option: ${setErr.message}`);
  }
}

/** Persist a new sort_order for a batch of options (after drag-and-drop). */
export async function reorderFieldValueOptions(
  orderedIds: string[]
): Promise<void> {
  const updates = orderedIds.map((id, idx) =>
    supabase.from('field_value_options').update({ sort_order: idx }).eq('id', id)
  );
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) throw new Error(`Failed to reorder options: ${error.message}`);
  }
}

/** Persist sort_order for "other" field definitions after drag-and-drop. */
export async function reorderFieldDefinitions(
  orderedIds: string[]
): Promise<void> {
  const updates = orderedIds.map((id, idx) =>
    supabase.from('field_definitions').update({ sort_order: idx }).eq('id', id)
  );
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) throw new Error(`Failed to reorder field definitions: ${error.message}`);
  }
}

const DOOR_BIG_FIVE = new Set(['material', 'series', 'gauge', 'opening_width', 'opening_height']);

/**
 * Returns all field definitions that are associated (via item_type_fields) with
 * any canonical code tagged as item_type = 'doors'. The big-five structural
 * keys (material, series, gauge, opening_width, opening_height) are excluded
 * because they are handled by dedicated wizard steps.
 */
export async function getDoorFieldDefinitions(): Promise<FieldDefinition[]> {
  return getCategoryFieldDefinitions('doors');
}

/**
 * Returns all field definitions associated (via item_type_fields) with any
 * canonical code tagged as `item_type = slug`.  Base fields for the given
 * slug (from item_type_base_fields) are excluded since they are handled
 * by dedicated wizard sections.
 */
export async function getCategoryFieldDefinitions(slug: string): Promise<FieldDefinition[]> {
  // 1. Get all distinct canonical codes that belong to this item type.
  const { data: itemRows, error: itemsError } = await supabase
    .from('estimate_items')
    .select('canonical_code, item_type');

  if (itemsError) throw new Error(`Failed to fetch estimate_items: ${itemsError.message}`);

  const categoryCodes = Array.from(
    new Set(
      (itemRows ?? [])
        .filter((r) => r.item_type === slug)
        .map((r) => r.canonical_code as string)
        .filter(Boolean)
    )
  );

  if (categoryCodes.length === 0) return [];

  // 2. Fetch the base field keys for this slug so we can exclude them.
  const { data: baseFieldRows, error: baseFieldsError } = await supabase
    .from('item_type_base_fields')
    .select('field_definitions(field_key)')
    .eq('item_type_slug', slug);

  if (baseFieldsError) throw new Error(`Failed to fetch base fields: ${baseFieldsError.message}`);

  const baseFieldKeySet = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (baseFieldRows ?? []).map((r: any) => (r.field_definitions as any)?.field_key).filter(Boolean)
  );

  // Fall back to the legacy DOOR_BIG_FIVE exclusion for doors if no base fields are seeded yet.
  const excludeKeys =
    baseFieldKeySet.size > 0 ? baseFieldKeySet : slug === 'doors' ? DOOR_BIG_FIVE : new Set<string>();

  // 3. Fetch item_type_fields for those codes, joined with field_definitions.
  const { data: typeFieldRows, error: tfError } = await supabase
    .from('item_type_fields')
    .select('field_definitions(*)')
    .in('canonical_code', categoryCodes);

  if (tfError) throw new Error(`Failed to fetch item_type_fields: ${tfError.message}`);

  // 4. Deduplicate by field_definition_id and exclude base field keys.
  const seen = new Set<string>();
  const results: FieldDefinition[] = [];
  for (const row of typeFieldRows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd = (row as any).field_definitions;
    if (!fd || seen.has(fd.id)) continue;
    if (excludeKeys.has(fd.field_key)) continue;
    seen.add(fd.id);
    results.push(mapFieldDefinitionRow(fd));
  }

  return results;
}

/**
 * Creates a new manual (catalog) item without tying it to any estimate.
 * Inserts one `estimate_items` row (estimate_id = null, item_type = itemTypeSlug)
 * and one `item_fields` row per provided field value.
 */
export async function createManualItem(input: {
  itemLabel: string;
  canonicalCode: string;
  itemTypeSlug: string;
  fieldValues: Array<{
    fieldKey: string;
    fieldLabel: string;
    fieldValue: string;
    valueType: FieldValueType;
    fieldDefinitionId?: string | null;
  }>;
}): Promise<EstimateItem> {
  const { data: newItem, error: itemError } = await supabase
    .from('estimate_items')
    .insert({
      item_label: input.itemLabel,
      canonical_code: input.canonicalCode,
      item_type: input.itemTypeSlug,
      quantity: 1,
      sort_order: 0,
    })
    .select()
    .single();

  if (itemError || !newItem) {
    throw new Error(`Failed to create item: ${itemError?.message ?? 'unknown'}`);
  }

  if (input.fieldValues.length > 0) {
    const { error: fieldsError } = await supabase.from('item_fields').insert(
      input.fieldValues.map((fv) => ({
        estimate_item_id: newItem.id,
        field_key: fv.fieldKey,
        field_label: fv.fieldLabel,
        field_value: fv.fieldValue,
        value_type: fv.valueType,
        field_definition_id: fv.fieldDefinitionId ?? null,
      }))
    );

    if (fieldsError) {
      await supabase.from('estimate_items').delete().eq('id', newItem.id);
      throw new Error(`Failed to create item fields: ${fieldsError.message}`);
    }
  }

  return mapEstimateItemRow(newItem);
}

// ---------------------------------------------------------------------------
// Item Types & Item Type Fields
// ---------------------------------------------------------------------------

/**
 * Returns item types grouped by category (doors / frames / hardware).
 *
 * Within the Doors and Frames categories, items that share identical values for
 * series + material + gauge + opening_width + opening_height are collapsed into a single
 * group (same physical product, different hardware/finish codes).  Items that
 * are missing any of those five key fields each remain their own group.
 *
 * Hardware items always remain per-canonical-code.
 *
 * The returned `canonicalCode` is the primary (most-used) code for field
 * management; `canonicalCodes` lists every code in the group.
 */
export async function getItemTypes(): Promise<ItemType[]> {
  const KEY_FIELDS = ['series', 'material', 'gauge', 'opening_width', 'opening_height'] as const;

  const [itemsResult, keyFieldsResult, catalogResult, registryResult] = await Promise.all([
    supabase.from('estimate_items').select('canonical_code, item_label, item_type'),
    supabase
      .from('item_fields')
      .select('field_value, field_key, estimate_items!inner(canonical_code)')
      .in('field_key', [...KEY_FIELDS]),
    supabase
      .from('hardware_catalog')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('item_type_registry')
      .select('slug, name')
      .is('parent_slug', null)
      .not('slug', 'in', '("doors","frames","hardware")')
      .eq('is_system', false),
  ]);

  if (itemsResult.error) throw new Error(`Failed to fetch item types: ${itemsResult.error.message}`);

  // Build a set of codes that exist in the hardware catalog so we can
  // override the label-based category check for items like "Door Closer…"
  const hardwareCatalogCodes = new Set<string>(
    (catalogResult.data ?? []).map((row) => String((row as Record<string, unknown>).canonical_code ?? ''))
  );

  // Build per-canonical-code value-count maps: code -> fieldKey -> value -> count
  const fieldValueCounts = new Map<string, Map<string, Map<string, number>>>();
  for (const row of keyFieldsResult.data ?? []) {
    const relation = row.estimate_items as unknown as { canonical_code?: string | null } | null;
    const code = relation?.canonical_code ?? undefined;
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
  const codeMap = new Map<string, { itemLabel: string; usageCount: number; itemType: string | null }>();
  for (const row of itemsResult.data ?? []) {
    const code = row.canonical_code ?? '';
    const existing = codeMap.get(code);
    if (existing) {
      existing.usageCount += 1;
    } else {
      codeMap.set(code, { itemLabel: row.item_label, usageCount: 1, itemType: row.item_type ?? null });
    }
  }

  type CodeInfo = {
    canonicalCode: string;
    itemLabel: string;
    usageCount: number;
    category: ItemCategory;
    series?: string;
    material?: string;
    gauge?: string;
    openingWidth?: string;
    openingHeight?: string;
    groupKey: string;
  };

  const codeInfos: CodeInfo[] = Array.from(codeMap.entries()).map(
    ([code, { itemLabel, usageCount, itemType }]) => {
      const series = getMostCommon(code, 'series');
      const material = getMostCommon(code, 'material');
      const gauge = getMostCommon(code, 'gauge');
      const openingWidth = getMostCommon(code, 'opening_width');
      const openingHeight = getMostCommon(code, 'opening_height');

      // Hardware catalog codes take precedence — items like "Door Closer…"
      // contain "door" in their label but are hardware, not doors.
      let category: ItemCategory;
      if (hardwareCatalogCodes.has(code)) {
        category = 'hardware';
      } else if (itemType) {
        // Use the explicit item_type stored on the row (set when manually created)
        category = itemType as ItemCategory;
      } else if (gauge !== undefined) {
        // Gauge is a door-specific field — if it's present this is always a door
        // regardless of what the label says (e.g. after a rename to "Polystyrene").
        category = 'doors';
      } else {
        const labelLower = itemLabel.toLowerCase();
        if (labelLower.includes('door')) {
          category = 'doors';
        } else if (labelLower.includes('frame')) {
          category = 'frames';
        } else {
          category = 'hardware';
        }
      }

      // A different series constitutes a different item — group by series when
      // one is present, otherwise keep this code as its own singleton group.
      const groupKey = series
        ? `${category}::${series}`
        : `${category}::${code}`;

      return {
        canonicalCode: code,
        itemLabel,
        usageCount,
        category,
        series,
        material,
        gauge,
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
        gauge: primary.gauge,
        openingWidth: primary.openingWidth,
        openingHeight: primary.openingHeight,
      } as ItemType;
    })
    .sort((a, b) => b.usageCount - a.usageCount);

  // Merge hardware catalog items into the hardware category, de-duped by canonical_code.
  // Catalog items that already appear as discovered items are skipped to avoid duplication.
  // Legacy leaf rows (is_legacy = true) are excluded so they no longer surface in the picker;
  // they still exist in the DB so old estimates round-trip correctly.
  const discoveredCodes = new Set(
    discoveredItems.flatMap((i) => i.canonicalCodes)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalogItems: ItemType[] = (catalogResult.data ?? []).filter((row: any) => !(row.is_legacy ?? false)).map((row: any) => ({
    canonicalCode: row.canonical_code,
    canonicalCodes: [row.canonical_code],
    itemLabel: row.name,
    usageCount: 0,
    category: 'hardware' as ItemCategory,
    subcategory: row.subcategory as HardwareSubcategory,
    isFamily: row.is_family ?? false,
    hwCodePrefix: row.code_prefix ?? null,
  })).filter((item) => !discoveredCodes.has(item.canonicalCode));

  // Add virtual catalog entries for registry-defined categories (e.g. panels) that
  // don't yet have any estimate_items rows. This ensures the AddItemModal can show
  // at least one selectable item for each registered non-hardware category.
  const discoveredCategories = new Set(discoveredItems.map((i) => i.category));
  const registryVirtualItems: ItemType[] = (registryResult.data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((reg: any) => !discoveredCategories.has(reg.slug))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((reg: any) => ({
      canonicalCode: reg.slug.toUpperCase(),
      canonicalCodes: [reg.slug.toUpperCase()],
      itemLabel: reg.name,
      usageCount: 0,
      category: reg.slug as ItemCategory,
    }));

  return [...discoveredItems, ...catalogItems, ...registryVirtualItems];
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
 * Rename an item type globally across estimate_items, quote_items, and
 * hardware_catalog. For series-grouped items, also updates the series
 * field value in item_fields so the new label is reflected on reload.
 *
 * Uses a SECURITY DEFINER RPC to bypass per-user RLS restrictions that
 * would otherwise prevent renaming items belonging to other users' estimates.
 */
export async function renameItemType(
  canonicalCodes: string[],
  newLabel: string,
  series?: string
): Promise<void> {
  if (canonicalCodes.length === 0) return;

  const { error } = await supabase.rpc('rename_item_type', {
    p_canonical_codes: canonicalCodes,
    p_new_label: newLabel,
    p_series: series ?? null,
  });

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
 * Returns all field definitions for a given item-type category slug
 * (from item_type_base_fields), plus any item-specific additions
 * (from item_type_field_overrides) for the given canonical code.
 * This is the primary source of fields when building a new item in the wizard.
 */
export async function getBaseFieldsForCategory(
  categorySlug: string,
  canonicalCode: string
): Promise<ItemTypeField[]> {
  const [baseResult, overrideResult] = await Promise.all([
    supabase
      .from('item_type_base_fields')
      .select('id, field_definition_id, sort_order, created_at, field_definitions(*)')
      .eq('item_type_slug', categorySlug)
      .order('sort_order', { ascending: true }),
    // Fetch ALL overrides (including hidden) so we know which base fields to exclude
    supabase
      .from('item_type_field_overrides')
      .select('id, canonical_code, field_definition_id, is_required, is_hidden, is_added_locally, sort_order, created_at, updated_at, field_definitions(*)')
      .eq('canonical_code', canonicalCode)
      .order('sort_order', { ascending: true }),
  ]);

  if (baseResult.error) throw new Error(`Failed to fetch base fields: ${baseResult.error.message}`);
  if (overrideResult.error) throw new Error(`Failed to fetch field overrides: ${overrideResult.error.message}`);

  // Build a set of field_definition_ids hidden for this specific item
  const hiddenIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (overrideResult.data ?? []) as any[]) {
    if (row.is_hidden) hiddenIds.add(row.field_definition_id);
  }

  const seen = new Set<string>();
  const results: ItemTypeField[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (baseResult.data ?? []) as any[]) {
    const fd = row.field_definitions;
    if (!fd || seen.has(row.field_definition_id)) continue;
    // Skip base fields that have been hidden for this specific item on the Items page
    if (hiddenIds.has(row.field_definition_id)) continue;
    seen.add(row.field_definition_id);
    results.push({
      id: row.id,
      canonicalCode: categorySlug,
      fieldDefinitionId: row.field_definition_id,
      isRequired: false,
      createdAt: row.created_at,
      updatedAt: row.created_at,
      fieldDefinition: mapFieldDefinitionRow(fd),
    });
  }

  // Include locally-added fields (not hidden) and required-override fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (overrideResult.data ?? []) as any[]) {
    const fd = row.field_definitions;
    if (!fd || seen.has(row.field_definition_id)) continue;
    if (row.is_hidden) continue;
    seen.add(row.field_definition_id);
    results.push({
      id: row.id,
      canonicalCode: row.canonical_code,
      fieldDefinitionId: row.field_definition_id,
      isRequired: row.is_required ?? false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fieldDefinition: mapFieldDefinitionRow(fd),
    });
  }

  return results;
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

/**
 * Returns active hardware family rows (is_family = true), ordered by sort_order.
 * These are the configurable "builder" entries that drive the progressive-disclosure
 * picker in AddItemModal: Subcategory → Family → (cascading fields) → assembled code.
 */
export async function getHardwareFamilies(): Promise<HardwareCatalogItem[]> {
  const { data, error } = await supabase
    .from('hardware_catalog')
    .select('*')
    .eq('is_family', true)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch hardware families: ${error.message}`);
  return (data ?? []).map(mapHardwareCatalogRow);
}

/**
 * Returns active non-family (leaf) hardware catalog items for a given family.
 * Matches items both by the explicit `code_prefix` column AND by canonical_code
 * LIKE prefix (covering legacy leaf rows that have code_prefix = null but whose
 * canonical codes start with the family prefix, e.g. 'HINGE-MECH-SS-45X45-...').
 */
export async function getHardwareLeafItems(codePrefix: string): Promise<HardwareCatalogItem[]> {
  const { data, error } = await supabase
    .from('hardware_catalog')
    .select('*')
    .eq('is_family', false)
    .eq('active', true)
    .or(`code_prefix.eq.${codePrefix},canonical_code.like.${codePrefix}-%`)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch hardware leaf items: ${error.message}`);
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
    jobName: row.job_name ?? null,
    jobLocation: row.job_location ?? null,
    jobNumber: row.job_number ?? null,
    customerPo: row.customer_po ?? null,
    quoteDate: row.quote_date ?? null,
    shippingMethod: row.shipping_method ?? null,
    terms: row.terms ?? null,
    delivery: row.delivery ?? null,
    shipToSource: row.ship_to_source ?? null,
    shipToAddress: row.ship_to_address ?? null,
    shipToCity: row.ship_to_city ?? null,
    shipToState: row.ship_to_state ?? null,
    shipToZip: row.ship_to_zip ?? null,
    customerContactId: row.customer_contact_id ?? null,
    customerRepName: row.customer_rep_name ?? null,
    customerRepPhone: row.customer_rep_phone ?? null,
    customerRepEmail: row.customer_rep_email ?? null,
    internalNotes: row.internal_notes ?? null,
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sellAdjustmentPct: row.sell_adjustment_pct ?? null,
    estimateNotes: row.estimate_notes ?? null,
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
    itemType: row.item_type ?? null,
    priceSource: row.price_source ?? null,
    priceLookupMetadata: row.price_lookup_metadata ?? null,
    isManualPriceOverride: row.is_manual_price_override ?? false,
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
    templateType: row.template_type ?? null,
    specSnapshot: (row.spec_snapshot as Record<string, unknown> | null) ?? null,
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
    optionType: row.option_type ?? 'selection',
    description: row.description,
    status: row.status,
    usageCount: row.usage_count,
    sortOrder: row.sort_order ?? 0,
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
    isFamily: row.is_family ?? false,
    isLegacy: row.is_legacy ?? false,
    codePrefix: row.code_prefix ?? null,
    codeFieldKeys: row.code_field_keys ?? null,
    labelTemplate: row.label_template ?? null,
  };
}
