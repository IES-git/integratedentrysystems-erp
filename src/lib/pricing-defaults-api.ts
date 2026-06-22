import { supabase } from '@/lib/supabase';
import type {
  HardwareSellRule,
  SellCostBasis,
  ServiceScope,
  ServiceScopeBasis,
  ServiceScopeType,
} from '@/types';

function num(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v);
}

function mapSellRule(row: Record<string, unknown>): HardwareSellRule {
  return {
    id: row.id as string,
    name: row.name as string,
    costBasis: row.cost_basis as SellCostBasis,
    markupMultiplier: num(row.markup_multiplier),
    gmTargetPct: num(row.gm_target_pct),
    rounding: (row.rounding as string | null) ?? null,
    customerClass: (row.customer_class as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    priority: (row.priority as number) ?? 100,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapServiceScope(row: Record<string, unknown>): ServiceScope {
  return {
    id: row.id as string,
    scopeType: row.scope_type as ServiceScopeType,
    name: row.name as string,
    basis: row.basis as ServiceScopeBasis,
    rate: num(row.rate),
    percent: num(row.percent),
    referenceBasis: (row.reference_basis as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface PricingDefaults {
  sellRules: HardwareSellRule[];
  serviceScopes: ServiceScope[];
}

export type HardwareSellRuleInput = {
  name?: string;
  costBasis?: SellCostBasis;
  markupMultiplier?: number | null;
  gmTargetPct?: number | null;
  rounding?: string | null;
  customerClass?: string | null;
  companyId?: string | null;
  category?: string | null;
  priority?: number;
};

export type ServiceScopeInput = {
  scopeType?: ServiceScopeType;
  name?: string;
  basis?: ServiceScopeBasis;
  rate?: number | null;
  percent?: number | null;
  referenceBasis?: string | null;
  notes?: string | null;
};

function sellRuleRow(input: HardwareSellRuleInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('name' in input) row.name = input.name;
  if ('costBasis' in input) row.cost_basis = input.costBasis;
  if ('markupMultiplier' in input) row.markup_multiplier = input.markupMultiplier;
  if ('gmTargetPct' in input) row.gm_target_pct = input.gmTargetPct;
  if ('rounding' in input) row.rounding = input.rounding;
  if ('customerClass' in input) row.customer_class = input.customerClass;
  if ('companyId' in input) row.company_id = input.companyId;
  if ('category' in input) row.category = input.category;
  if ('priority' in input) row.priority = input.priority;
  return row;
}

function serviceScopeRow(input: ServiceScopeInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('scopeType' in input) row.scope_type = input.scopeType;
  if ('name' in input) row.name = input.name;
  if ('basis' in input) row.basis = input.basis;
  if ('rate' in input) row.rate = input.rate;
  if ('percent' in input) row.percent = input.percent;
  if ('referenceBasis' in input) row.reference_basis = input.referenceBasis;
  if ('notes' in input) row.notes = input.notes;
  return row;
}

export async function loadPricingDefaults(): Promise<PricingDefaults> {
  const [sell, services] = await Promise.all([
    supabase.from('hardware_sell_rule').select('*').order('priority', { ascending: true }),
    supabase.from('service_scope').select('*').order('scope_type', { ascending: true }),
  ]);

  if (sell.error) throw new Error(`Failed to load markup rules: ${sell.error.message}`);
  if (services.error) throw new Error(`Failed to load service defaults: ${services.error.message}`);

  return {
    sellRules: (sell.data ?? []).map((row) => mapSellRule(row as Record<string, unknown>)),
    serviceScopes: (services.data ?? []).map((row) => mapServiceScope(row as Record<string, unknown>)),
  };
}

export async function createHardwareSellRule(input: Required<Pick<HardwareSellRuleInput, 'name' | 'costBasis' | 'priority'>> & HardwareSellRuleInput): Promise<HardwareSellRule> {
  const { data, error } = await supabase
    .from('hardware_sell_rule')
    .insert(sellRuleRow(input))
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create markup rule: ${error.message}`);
  return mapSellRule(data as Record<string, unknown>);
}

export async function updateHardwareSellRule(id: string, input: HardwareSellRuleInput): Promise<HardwareSellRule> {
  const { data, error } = await supabase
    .from('hardware_sell_rule')
    .update(sellRuleRow(input))
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update markup rule: ${error.message}`);
  return mapSellRule(data as Record<string, unknown>);
}

export async function createServiceScope(input: Required<Pick<ServiceScopeInput, 'scopeType' | 'name' | 'basis'>> & ServiceScopeInput): Promise<ServiceScope> {
  const { data, error } = await supabase
    .from('service_scope')
    .insert(serviceScopeRow(input))
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create service default: ${error.message}`);
  return mapServiceScope(data as Record<string, unknown>);
}

export async function updateServiceScope(id: string, input: ServiceScopeInput): Promise<ServiceScope> {
  const { data, error } = await supabase
    .from('service_scope')
    .update(serviceScopeRow(input))
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update service default: ${error.message}`);
  return mapServiceScope(data as Record<string, unknown>);
}
