import { useState, useEffect } from 'react';
import { Loader2, Mail, Paperclip, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { Company, Contact, Quote } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote;
  company: Company | null;
  contacts: Contact[];
  /** Whether a manufacturer PDF will also be attached. */
  includesManufacturerPdf: boolean;
  onSend: (params: {
    recipientEmail: string;
    ccEmails: string[];
    subject: string;
    message: string;
  }) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string) {
  return EMAIL_RE.test(email.trim());
}

function buildDefaultSubject(quote: Quote, company: Company | null): string {
  const quoteRef = `Q-${quote.id.slice(-8).toUpperCase()}`;
  const companyName = company?.name ?? 'your company';
  return `Your Quote ${quoteRef} from Integrated Entry Systems`;
}

function buildDefaultMessage(quote: Quote, company: Company | null): string {
  const companyName = company?.name ?? 'you';
  const quoteRef = `Q-${quote.id.slice(-8).toUpperCase()}`;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: quote.currency ?? 'USD' }).format(n);

  const paymentTerms = company?.settings?.paymentTerms
    ? `\nPayment terms: ${company.settings.paymentTerms}`
    : '';

  return `Dear ${companyName},

Thank you for the opportunity to provide a quote for your project.

Please find attached our quote ${quoteRef} with a total of ${fmt(quote.total)}.${paymentTerms}

If you have any questions or would like to discuss this quote further, please don't hesitate to reach out.

Best regards,
Integrated Entry Systems`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SendQuoteDialog({
  open,
  onOpenChange,
  quote,
  company,
  contacts,
  includesManufacturerPdf,
  onSend,
}: SendQuoteDialogProps) {
  // Derive default recipient from primary contact (first in list since listContacts orders primary first)
  const primaryContact = contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email);

  const contactOptions = contacts.filter((c) => c.email);
  const MANUAL_KEY = '__manual__';

  const [selectedContactId, setSelectedContactId] = useState<string>(
    primaryContact ? primaryContact.id : MANUAL_KEY,
  );
  const [manualEmail, setManualEmail] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState(() => buildDefaultSubject(quote, company));
  const [message, setMessage] = useState(() => buildDefaultMessage(quote, company));
  const [isSending, setIsSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    const primary = contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email);
    setSelectedContactId(primary ? primary.id : MANUAL_KEY);
    setManualEmail('');
    setCcInput('');
    setCcEmails([]);
    setSubject(buildDefaultSubject(quote, company));
    setMessage(buildDefaultMessage(quote, company));
    setErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resolvedEmail =
    selectedContactId === MANUAL_KEY
      ? manualEmail.trim()
      : (contacts.find((c) => c.id === selectedContactId)?.email ?? '');

  function addCc() {
    const email = ccInput.trim();
    if (!email) return;
    if (!isValidEmail(email)) {
      setErrors((e) => ({ ...e, cc: 'Invalid email address' }));
      return;
    }
    if (ccEmails.includes(email)) {
      setErrors((e) => ({ ...e, cc: 'Already in CC list' }));
      return;
    }
    setCcEmails((prev) => [...prev, email]);
    setCcInput('');
    setErrors((e) => ({ ...e, cc: '' }));
  }

  function removeCc(email: string) {
    setCcEmails((prev) => prev.filter((e) => e !== email));
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!resolvedEmail) {
      newErrors.recipient = 'Recipient email is required';
    } else if (!isValidEmail(resolvedEmail)) {
      newErrors.recipient = 'Invalid email address';
    }
    if (!subject.trim()) {
      newErrors.subject = 'Subject is required';
    }
    if (!message.trim()) {
      newErrors.message = 'Message body is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSend() {
    if (!validate()) return;
    setIsSending(true);
    try {
      await onSend({ recipientEmail: resolvedEmail, ccEmails, subject, message });
      onOpenChange(false);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Quote to Customer
          </DialogTitle>
          <DialogDescription>
            The quote PDF will be attached and sent directly to the customer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Attachments indicator */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md">
              <Paperclip className="h-3 w-3" />
              Customer Quote PDF
            </div>
            {includesManufacturerPdf && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md">
                <Paperclip className="h-3 w-3" />
                Manufacturer RFQ PDF
              </div>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <Label htmlFor="recipient">To</Label>
            {contactOptions.length > 0 ? (
              <>
                <Select
                  value={selectedContactId}
                  onValueChange={(v) => {
                    setSelectedContactId(v);
                    setErrors((e) => ({ ...e, recipient: '' }));
                  }}
                >
                  <SelectTrigger id="recipient">
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contactOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                        {c.isPrimary && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(Primary)</span>
                        )}
                        <span className="ml-1.5 text-xs text-muted-foreground">{c.email}</span>
                      </SelectItem>
                    ))}
                    <SelectItem value={MANUAL_KEY}>Enter email manually…</SelectItem>
                  </SelectContent>
                </Select>
                {selectedContactId === MANUAL_KEY && (
                  <Input
                    type="email"
                    placeholder="customer@example.com"
                    value={manualEmail}
                    onChange={(e) => {
                      setManualEmail(e.target.value);
                      setErrors((err) => ({ ...err, recipient: '' }));
                    }}
                    className="mt-1.5"
                  />
                )}
              </>
            ) : (
              <Input
                id="recipient"
                type="email"
                placeholder="customer@example.com"
                value={manualEmail}
                onChange={(e) => {
                  setManualEmail(e.target.value);
                  setErrors((err) => ({ ...err, recipient: '' }));
                }}
              />
            )}
            {errors.recipient && (
              <p className="text-xs text-destructive">{errors.recipient}</p>
            )}
          </div>

          {/* CC */}
          <div className="space-y-1.5">
            <Label>CC (optional)</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="cc@example.com"
                value={ccInput}
                onChange={(e) => {
                  setCcInput(e.target.value);
                  setErrors((err) => ({ ...err, cc: '' }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addCc();
                  }
                }}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="icon" onClick={addCc}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {errors.cc && <p className="text-xs text-destructive">{errors.cc}</p>}
            {ccEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ccEmails.map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1 pr-1">
                    {email}
                    <button
                      type="button"
                      onClick={() => removeCc(email)}
                      className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 focus:outline-none"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setErrors((err) => ({ ...err, subject: '' }));
              }}
            />
            {errors.subject && (
              <p className="text-xs text-destructive">{errors.subject}</p>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setErrors((err) => ({ ...err, message: '' }));
              }}
              rows={8}
              className="resize-y text-sm"
            />
            {errors.message && (
              <p className="text-xs text-destructive">{errors.message}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            {isSending ? 'Sending…' : 'Send Quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
