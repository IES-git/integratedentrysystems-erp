/**
 * Supabase-backed CRUD operations for Estimates, Estimate Items, Item Fields,
 * and Field Definitions.  Also provides the client for invoking the
 * `process-estimate` Edge Function (Gemini 3 Flash with Agentic Vision).
 */

import { supabase } from './supabase';
import type {
  Estimate,
  EstimateItem,
  ItemField,
  FieldDefinition,
  FieldDefinitionStatus,
  FieldValueType,
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

/** Fetch an estimate together with its items and their fields. */
export async function getEstimateWithItems(
  id: string
): Promise<{
  estimate: Estimate;
  items: (EstimateItem & { fields: ItemField[] })[];
} | null> {
  const { data, error } = await supabase
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
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch estimate: ${error.message}`);
  }

  const estimate = mapEstimateRow(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data.estimate_items || []).map((row: any) => ({
    ...mapEstimateItemRow(row),
    fields: (row.item_fields || []).map(mapItemFieldRow),
  }));

  return { estimate, items };
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

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/** Update top-level estimate fields (customer info, status, etc.). */
export async function updateEstimate(
  id: string,
  updates: Partial<
    Pick<
      Estimate,
      | 'customerId'
      | 'extractedCustomerName'
      | 'extractedCustomerContact'
      | 'extractedCustomerEmail'
      | 'extractedCustomerPhone'
    >
  >
): Promise<Estimate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.customerId !== undefined) row.customer_id = updates.customerId;
  if (updates.extractedCustomerName !== undefined)
    row.extracted_customer_name = updates.extractedCustomerName;
  if (updates.extractedCustomerContact !== undefined)
    row.extracted_customer_contact = updates.extractedCustomerContact;
  if (updates.extractedCustomerEmail !== undefined)
    row.extracted_customer_email = updates.extractedCustomerEmail;
  if (updates.extractedCustomerPhone !== undefined)
    row.extracted_customer_phone = updates.extractedCustomerPhone;

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
    Pick<EstimateItem, 'itemLabel' | 'canonicalCode' | 'quantity' | 'sortOrder'>
  >
): Promise<EstimateItem> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.itemLabel !== undefined) row.item_label = updates.itemLabel;
  if (updates.canonicalCode !== undefined)
    row.canonical_code = updates.canonicalCode;
  if (updates.quantity !== undefined) row.quantity = updates.quantity;
  if (updates.sortOrder !== undefined) row.sort_order = updates.sortOrder;

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

/** Add a new line item to an estimate. */
export async function addEstimateItem(
  estimateId: string,
  item: {
    itemLabel: string;
    canonicalCode?: string;
    quantity?: number;
    sortOrder?: number;
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
// File URLs
// ---------------------------------------------------------------------------

/** Generate a temporary signed URL for an estimate file (1-hour expiry). */
export async function getEstimateFileUrl(filePath: string): Promise<string> {
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

// ---------------------------------------------------------------------------
// Row Mappers  (snake_case DB rows  ->  camelCase TypeScript types)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEstimateRow(row: any): Estimate {
  return {
    id: row.id,
    customerId: row.customer_id,
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
    sortOrder: row.sort_order,
    createdAt: row.created_at,
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
