import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  bulkReviewHardwarePrices,
  finalizeHardwarePriceBook,
  getHardwareIngestSummary,
  getHardwareReviewContext,
  listHardwarePrices,
  reviewHardwarePrice,
  type HardwareIngestSummary,
  type HardwarePriceRow,
  type HardwareReviewContext,
} from '@/lib/hardware-ingest-api';
import { publishPriceBookDocumentWithQa, QaGateError } from '@/lib/cpq/qa-checks';
import type { PriceBook } from '@/types';

interface Props {
  book: PriceBook;
  onClose: () => void;
  onChanged: () => void;
}

function statusBadge(status: string) {
  if (status === 'APPROVED') return <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>;
  if (status === 'REJECTED') return <Badge variant="secondary">Rejected</Badge>;
  return <Badge variant="outline" className="border-amber-500/40 text-amber-700">Needs review</Badge>;
}

export default function HardwareCatalogReviewPanel({ book, onClose, onChanged }: Props) {
  const { toast } = useToast();
  const [context, setContext] = useState<HardwareReviewContext | null>(null);
  const [summary, setSummary] = useState<HardwareIngestSummary | null>(null);
  const [rows, setRows] = useState<HardwarePriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('NEEDS_REVIEW');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [netDrafts, setNetDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await getHardwareReviewContext(book.id);
      const [sum, prices] = await Promise.all([
        getHardwareIngestSummary(ctx.hardwarePriceBookId),
        listHardwarePrices(ctx.hardwarePriceBookId, 1000),
      ]);
      setContext(ctx);
      setSummary(sum);
      setRows(prices);
      setNetDrafts(Object.fromEntries(prices.map((row) => [
        row.priceId,
        row.netCost == null ? '' : String(row.netCost),
      ])));
      setSelected(new Set());
    } catch (error) {
      toast({ title: 'Hardware review failed to load', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [book.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    approved: rows.filter((row) => row.reviewStatus === 'APPROVED').length,
    review: rows.filter((row) => !['APPROVED', 'REJECTED'].includes(row.reviewStatus)).length,
    rejected: rows.filter((row) => row.reviewStatus === 'REJECTED').length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const statusMatches = statusFilter === 'ALL'
        ? true
        : statusFilter === 'NEEDS_REVIEW'
          ? !['APPROVED', 'REJECTED'].includes(row.reviewStatus)
          : row.reviewStatus === statusFilter;
      if (!statusMatches) return false;
      if (!needle) return true;
      return [
        row.category, row.manufacturerName, row.description, row.sku,
        row.finish, row.func, row.size, row.sourceRowRef,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle));
    });
  }, [query, rows, statusFilter]);

  const unresolvedVisible = visible.filter((row) => !['APPROVED', 'REJECTED'].includes(row.reviewStatus));
  const allVisibleSelected = unresolvedVisible.length > 0 &&
    unresolvedVisible.every((row) => selected.has(row.priceId));

  const decideOne = async (row: HardwarePriceRow, decision: 'APPROVED' | 'REJECTED') => {
    setWorking(true);
    try {
      await reviewHardwarePrice({
        priceId: row.priceId,
        decision,
        netCost: decision === 'APPROVED' ? Number(netDrafts[row.priceId]) : undefined,
      });
      toast({ title: decision === 'APPROVED' ? 'Price approved' : 'Price rejected' });
      await load();
      onChanged();
    } catch (error) {
      toast({ title: 'Review decision failed', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const decideSelected = async (decision: 'APPROVED' | 'REJECTED') => {
    if (selected.size === 0) return;
    if (!confirm(`${decision === 'APPROVED' ? 'Approve' : 'Reject'} ${selected.size} selected price row(s)?`)) return;
    setWorking(true);
    try {
      const count = await bulkReviewHardwarePrices([...selected], decision);
      toast({ title: `${count} price row(s) ${decision === 'APPROVED' ? 'approved' : 'rejected'}` });
      await load();
      onChanged();
    } catch (error) {
      toast({ title: 'Bulk review failed', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const finalizeAndPublish = async () => {
    if (!context || !book.priceBookDocumentId) return;
    if (!confirm('Finalize this hardware revision and publish its governed source record?')) return;
    setWorking(true);
    try {
      await finalizeHardwarePriceBook(context.hardwarePriceBookId, context.proposalId);
      const result = await publishPriceBookDocumentWithQa(book.priceBookDocumentId);
      toast({
        title: 'Hardware revision published',
        description: `${counts.approved} approved price observation(s) are active.${result.warningCount ? ` ${result.warningCount} QA warning(s).` : ''}`,
      });
      await load();
      onChanged();
    } catch (error) {
      const description = error instanceof QaGateError
        ? `${error.result.blockingCount} QA issue(s) still block publication. Open Price Book QA for details.`
        : error instanceof Error ? error.message : String(error);
      toast({ title: 'Hardware revision not published', description, variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onClose}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Review hardware pricing</h1>
          <p className="text-sm text-muted-foreground">{book.name} · {book.originalFileName}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || working}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="py-4"><p className="text-2xl font-semibold">{summary?.priceCount ?? rows.length}</p><p className="text-xs text-muted-foreground">Price observations</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-2xl font-semibold text-emerald-600">{counts.approved}</p><p className="text-xs text-muted-foreground">Approved</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-2xl font-semibold text-amber-600">{counts.review}</p><p className="text-xs text-muted-foreground">Needs review</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-2xl font-semibold text-muted-foreground">{counts.rejected}</p><p className="text-xs text-muted-foreground">Rejected</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-base">Price decisions</CardTitle>
              <CardDescription>
                Import-ready rows are already approved. Resolve only the workbook’s conflict/unpriced queue; rejected observations stay auditable and never price a quote.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={working || selected.size === 0} onClick={() => void decideSelected('APPROVED')}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve selected
              </Button>
              <Button variant="outline" size="sm" disabled={working || selected.size === 0} onClick={() => void decideSelected('REJECTED')}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" />Reject selected
              </Button>
              <Button size="sm" disabled={working || counts.review > 0 || !book.priceBookDocumentId} onClick={() => void finalizeAndPublish()}>
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Finalize &amp; publish
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search manufacturer, SKU, description, source row…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NEEDS_REVIEW">Needs review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="ALL">All rows</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading hardware prices…</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => setSelected(checked
                          ? new Set(unresolvedVisible.map((row) => row.priceId))
                          : new Set())}
                        aria-label="Select visible review rows"
                      />
                    </TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU / options</TableHead>
                    <TableHead className="text-right">List</TableHead>
                    <TableHead className="text-right">Multiplier</TableHead>
                    <TableHead className="w-32 text-right">Net cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const unresolved = !['APPROVED', 'REJECTED'].includes(row.reviewStatus);
                    return (
                      <TableRow key={row.priceId}>
                        <TableCell>
                          {unresolved && <Checkbox checked={selected.has(row.priceId)} onCheckedChange={(checked) => setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(row.priceId); else next.delete(row.priceId);
                            return next;
                          })} aria-label={`Select ${row.sku ?? row.priceId}`} />}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <p className="text-xs font-medium">{row.description ?? 'Unnamed hardware'}</p>
                          <p className="text-[11px] text-muted-foreground">{row.manufacturerName ?? 'Unknown manufacturer'} · {row.category}</p>
                        </TableCell>
                        <TableCell className="text-xs">
                          <p>{row.sku ?? '—'}</p>
                          <p className="text-[11px] text-muted-foreground">{[row.func, row.finish, row.size].filter(Boolean).join(' · ') || row.sourceRowRef || '—'}</p>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.listPrice == null ? '—' : `$${row.listPrice.toFixed(2)}`}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{row.discountMultiplier ?? '—'}</TableCell>
                        <TableCell>
                          {unresolved ? (
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              className="h-8 text-right text-xs tabular-nums"
                              value={netDrafts[row.priceId] ?? ''}
                              onChange={(event) => setNetDrafts((current) => ({ ...current, [row.priceId]: event.target.value }))}
                            />
                          ) : (
                            <p className="text-right text-xs tabular-nums">{row.netCost == null ? '—' : `$${row.netCost.toFixed(2)}`}</p>
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(row.reviewStatus)}</TableCell>
                        <TableCell className="text-right">
                          {unresolved && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" disabled={working} onClick={() => void decideOne(row, 'APPROVED')}>Approve</Button>
                              <Button size="sm" variant="ghost" disabled={working} onClick={() => void decideOne(row, 'REJECTED')}>Reject</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visible.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No hardware price rows match this view.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
