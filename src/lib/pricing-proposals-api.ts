/**
 * Propose-only approval queue for canonical pricing/spec changes.
 *
 * The extraction/exception agent and price-book ingestion never write to
 * pricing_tables/pricing_cells directly — every proposed change is inserted
 * here with status='pending' and applied only after a human approves it.
 *
 * Backed by the `pricing_change_proposals` table (Phase 0).
 */

import { supabase } from './supabase';
import { upsertPricingCell, upsertAdderCell } from './pricing-api';
import type {
  PricingChangeProposal,
  PricingChangeSource,
  PricingProposalStatus,
  PricingProposalType,
} from '@/types';

function mapProposal(row: Record<string, unknown>): PricingChangeProposal {
  return {
    id: row.id as string,
    proposalType: row.proposal_type as PricingProposalType,
    targetTableId: (row.target_table_id as string | null) ?? null,
    targetIds: (row.target_ids ?? {}) as Record<string, unknown>,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    source: row.source as PricingChangeSource,
    confidence: (row.confidence as number | null) ?? null,
    explanation: (row.explanation as string | null) ?? null,
    status: row.status as PricingProposalStatus,
    createdBy: (row.created_by as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface ProposalFilter {
  status?: PricingProposalStatus;
  source?: PricingChangeSource;
  targetTableId?: string;
}

/** Lists proposals, most recent first, optionally filtered by status/source/table. */
export async function listProposals(filter?: ProposalFilter): Promise<PricingChangeProposal[]> {
  let query = supabase
    .from('pricing_change_proposals')
    .select('*')
    .order('created_at', { ascending: false });

  if (filter?.status) query = query.eq('status', filter.status);
  if (filter?.source) query = query.eq('source', filter.source);
  if (filter?.targetTableId) query = query.eq('target_table_id', filter.targetTableId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapProposal(r as Record<string, unknown>));
}

/** Finds the proposal that an ingestion extraction produced (target_ids.extractionId). */
export async function getProposalForExtraction(extractionId: string): Promise<PricingChangeProposal | null> {
  const { data, error } = await supabase
    .from('pricing_change_proposals')
    .select('*')
    .eq('source', 'ingestion')
    .contains('target_ids', { extractionId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapProposal(data as Record<string, unknown>) : null;
}

/** Count of pending proposals — used for the review-queue badge. */
export async function countPendingProposals(): Promise<number> {
  const { count, error } = await supabase
    .from('pricing_change_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface CreateProposalInput {
  proposalType: PricingProposalType;
  targetTableId?: string | null;
  targetIds?: Record<string, unknown>;
  payload: Record<string, unknown>;
  source: PricingChangeSource;
  confidence?: number | null;
  explanation?: string | null;
}

/** Inserts a single pending proposal. */
export async function createProposal(input: CreateProposalInput): Promise<PricingChangeProposal> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pricing_change_proposals')
    .insert({
      proposal_type: input.proposalType,
      target_table_id: input.targetTableId ?? null,
      target_ids: input.targetIds ?? {},
      payload: input.payload,
      source: input.source,
      confidence: input.confidence ?? null,
      explanation: input.explanation ?? null,
      created_by: userData?.user?.id ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return mapProposal(data as Record<string, unknown>);
}

/** Inserts many pending proposals in one call (used by ingestion). */
export async function createProposals(inputs: CreateProposalInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData?.user?.id ?? null;
  const rows = inputs.map((i) => ({
    proposal_type: i.proposalType,
    target_table_id: i.targetTableId ?? null,
    target_ids: i.targetIds ?? {},
    payload: i.payload,
    source: i.source,
    confidence: i.confidence ?? null,
    explanation: i.explanation ?? null,
    created_by: createdBy,
  }));
  const { error, count } = await supabase
    .from('pricing_change_proposals')
    .insert(rows, { count: 'exact' });
  if (error) throw new Error(error.message);
  return count ?? rows.length;
}

/** Updates a proposal's status and stamps the reviewer. */
export async function updateProposalStatus(
  id: string,
  status: PricingProposalStatus,
): Promise<PricingChangeProposal> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pricing_change_proposals')
    .update({
      status,
      reviewed_by: userData?.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return mapProposal(data as Record<string, unknown>);
}

/** Marks every pending ingestion proposal for one staging book as applied. */
export async function applyPendingIngestionProposalsForBook(priceBookId: string): Promise<number> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('pricing_change_proposals')
    .update({
      status: 'applied',
      reviewed_by: userData?.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('price_book_id', priceBookId)
    .eq('source', 'ingestion')
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Rejects a pending proposal. */
export async function rejectProposal(id: string): Promise<PricingChangeProposal> {
  return updateProposalStatus(id, 'rejected');
}

/**
 * Applies a 'cell' or 'adder' proposal to the canonical pricing tables through
 * the versioned writer (so the change is audited + attributed to the proposal),
 * then marks the proposal 'applied'. Cell payload: { rowId, columnId, price }.
 * Adder payload: { canonicalCode, fieldDefinitionId, optionValue, companyId, price }.
 *
 * Column/row/table/spec proposals are applied by their feature-specific review
 * UIs (e.g. the price-book mapping screen builds the grid directly).
 */
export async function applyProposal(proposal: PricingChangeProposal): Promise<void> {
  const p = proposal.payload as Record<string, unknown>;

  if (proposal.proposalType === 'cell') {
    const rowId = (proposal.targetIds.rowId ?? p.rowId) as string;
    const columnId = (proposal.targetIds.columnId ?? p.columnId) as string;
    const price = (p.price as number | null) ?? null;
    if (!rowId || !columnId) throw new Error('Cell proposal missing rowId/columnId');
    await upsertPricingCell(rowId, columnId, price, {
      source: proposal.source,
      proposalId: proposal.id,
    });
  } else if (proposal.proposalType === 'adder') {
    if (!proposal.targetTableId) throw new Error('Adder proposal missing targetTableId');
    await upsertAdderCell({
      tableId: proposal.targetTableId,
      canonicalCode: p.canonicalCode as string,
      fieldDefinitionId: p.fieldDefinitionId as string,
      optionValue: p.optionValue as string,
      companyId: p.companyId as string,
      price: (p.price as number | null) ?? null,
    });
  } else {
    throw new Error(`applyProposal does not handle proposalType '${proposal.proposalType}'`);
  }

  await updateProposalStatus(proposal.id, 'applied');
}
