import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, Loader2, AlertCircle, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getProposalForExtraction } from '@/lib/pricing-proposals-api';
import {
  getCompiledReview,
  approveCompiledExtraction,
  rejectCompiledExtraction,
  getDocumentCompileSummary,
  type CompiledPriceRule,
  type CompiledRuleReview,
  type DocumentCompileSummary,
} from '@/lib/price-rules-api';
import { publishPriceBookDocumentWithQa, qaAllowsOverride, QaGateError, type QaResult } from '@/lib/cpq/qa-checks';
import type { PriceBook, PriceBookExtraction, RuleCondition } from '@/types';

interface RuleReviewPanelProps {
  book: PriceBook;
  extraction: PriceBookExtraction;
  onClose: () => void;
  /** Called after approve/reject/publish so the parent can reload extractions. */
  onChanged: () => void;
}

const OPERATOR_SYMBOL: Record<string, string> = {
  EQ: '=', NE: '≠', IN: 'in', NOT_IN: 'not in', GT: '>', GTE: '≥', LT: '<', LTE: '≤', BETWEEN: 'between', EXISTS: 'exists', MISSING: 'missing',
};

/** Renders one rule's conditions as compact, human-readable predicates. */
function ConditionList({ conditions }: { conditions: RuleCondition[] }) {
  if (conditions.length === 0) return <span className="text-muted-foreground">— (always)</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {conditions.map((c) => (
        <span key={c.id} className="text-[11px] font-mono">
          <span className="text-muted-foreground">{c.fieldPath ?? c.fieldId ?? '?'}</span>{' '}
          {OPERATOR_SYMBOL[c.operator] ?? c.operator}{' '}
          <span className="font-medium">{c.value1 ?? ''}{c.value2 != null ? `..${c.value2}` : ''}{c.unit ? ` ${c.unit}` : ''}</span>
        </span>
      ))}
    </div>
  );
}

function ruleValue(r: CompiledPriceRule): string {
  if (r.priceStatus !== 'PRICED') return r.priceStatus.replace(/_/g, ' ');
  if (r.actionType === 'PERCENT_OF' && r.percentage != null) return `${r.percentage}%`;
  if (r.amount != null) {
    const unit = r.unitOfMeasure ? ` / ${r.unitOfMeasure}` : '';
    return `$${Number(r.amount).toFixed(2)}${unit}`;
  }
  return '—';
}

/**
 * Rule review/approval UI (Phase 2.1) — replaces the legacy grid-mapping screen.
 * Shows the compiled price_rule + dependency_rule rows for one table (archetype,
 * conditions, action, status, source citation) and gates them behind the
 * existing pricing_change_proposals approval boundary. Approving flips the rules
 * APPROVED; publishing the document version makes them the active priced version.
 */
export default function RuleReviewPanel({ book, extraction, onClose, onChanged }: RuleReviewPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<CompiledRuleReview | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DocumentCompileSummary | null>(null);
  const [working, setWorking] = useState(false);
  const [qaResult, setQaResult] = useState<QaResult | null>(null);

  const sourceRegionId = extraction.sourceRegionId;
  const documentId = extraction.priceBookDocumentId;
  const approved = extraction.status === 'approved';

  const load = useCallback(async () => {
    if (!sourceRegionId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rev, proposal, sum] = await Promise.all([
        getCompiledReview(sourceRegionId),
        getProposalForExtraction(extraction.id),
        documentId ? getDocumentCompileSummary(documentId) : Promise.resolve(null),
      ]);
      setReview(rev);
      setProposalId(proposal?.id ?? null);
      setSummary(sum);
    } catch (err) {
      toast({ title: 'Failed to load rules', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [sourceRegionId, documentId, extraction.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async () => {
    if (!sourceRegionId) return;
    setWorking(true);
    try {
      const r = await approveCompiledExtraction({ extractionId: extraction.id, sourceRegionId, proposalId });
      toast({ title: 'Rules approved', description: `${r.approvedRules} price rule(s), ${r.approvedDependencies} dependency rule(s) approved.` });
      onChanged();
      await load();
    } catch (err) {
      toast({ title: 'Approve failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handleReject = async () => {
    if (!sourceRegionId) return;
    if (!confirm('Reject these compiled rules? They are kept for audit but not published.')) return;
    setWorking(true);
    try {
      await rejectCompiledExtraction({ extractionId: extraction.id, sourceRegionId, proposalId });
      toast({ title: 'Rules rejected', description: 'No prices were published.' });
      onChanged();
      onClose();
    } catch (err) {
      toast({ title: 'Reject failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handlePublish = async (override = false) => {
    if (!documentId) return;
    if (!override && !confirm('Publish this price-book version? Its approved rules become the active priced version.')) return;
    setWorking(true);
    try {
      const result = await publishPriceBookDocumentWithQa(documentId, { override });
      setQaResult(result);
      toast({
        title: 'Version published',
        description: `Approved rules are now the active priced version.${result.warningCount > 0 ? ` (${result.warningCount} QA warning(s))` : ''}`,
      });
      onChanged();
      await load();
    } catch (err) {
      if (err instanceof QaGateError) {
        setQaResult(err.result);
        toast({
          title: 'Blocked by QA gate',
          description: qaAllowsOverride(err.result)
            ? `${err.result.blockingCount} error(s) must be resolved or explicitly overridden before publishing.`
            : `${err.result.blockingCount} blocking source-integrity issue(s) must be resolved before publishing.`,
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Publish failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      }
    } finally {
      setWorking(false);
    }
  };

  const rules = review?.rules ?? [];
  const deps = review?.dependencyRules ?? [];

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">Review rules: {extraction.title ?? 'Untitled table'}</h1>
            {extraction.archetype && <Badge variant="outline" className="capitalize">{extraction.archetype.replace(/_/g, ' ')}</Badge>}
            {approved && <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{book.name} · {book.originalFileName} · compiled rules awaiting review</p>
        </div>
      </div>

      {!sourceRegionId ? (
        <Card className="border-amber-500/50">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" /> This table has not been compiled into rules yet. Run “Compile to rules” first.
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading compiled rules…</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{rules.length} price rule(s)</Badge>
            <Badge variant="outline">{deps.length} dependency rule(s)</Badge>
            {summary && <Badge variant="outline">Version: {summary.approvedRuleCount}/{summary.priceRuleCount} rules approved · {summary.status}</Badge>}
          </div>

          {rules.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Price rules</CardTitle>
                <CardDescription>Each priced cell/sentence became one rule. Conditions are matched by the pricing engine; source text is preserved for audit.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Action</TableHead>
                      <TableHead className="text-xs">Value / Status</TableHead>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs">Conditions</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">{r.actionType.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs tabular-nums whitespace-nowrap font-medium">{ruleValue(r)}</TableCell>
                        <TableCell className="text-xs">{r.itemOrOptionCode ?? '—'}</TableCell>
                        <TableCell><ConditionList conditions={r.conditions} /></TableCell>
                        <TableCell className="text-[11px] text-muted-foreground max-w-[220px] truncate" title={r.rawValueText ?? ''}>{r.rawValueText ?? '—'}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant={r.reviewStatus === 'APPROVED' ? 'default' : r.reviewStatus === 'REJECTED' ? 'destructive' : 'outline'} className="text-[10px]">
                            {r.reviewStatus}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {deps.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Dependency rules</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {deps.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">{d.relationshipType}</Badge>
                    <span className="text-muted-foreground">{d.messageTemplate ?? JSON.stringify(d.triggerConditions)}</span>
                    <Badge variant={d.severity === 'BLOCK_PRICING' || d.severity === 'BLOCK_ORDER' ? 'destructive' : 'outline'} className="text-[10px] ml-auto">{d.severity}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {rules.length === 0 && deps.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">No rules were compiled from this table. Re-extract the grid or re-compile, or discard it.</CardContent></Card>
          )}

          <div className="flex items-center gap-2">
            {!approved && (
              <>
                <Button onClick={handleApprove} disabled={working || (rules.length === 0 && deps.length === 0)}>
                  {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  Approve rules
                </Button>
                <Button variant="outline" onClick={handleReject} disabled={working}>
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
            {approved && documentId && summary?.status !== 'published' && (
              <Button onClick={() => handlePublish(false)} disabled={working}>
                {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
                Publish version
              </Button>
            )}
          </div>

          {/* QA publication gate results */}
          {qaResult && qaResult.findings.length > 0 && (
            <Card className={qaResult.passed ? 'border-amber-500/40' : 'border-destructive/50'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  QA checks — {qaResult.blockingCount} blocking, {qaResult.warningCount} warning(s)
                </CardTitle>
                <CardDescription>
                  Source completeness, value semantics, unit basis, rule overlap, net reconciliation, dependency coverage.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {qaResult.findings.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant={f.severity === 'ERROR' || f.severity === 'BLOCK' ? 'destructive' : 'outline'}
                      className="text-[10px] shrink-0"
                    >
                      {f.severity}
                    </Badge>
                    <span className="font-mono text-muted-foreground shrink-0">{f.checkName}</span>
                    <span>{f.detail}</span>
                  </div>
                ))}
                {!qaResult.passed && qaAllowsOverride(qaResult) && documentId && summary?.status !== 'published' && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => handlePublish(true)} disabled={working}>
                    <Rocket className="mr-1.5 h-3.5 w-3.5" /> Publish anyway (override QA gate)
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
