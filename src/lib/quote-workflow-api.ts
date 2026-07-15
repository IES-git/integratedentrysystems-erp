import { supabase } from '@/lib/supabase';

export type CustomerApprovalDecision = 'approved' | 'rejected';
export type OperationStageStatus = 'not_started' | 'in_progress' | 'blocked' | 'complete';
export type OperationStage = 'procurement' | 'receiving' | 'staging' | 'fulfillment';

export interface PublicQuoteApproval {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked';
  expiresAt: string;
  quoteId: string;
  quoteNumber: string;
  currency: string;
  total: number;
  notes: string | null;
  context: Record<string, unknown> | null;
  items: Array<{ label: string; code: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
}

export interface QuoteOperations {
  id: string;
  quoteId: string;
  procurementStatus: OperationStageStatus;
  receivingStatus: OperationStageStatus;
  stagingStatus: OperationStageStatus;
  fulfillmentStatus: OperationStageStatus;
  notes: string | null;
  updatedAt: string;
}

export interface OperationsDashboardRow extends QuoteOperations {
  quoteNumber: string;
  quoteStatus: string;
  customerName: string;
  jobName: string;
  total: number;
  currency: string;
}

export async function createQuoteApprovalLink(quoteId: string, recipientEmail?: string | null, expiresDays = 14): Promise<string> {
  const { data, error } = await supabase.rpc('create_quote_approval_request', {
    p_quote_id: quoteId,
    p_recipient_email: recipientEmail?.trim() || null,
    p_expires_days: expiresDays,
  });
  if (error) throw new Error(`Failed to create approval link: ${error.message}`);
  return `${window.location.origin}/quote-approval/${String(data)}`;
}

export async function getPublicQuoteApproval(token: string): Promise<PublicQuoteApproval | null> {
  const { data, error } = await supabase.rpc('get_quote_approval', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    requestId: String(row.request_id),
    status: row.status as PublicQuoteApproval['status'],
    expiresAt: String(row.expires_at),
    quoteId: String(row.quote_id),
    quoteNumber: String(row.quote_number),
    currency: String(row.currency ?? 'USD'),
    total: Number(row.total ?? 0),
    notes: (row.notes as string | null) ?? null,
    context: (row.context as Record<string, unknown> | null) ?? null,
    items: ((row.items as Record<string, unknown>[] | null) ?? []).map((item) => ({
      label: String(item.label ?? ''),
      code: item.code ? String(item.code) : null,
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      lineTotal: Number(item.line_total ?? 0),
    })),
  };
}

export async function respondToQuoteApproval(
  token: string,
  decision: CustomerApprovalDecision,
  customerName: string,
  comment?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('respond_quote_approval', {
    p_token: token,
    p_decision: decision,
    p_customer_name: customerName,
    p_comment: comment?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

function mapOperations(row: Record<string, unknown>): QuoteOperations {
  return {
    id: String(row.id),
    quoteId: String(row.quote_id),
    procurementStatus: row.procurement_status as OperationStageStatus,
    receivingStatus: row.receiving_status as OperationStageStatus,
    stagingStatus: row.staging_status as OperationStageStatus,
    fulfillmentStatus: row.fulfillment_status as OperationStageStatus,
    notes: (row.notes as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

export async function getQuoteOperations(quoteId: string): Promise<QuoteOperations | null> {
  const { data, error } = await supabase.from('quote_operations').select('*').eq('quote_id', quoteId).maybeSingle();
  if (error) throw new Error(`Failed to load operations tracking: ${error.message}`);
  return data ? mapOperations(data as Record<string, unknown>) : null;
}

export async function updateQuoteOperations(
  quoteId: string,
  stage: OperationStage,
  status: OperationStageStatus,
  notes?: string | null,
): Promise<QuoteOperations> {
  const { data: auth } = await supabase.auth.getUser();
  const statusColumn = `${stage}_status`;
  const completedColumn = `${stage}_completed_at`;
  const row: Record<string, unknown> = {
    quote_id: quoteId,
    [statusColumn]: status,
    [completedColumn]: status === 'complete' ? new Date().toISOString() : null,
    updated_by: auth.user?.id ?? null,
  };
  if (notes !== undefined) row.notes = notes?.trim() || null;
  const { data, error } = await supabase.from('quote_operations').upsert(row, { onConflict: 'quote_id' }).select().single();
  if (error) throw new Error(`Failed to update operations tracking: ${error.message}`);
  return mapOperations(data as Record<string, unknown>);
}

export async function listQuoteOperations(): Promise<OperationsDashboardRow[]> {
  const { data: operationRows, error } = await supabase
    .from('quote_operations')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to load operations dashboard: ${error.message}`);
  const quoteIds = (operationRows ?? []).map((row) => String(row.quote_id));
  if (quoteIds.length === 0) return [];
  const { data: quoteRows, error: quoteError } = await supabase
    .from('quotes')
    .select('id, company_id, status, total, currency, context_snapshot')
    .in('id', quoteIds);
  if (quoteError) throw new Error(`Failed to load operations quotes: ${quoteError.message}`);
  const companyIds = [...new Set((quoteRows ?? []).map((row) => row.company_id as string | null).filter(Boolean) as string[])];
  const companyNames = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await supabase.from('companies').select('id, name').in('id', companyIds);
    for (const company of companies ?? []) companyNames.set(String(company.id), String(company.name));
  }
  const quotes = new Map((quoteRows ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
  return (operationRows ?? []).map((raw) => {
    const base = mapOperations(raw as Record<string, unknown>);
    const quote = quotes.get(base.quoteId) ?? {};
    const context = (quote.context_snapshot as Record<string, unknown> | null) ?? {};
    const job = (context.job as Record<string, unknown> | null) ?? {};
    const company = (context.company as Record<string, unknown> | null) ?? {};
    const companyId = quote.company_id ? String(quote.company_id) : '';
    return {
      ...base,
      quoteNumber: `Q-${base.quoteId.slice(-8).toUpperCase()}`,
      quoteStatus: String(quote.status ?? ''),
      customerName: String(company.name ?? companyNames.get(companyId) ?? 'Unassigned'),
      jobName: String(job.jobName ?? job.jobNumber ?? 'Unassigned job'),
      total: Number(quote.total ?? 0),
      currency: String(quote.currency ?? 'USD'),
    };
  });
}
