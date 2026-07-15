/**
 * Supabase-backed CRUD operations for Companies and Contacts.
 */

import { supabase } from './supabase';
import type { Company, CompanySettings, CompanyType, Contact } from '@/types';

// ---------------------------------------------------------------------------
// Company — List & Read
// ---------------------------------------------------------------------------

export interface CompanyWithContactCount extends Company {
  contactCount: number;
}

/**
 * List companies with an optional type filter, active first then by name.
 * Pass `companyType` to restrict to a specific type (e.g. 'customer' or 'manufacturer').
 * Companies with type 'both' are included whenever either matching type is requested.
 */
export async function listCompanies(
  companyType?: CompanyType
): Promise<CompanyWithContactCount[]> {
  let query = supabase
    .from('companies')
    .select('*, contacts(count)')
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (companyType === 'customer') {
    query = query.in('company_type', ['customer', 'both']);
  } else if (companyType === 'manufacturer') {
    query = query.in('company_type', ['manufacturer', 'both']);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to list companies: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => ({
    ...mapCompanyRow(row),
    contactCount: row.contacts?.[0]?.count ?? 0,
  }));
}

/** Convenience wrapper — returns only manufacturer companies (type = 'manufacturer' or 'both'). */
export async function listManufacturers(): Promise<CompanyWithContactCount[]> {
  return listCompanies('manufacturer');
}

/** Fetch a single company by ID. Returns null if not found. */
export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch company: ${error.message}`);
  }

  return mapCompanyRow(data);
}

/** Fetch a company together with all its contacts. */
export async function getCompanyWithContacts(
  id: string
): Promise<{ company: Company; contacts: Contact[] } | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('*, contacts(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch company: ${error.message}`);
  }

  const company = mapCompanyRow(data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts = (data.contacts || []).map((row: any) => mapContactRow(row));

  return { company, contacts };
}

// ---------------------------------------------------------------------------
// Company — Create / Update / Delete
// ---------------------------------------------------------------------------

export type CreateCompanyInput = Pick<Company, 'name'> &
  Partial<
    Pick<
      Company,
      | 'companyType'
      | 'billingAddress'
      | 'billingCity'
      | 'billingState'
      | 'billingZip'
      | 'shippingAddress'
      | 'shippingCity'
      | 'shippingState'
      | 'shippingZip'
      | 'notes'
      | 'active'
      | 'settings'
    >
  >;

/** Create a new company. */
export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const { data, error } = await supabase
    .from('companies')
    .insert(companyInputToRow(input))
    .select()
    .single();

  if (error) throw new Error(`Failed to create company: ${error.message}`);
  return mapCompanyRow(data);
}

/** Update an existing company. */
export async function updateCompany(
  id: string,
  updates: Partial<CreateCompanyInput>
): Promise<Company> {
  const { data, error } = await supabase
    .from('companies')
    .update(companyInputToRow(updates))
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update company: ${error.message}`);
  return mapCompanyRow(data);
}

/** Delete a company (cascades to contacts; estimates.company_id is set to NULL). */
export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete company: ${error.message}`);
}

/** Patch the settings JSONB column for a company. Merges with existing settings. */
export async function updateCompanySettings(
  id: string,
  settings: Partial<CompanySettings>
): Promise<Company> {
  // Read current settings first so we can merge
  const company = await getCompany(id);
  if (!company) throw new Error('Company not found');

  const merged: CompanySettings = { ...company.settings, ...settings };

  const { data, error } = await supabase
    .from('companies')
    .update({ settings: merged })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update company settings: ${error.message}`);
  return mapCompanyRow(data);
}

// ---------------------------------------------------------------------------
// Contacts — List & Read
// ---------------------------------------------------------------------------

/** List all contacts for a given company (primary first, then by last name). */
export async function listContacts(companyId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false })
    .order('last_name', { ascending: true });

  if (error) throw new Error(`Failed to list contacts: ${error.message}`);
  return (data || []).map(mapContactRow);
}

// ---------------------------------------------------------------------------
// Contacts — Create / Update / Delete
// ---------------------------------------------------------------------------

export type CreateContactInput = Pick<Contact, 'companyId' | 'firstName' | 'lastName'> &
  Partial<Pick<Contact, 'email' | 'phone' | 'title' | 'isPrimary' | 'notes'>>;

/** Create a new contact. If `isPrimary` is true, clears the primary flag on all other contacts for the same company first. */
export async function createContact(input: CreateContactInput): Promise<Contact> {
  if (input.isPrimary) {
    await clearPrimaryContact(input.companyId);
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      company_id: input.companyId,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      is_primary: input.isPrimary ?? false,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create contact: ${error.message}`);
  return mapContactRow(data);
}

/** Update an existing contact. If `isPrimary` is being set to true, clears existing primary first. */
export async function updateContact(
  id: string,
  updates: Partial<Omit<CreateContactInput, 'companyId'>> & { companyId?: string }
): Promise<Contact> {
  if (updates.isPrimary && updates.companyId) {
    await clearPrimaryContact(updates.companyId, id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (updates.firstName !== undefined) row.first_name = updates.firstName;
  if (updates.lastName !== undefined) row.last_name = updates.lastName;
  if (updates.email !== undefined) row.email = updates.email;
  if (updates.phone !== undefined) row.phone = updates.phone;
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.isPrimary !== undefined) row.is_primary = updates.isPrimary;
  if (updates.notes !== undefined) row.notes = updates.notes;

  const { data, error } = await supabase
    .from('contacts')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update contact: ${error.message}`);
  return mapContactRow(data);
}

/** Delete a contact. */
export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete contact: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Remove the primary flag from all contacts of a company (optionally excluding one contact). */
async function clearPrimaryContact(companyId: string, excludeId?: string): Promise<void> {
  let query = supabase
    .from('contacts')
    .update({ is_primary: false })
    .eq('company_id', companyId)
    .eq('is_primary', true);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { error } = await query;
  if (error) throw new Error(`Failed to clear primary contact: ${error.message}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function companyInputToRow(input: Partial<CreateCompanyInput>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.companyType !== undefined) row.company_type = input.companyType;
  if (input.billingAddress !== undefined) row.billing_address = input.billingAddress;
  if (input.billingCity !== undefined) row.billing_city = input.billingCity;
  if (input.billingState !== undefined) row.billing_state = input.billingState;
  if (input.billingZip !== undefined) row.billing_zip = input.billingZip;
  if (input.shippingAddress !== undefined) row.shipping_address = input.shippingAddress;
  if (input.shippingCity !== undefined) row.shipping_city = input.shippingCity;
  if (input.shippingState !== undefined) row.shipping_state = input.shippingState;
  if (input.shippingZip !== undefined) row.shipping_zip = input.shippingZip;
  if (input.notes !== undefined) row.notes = input.notes;
  if (input.active !== undefined) row.active = input.active;
  if (input.settings !== undefined) row.settings = input.settings;
  return row;
}

// ---------------------------------------------------------------------------
// Row Mappers  (snake_case DB rows  ->  camelCase TypeScript types)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCompanyRow(row: any): Company {
  return {
    id: row.id,
    name: row.name,
    companyType: (row.company_type ?? 'customer') as CompanyType,
    billingAddress: row.billing_address,
    billingCity: row.billing_city,
    billingState: row.billing_state,
    billingZip: row.billing_zip,
    shippingAddress: row.shipping_address,
    shippingCity: row.shipping_city,
    shippingState: row.shipping_state,
    shippingZip: row.shipping_zip,
    notes: row.notes,
    active: row.active,
    settings: mapCompanySettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCompanySettings(raw: any): CompanySettings {
  return {
    costMultiplier: Number(raw?.costMultiplier ?? raw?.cost_multiplier ?? 1.0),
    paymentTerms: raw?.paymentTerms ?? raw?.payment_terms ?? null,
    defaultTemplateId: raw?.defaultTemplateId ?? raw?.default_template_id ?? null,
    markupOverrides: raw?.markupOverrides ?? raw?.markup_overrides ?? undefined,
    defaultQuoteTemplateKey: raw?.defaultQuoteTemplateKey ?? raw?.default_quote_template_key ?? null,
    defaultQuoteDetailLevel: raw?.defaultQuoteDetailLevel ?? raw?.default_quote_detail_level ?? 'rolled_up',
    defaultQuoteOrganizationMode:
      raw?.defaultQuoteOrganizationMode ?? raw?.default_quote_organization_mode ?? 'by_product_group',
    quoteValidityDays:
      raw?.quoteValidityDays ?? raw?.quote_validity_days ?? null,
    quoteHeaderText: raw?.quoteHeaderText ?? raw?.quote_header_text ?? null,
    quoteFooterText: raw?.quoteFooterText ?? raw?.quote_footer_text ?? null,
    quoteDisclaimerText: raw?.quoteDisclaimerText ?? raw?.quote_disclaimer_text ?? null,
    showCustomerPartNumbers:
      raw?.showCustomerPartNumbers ?? raw?.show_customer_part_numbers ?? false,
    customerPartNumberMap:
      raw?.customerPartNumberMap ?? raw?.customer_part_number_map ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContactRow(row: any): Contact {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    title: row.title,
    isPrimary: row.is_primary,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
