import { useEffect, useState } from 'react';
import { Check, Clipboard, ExternalLink, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  createQuoteApprovalLink,
  getQuoteOperations,
  updateQuoteOperations,
  type OperationStage,
  type OperationStageStatus,
  type QuoteOperations,
} from '@/lib/quote-workflow-api';

const STAGES: Array<{ key: OperationStage; label: string }> = [
  { key: 'procurement', label: 'Procurement' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'staging', label: 'Staging' },
  { key: 'fulfillment', label: 'Fulfillment' },
];

const STATUS_LABELS: Record<OperationStageStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', complete: 'Complete',
};

export function QuoteWorkflowCard({ quoteId, recipientEmail }: { quoteId: string; recipientEmail?: string | null }) {
  const { toast } = useToast();
  const [email, setEmail] = useState(recipientEmail ?? '');
  const [expiresDays, setExpiresDays] = useState(14);
  const [approvalLink, setApprovalLink] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);
  const [operations, setOperations] = useState<QuoteOperations | null>(null);
  const [notes, setNotes] = useState('');
  const [updatingStage, setUpdatingStage] = useState<OperationStage | null>(null);

  useEffect(() => {
    getQuoteOperations(quoteId).then((result) => {
      setOperations(result);
      setNotes(result?.notes ?? '');
    }).catch(() => undefined);
  }, [quoteId]);

  const createLink = async () => {
    setCreatingLink(true);
    try {
      const link = await createQuoteApprovalLink(quoteId, email, expiresDays);
      setApprovalLink(link);
      toast({ title: 'Customer approval link created', description: 'Any previous pending link for this quote was revoked.' });
    } catch (error) {
      toast({ title: 'Approval link was not created', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setCreatingLink(false);
    }
  };

  const setStage = async (stage: OperationStage, status: OperationStageStatus) => {
    setUpdatingStage(stage);
    try {
      const updated = await updateQuoteOperations(quoteId, stage, status, notes);
      setOperations(updated);
      toast({ title: `${STAGES.find((item) => item.key === stage)?.label} updated` });
    } catch (error) {
      toast({ title: 'Operations status was not saved', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setUpdatingStage(null);
    }
  };

  const currentStatus = (stage: OperationStage): OperationStageStatus =>
    operations?.[`${stage}Status` as keyof QuoteOperations] as OperationStageStatus ?? 'not_started';

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Customer Approval & Operations</CardTitle><CardDescription>Create a token-scoped customer acknowledgement, then track the approved quote through fulfillment.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2 font-medium"><Send className="h-4 w-4" />Customer approval</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto]">
            <div className="space-y-1"><Label>Recipient email</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" /></div>
            <div className="space-y-1"><Label>Expires in days</Label><Input type="number" min={1} max={90} value={expiresDays} onChange={(event) => setExpiresDays(Math.max(1, Math.min(90, Number(event.target.value) || 14)))} /></div>
            <Button className="self-end" onClick={() => void createLink()} disabled={creatingLink}>{creatingLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create link</Button>
          </div>
          {approvalLink && <div className="flex gap-2"><Input readOnly value={approvalLink} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => { void navigator.clipboard.writeText(approvalLink); toast({ title: 'Approval link copied' }); }}><Clipboard className="h-4 w-4" /></Button><Button variant="outline" size="icon" asChild><a href={approvalLink} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button></div>}
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2 font-medium"><Check className="h-4 w-4" />Operations stages</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{STAGES.map((stage) => <div key={stage.key} className="space-y-1"><Label>{stage.label}</Label><Select value={currentStatus(stage.key)} onValueChange={(value) => void setStage(stage.key, value as OperationStageStatus)} disabled={updatingStage === stage.key}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>)}</div>
          <div className="space-y-1"><Label>Operations notes</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Vendor commitments, receiving exceptions, staging location, delivery notes…" /></div>
          <p className="text-[11px] text-muted-foreground">Notes are saved with the next stage update.</p>
        </div>
      </CardContent>
    </Card>
  );
}

