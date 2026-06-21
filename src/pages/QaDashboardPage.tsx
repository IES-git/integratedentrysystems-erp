import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { loadQaSummary, loadQaIssues, rerunQaChecks, type QaSummaryRow } from '@/lib/cpq/qa-dashboard-api';
import type { QaIssue, QaIssueSeverity } from '@/types';

const SEVERITY_ORDER: QaIssueSeverity[] = ['BLOCK', 'ERROR', 'WARNING', 'INFO'];

function severityIcon(sev: QaIssueSeverity) {
  if (sev === 'ERROR' || sev === 'BLOCK') return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (sev === 'WARNING') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function severityBadgeClass(sev: QaIssueSeverity): string {
  if (sev === 'ERROR' || sev === 'BLOCK') return 'bg-destructive/10 text-destructive border-destructive/30';
  if (sev === 'WARNING') return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
  return 'bg-muted text-muted-foreground';
}

interface BookGroup {
  title: string;
  priceBookId: string | null;
  rows: QaSummaryRow[];
  openBlocking: number;
  openWarnings: number;
}

function groupByBook(rows: QaSummaryRow[]): BookGroup[] {
  const map = new Map<string, BookGroup>();
  for (const r of rows) {
    const key = r.priceBookId ?? r.priceBookTitle;
    if (!map.has(key)) {
      map.set(key, { title: r.priceBookTitle, priceBookId: r.priceBookId, rows: [], openBlocking: 0, openWarnings: 0 });
    }
    const g = map.get(key)!;
    g.rows.push(r);
    if (r.status === 'open' && (r.severity === 'ERROR' || r.severity === 'BLOCK')) g.openBlocking += r.issueCount;
    if (r.status === 'open' && r.severity === 'WARNING') g.openWarnings += r.issueCount;
  }
  return [...map.values()].sort((a, b) => b.openBlocking - a.openBlocking || b.openWarnings - a.openWarnings);
}

export default function QaDashboardPage() {
  const [summary, setSummary] = useState<QaSummaryRow[]>([]);
  const [openErrors, setOpenErrors] = useState<QaIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, issues] = await Promise.all([
        loadQaSummary(),
        loadQaIssues({ status: 'open', limit: 200 }),
      ]);
      setSummary(sum);
      setOpenErrors(issues.filter((i) => i.severity === 'ERROR' || i.severity === 'BLOCK'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load QA dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const books = useMemo(() => groupByBook(summary), [summary]);
  const totalBlocking = books.reduce((s, b) => s + b.openBlocking, 0);
  const totalWarnings = books.reduce((s, b) => s + b.openWarnings, 0);

  const handleRerun = async (priceBookId: string | null) => {
    if (!priceBookId) return;
    setRerunningId(priceBookId);
    try {
      await rerunQaChecks(priceBookId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to re-run QA checks.');
    } finally {
      setRerunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">Price Book QA</h1>
          <p className="text-sm text-muted-foreground">
            Ingestion and data-quality findings. Resolve blocking issues before publishing a price book.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Top-line tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', totalBlocking > 0 ? 'bg-destructive/10' : 'bg-emerald-500/10')}>
              {totalBlocking > 0 ? <AlertCircle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-emerald-500" />}
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{totalBlocking}</p>
              <p className="text-xs text-muted-foreground">Open blocking (ERROR)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{totalWarnings}</p>
              <p className="text-xs text-muted-foreground">Open warnings</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Info className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums">{books.length}</p>
              <p className="text-xs text-muted-foreground">Price books tracked</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Per-book breakdown */}
          {books.map((book) => (
            <Card key={book.priceBookId ?? book.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {book.title}
                  {book.openBlocking > 0 ? (
                    <Badge variant="outline" className={severityBadgeClass('ERROR')}>{book.openBlocking} blocking</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">clear</Badge>
                  )}
                </CardTitle>
                {book.priceBookId && (
                  <Button variant="outline" size="sm" onClick={() => void handleRerun(book.priceBookId)} disabled={rerunningId === book.priceBookId}>
                    {rerunningId === book.priceBookId
                      ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
                    Re-run checks
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {[...book.rows]
                    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.issueCount - a.issueCount)
                    .map((r, i) => (
                      <div key={`${r.checkName}-${r.severity}-${r.status}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                        {severityIcon(r.severity)}
                        <span className="font-mono text-xs">{r.checkName}</span>
                        <Badge variant="outline" className={cn('text-[10px]', severityBadgeClass(r.severity))}>{r.severity}</Badge>
                        <span className={cn('text-xs', r.status === 'resolved' ? 'text-muted-foreground line-through' : 'text-muted-foreground')}>
                          {r.status}
                        </span>
                        <span className="ml-auto font-semibold tabular-nums">{r.issueCount}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Open blocking detail */}
          {openErrors.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Open blocking issues ({openErrors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {openErrors.slice(0, 100).map((issue) => (
                  <div key={issue.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">{issue.checkName}</span>
                      <p className="text-sm break-words">{issue.detail}</p>
                    </div>
                  </div>
                ))}
                {openErrors.length > 100 && (
                  <p className="text-xs text-muted-foreground">Showing first 100 of {openErrors.length}.</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
