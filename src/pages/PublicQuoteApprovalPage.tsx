import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileText, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getPublicQuoteApproval, respondToQuoteApproval, type CustomerApprovalDecision, type PublicQuoteApproval } from '@/lib/quote-workflow-api';

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

export default function PublicQuoteApprovalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [approval, setApproval] = useState<PublicQuoteApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState<CustomerApprovalDecision | null>(null);

  useEffect(() => {
    getPublicQuoteApproval(token)
      .then((result) => setApproval(result))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load quote approval.'))
      .finally(() => setLoading(false));
  }, [token]);

  const context = approval?.context ?? null;
  const job = useMemo(() => (context?.job as Record<string, unknown> | undefined) ?? {}, [context]);
  const company = useMemo(() => (context?.company as Record<string, unknown> | undefined) ?? {}, [context]);

  const respond = async (decision: CustomerApprovalDecision) => {
    if (!customerName.trim()) {
      setError('Enter your name before responding.');
      return;
    }
    setSubmitting(decision);
    setError(null);
    try {
      await respondToQuoteApproval(token, decision, customerName, comment);
      setApproval((current) => current ? { ...current, status: decision } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record your response.');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (error && !approval) return <div className="flex min-h-screen items-center justify-center p-6"><Card className="max-w-lg"><CardHeader><CardTitle>Quote approval unavailable</CardTitle><CardDescription>{error}</CardDescription></CardHeader></Card></div>;
  if (!approval) return null;

  const pending = approval.status === 'pending';
  return (
    <main className="min-h-screen bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{approval.quoteNumber}</CardTitle><CardDescription>{String(job.jobName ?? company.name ?? 'IES quote')} · expires {new Date(approval.expiresAt).toLocaleDateString()}</CardDescription></div><div className="text-right"><p className="text-xs uppercase text-muted-foreground">Quote total</p><p className="text-2xl font-semibold">{money(approval.total, approval.currency)}</p></div></div></CardHeader></Card>

        <Card><CardHeader><CardTitle className="text-base">Quoted items</CardTitle><CardDescription>Customer-facing sell prices only; internal cost and margin information is not included.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{approval.items.map((item, index) => <TableRow key={`${item.code ?? item.label}-${index}`}><TableCell><p className="font-medium">{item.label}</p>{item.code && <p className="text-xs text-muted-foreground">{item.code}</p>}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">{money(item.unitPrice, approval.currency)}</TableCell><TableCell className="text-right font-medium">{money(item.lineTotal, approval.currency)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>

        {approval.notes && <Card><CardHeader><CardTitle className="text-base">Quote notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{approval.notes}</p></CardContent></Card>}

        <Card><CardHeader><CardTitle className="text-base">Customer acknowledgement</CardTitle><CardDescription>{pending ? 'Enter your name, optionally add a comment, then approve or reject this quote.' : `This request has been ${approval.status}.`}</CardDescription></CardHeader><CardContent className="space-y-4">
          {pending ? <><div className="space-y-1.5"><Label htmlFor="customer-name">Your name *</Label><Input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="customer-comment">Comment</Label><Textarea id="customer-comment" value={comment} onChange={(event) => setComment(event.target.value)} /></div>{error && <p className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap gap-3"><Button onClick={() => void respond('approved')} disabled={!!submitting}><CheckCircle2 className="mr-2 h-4 w-4" />Approve quote</Button><Button variant="destructive" onClick={() => void respond('rejected')} disabled={!!submitting}><XCircle className="mr-2 h-4 w-4" />Reject quote</Button></div></> : <div className="flex items-center gap-2 text-sm font-medium">{approval.status === 'approved' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-destructive" />}Response recorded. Thank you.</div>}
        </CardContent></Card>
      </div>
    </main>
  );
}

