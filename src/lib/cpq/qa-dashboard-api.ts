/**
 * QA dashboard data access (Phase 4).
 *
 * Reads the `qa_issue_summary` view (counts per book/check/severity/status) and
 * the underlying `qa_issue` rows so the dashboard can surface ingestion and
 * data-quality problems before a price book is published. Re-running the gate
 * is delegated to `runAndPersistQaChecks` so the dashboard always reflects the
 * same checks the publish gate enforces.
 */

import { supabase } from '@/lib/supabase';
import type { QaIssue, QaIssueSeverity, QaIssueStatus } from '@/types';
import { runAndPersistQaChecks, type QaResult } from './qa-checks';

export interface QaSummaryRow {
  priceBookTitle: string;
  priceBookId: string | null;
  checkName: string;
  severity: QaIssueSeverity;
  status: QaIssueStatus;
  issueCount: number;
  lastSeen: string | null;
}

function mapIssue(row: Record<string, unknown>): QaIssue {
  return {
    id: row.id as string,
    priceBookId: (row.price_book_id as string | null) ?? null,
    priceRuleId: (row.price_rule_id as string | null) ?? null,
    sourceRegionId: (row.source_region_id as string | null) ?? null,
    checkName: row.check_name as string,
    severity: row.severity as QaIssueSeverity,
    detail: (row.detail as string | null) ?? null,
    status: row.status as QaIssueStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Loads the grouped QA summary (counts per book / check / severity / status). */
export async function loadQaSummary(): Promise<QaSummaryRow[]> {
  const { data, error } = await supabase
    .from('qa_issue_summary')
    .select('*')
    .order('issue_count', { ascending: false });
  if (error) throw new Error(`Failed to load QA summary: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      priceBookTitle: (row.price_book_title as string) ?? 'unassigned',
      priceBookId: (row.price_book_id as string | null) ?? null,
      checkName: row.check_name as string,
      severity: row.severity as QaIssueSeverity,
      status: row.status as QaIssueStatus,
      issueCount: Number(row.issue_count ?? 0),
      lastSeen: (row.last_seen as string | null) ?? null,
    };
  });
}

/** Loads individual QA issues, optionally filtered by status and/or book. */
export async function loadQaIssues(opts: { status?: QaIssueStatus; priceBookId?: string | null; limit?: number } = {}): Promise<QaIssue[]> {
  let query = supabase.from('qa_issue').select('*').order('updated_at', { ascending: false });
  if (opts.status) query = query.eq('status', opts.status);
  if (opts.priceBookId) query = query.eq('price_book_id', opts.priceBookId);
  query = query.limit(opts.limit ?? 200);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load QA issues: ${error.message}`);
  return (data ?? []).map((r) => mapIssue(r as Record<string, unknown>));
}

/** Re-runs the QA gate for a document, refreshing its open qa_issue rows. */
export async function rerunQaChecks(documentId: string): Promise<QaResult> {
  return runAndPersistQaChecks(documentId);
}
