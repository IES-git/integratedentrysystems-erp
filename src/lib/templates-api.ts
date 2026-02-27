/**
 * Supabase-backed CRUD operations for Templates and Template Fields.
 */

import { supabase } from './supabase';
import type { Template, TemplateField, TemplateAudience, FieldVisibility } from '@/types';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  name: string;
  audience: TemplateAudience;
  description?: string;
  matchingRulesJson?: string | null;
  createdByUserId: string;
}

export interface UpdateTemplateInput {
  name?: string;
  audience?: TemplateAudience;
  description?: string;
  matchingRulesJson?: string | null;
}

export interface CreateTemplateFieldInput {
  templateId: string;
  fieldKey: string;
  displayLabelOverride?: string | null;
  groupName?: string | null;
  sortOrder?: number;
  visibility?: FieldVisibility;
  formattingHint?: string | null;
}

// ---------------------------------------------------------------------------
// Templates — List & Read
// ---------------------------------------------------------------------------

/** List all templates, most recently created first. */
export async function listTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list templates: ${error.message}`);
  return (data ?? []).map(mapTemplateRow);
}

/** Fetch a single template by ID. Returns null if not found. */
export async function getTemplate(id: string): Promise<Template | null> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch template: ${error.message}`);
  }

  return mapTemplateRow(data);
}

/** Fetch a template with all its fields, ordered by sort_order. */
export async function getTemplateWithFields(id: string): Promise<{
  template: Template;
  fields: TemplateField[];
} | null> {
  const { data, error } = await supabase
    .from('templates')
    .select('*, template_fields(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch template: ${error.message}`);
  }

  const template = mapTemplateRow(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields = ((data.template_fields ?? []) as any[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapTemplateFieldRow);

  return { template, fields };
}

// ---------------------------------------------------------------------------
// Templates — Create / Update / Delete
// ---------------------------------------------------------------------------

/** Create a new template. */
export async function createTemplate(input: CreateTemplateInput): Promise<Template> {
  const { data, error } = await supabase
    .from('templates')
    .insert({
      name: input.name,
      audience: input.audience,
      description: input.description ?? '',
      matching_rules_json: input.matchingRulesJson ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create template: ${error.message}`);
  return mapTemplateRow(data);
}

/** Update an existing template. */
export async function updateTemplate(
  id: string,
  updates: UpdateTemplateInput
): Promise<Template> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.name !== undefined) row.name = updates.name;
  if (updates.audience !== undefined) row.audience = updates.audience;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.matchingRulesJson !== undefined) row.matching_rules_json = updates.matchingRulesJson;

  const { data, error } = await supabase
    .from('templates')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update template: ${error.message}`);
  return mapTemplateRow(data);
}

/** Delete a template (cascades to template_fields). */
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete template: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Template Fields — Create / Update / Delete
// ---------------------------------------------------------------------------

/** List all fields for a template, ordered by sort_order. */
export async function listTemplateFields(templateId: string): Promise<TemplateField[]> {
  const { data, error } = await supabase
    .from('template_fields')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to list template fields: ${error.message}`);
  return (data ?? []).map(mapTemplateFieldRow);
}

/** Add a field to a template. */
export async function createTemplateField(
  input: CreateTemplateFieldInput
): Promise<TemplateField> {
  const { data, error } = await supabase
    .from('template_fields')
    .insert({
      template_id: input.templateId,
      field_key: input.fieldKey,
      display_label_override: input.displayLabelOverride ?? null,
      group_name: input.groupName ?? null,
      sort_order: input.sortOrder ?? 0,
      visibility: input.visibility ?? 'show',
      formatting_hint: input.formattingHint ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create template field: ${error.message}`);
  return mapTemplateFieldRow(data);
}

/** Delete a template field. */
export async function deleteTemplateField(id: string): Promise<void> {
  const { error } = await supabase.from('template_fields').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete template field: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Row Mappers  (snake_case DB rows  →  camelCase TypeScript types)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTemplateRow(row: any): Template {
  return {
    id: row.id,
    name: row.name,
    audience: row.audience as TemplateAudience,
    description: row.description ?? '',
    matchingRulesJson: row.matching_rules_json,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTemplateFieldRow(row: any): TemplateField {
  return {
    id: row.id,
    templateId: row.template_id,
    fieldKey: row.field_key,
    displayLabelOverride: row.display_label_override,
    groupName: row.group_name,
    sortOrder: row.sort_order,
    visibility: row.visibility as FieldVisibility,
    formattingHint: row.formatting_hint,
    createdAt: row.created_at,
  };
}
