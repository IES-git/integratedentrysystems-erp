import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Package, Search, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listQuoteOperations, type OperationStageStatus, type OperationsDashboardRow } from '@/lib/quote-workflow-api';

const STAGES = ['procurement', 'receiving', 'staging', 'fulfillment'] as const;
const STATUS: Record<OperationStageStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  not_started: { label: 'Not started', variant: 'secondary' },
  in_progress: { label: 'In progress', variant: 'default' },
  blocked: { label: 'Blocked', variant: 'destructive' },
  complete: { label: 'Complete', variant: 'outline' },
};

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}
export default function OrdersPage() {
  const [rows, setRows] = useState<OperationsDashboardRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listQuoteOperations().then(setRows).catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load operations.')).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [row.quoteNumber, row.customerName, row.jobName, row.quoteStatus, row.notes].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [rows, search]);

  const stageCount = (stage: typeof STAGES[number], status: OperationStageStatus) => rows.filter((row) => row[`${stage}Status`] === status).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8"><h1 className="font-display text-2xl tracking-wide sm:text-3xl lg:text-4xl">Operations</h1><p className="mt-1 text-muted-foreground">Track customer-approved quotes through procurement, receiving, staging, and fulfillment.</p></div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAGES.map((stage, index) => {
          const Icon = [Package, Truck, Clock, CheckCircle2][index];
          return <Card key={stage}><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm capitalize text-muted-foreground">{stage}</p><p className="text-2xl font-semibold">{stageCount(stage, 'complete')}/{rows.length}</p><p className="text-[11px] text-muted-foreground">{stageCount(stage, 'blocked')} blocked</p></div><div className="rounded-full bg-muted p-2"><Icon className="h-4 w-4" /></div></div></CardContent></Card>;
        })}
      </div>
      <Card><CardHeader><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Approved Quote Operations</CardTitle><CardDescription>{rows.length} tracked quote{rows.length === 1 ? '' : 's'}</CardDescription></div><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quote, customer, job…" className="pl-9" /></div></div></CardHeader><CardContent>
        {loading ? <div className="py-12 text-center text-muted-foreground">Loading operations…</div> : error ? <div className="flex items-center gap-2 rounded-md border border-destructive/40 p-4 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</div> : filtered.length === 0 ? <div className="py-12 text-center text-muted-foreground">No approved quote operations match this view.</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Quote / Job</TableHead><TableHead>Customer</TableHead>{STAGES.map((stage) => <TableHead key={stage} className="capitalize">{stage}</TableHead>)}<TableHead className="text-right">Quote total</TableHead></TableRow></TableHeader><TableBody>{filtered.map((row) => <TableRow key={row.id}><TableCell><Link to={`/app/quotes/${row.quoteId}`} className="font-mono text-sm font-medium text-primary hover:underline">{row.quoteNumber}</Link><p className="text-xs text-muted-foreground">{row.jobName}</p></TableCell><TableCell>{row.customerName}</TableCell>{STAGES.map((stage) => { const value = row[`${stage}Status`]; const config = STATUS[value]; return <TableCell key={stage}><Badge variant={config.variant}>{config.label}</Badge></TableCell>; })}<TableCell className="text-right font-medium">{money(row.total, row.currency)}</TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent></Card>
    </div>
  );
}
