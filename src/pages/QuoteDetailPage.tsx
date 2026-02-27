import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Send,
  Tag,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FilePreview } from '@/components/estimates/wizard/PdfPreview';
import { CustomerQuotePdf } from '@/components/quotes/CustomerQuotePdf';
import { ManufacturerQuotePdf } from '@/components/quotes/ManufacturerQuotePdf';
import type { ManufacturerQuoteItem } from '@/components/quotes/ManufacturerQuotePdf';
import { useToast } from '@/hooks/use-toast';
import { getQuoteWithItems, updateQuoteStatus } from '@/lib/quotes-api';
import { getCompany } from '@/lib/companies-api';
import { getEstimateWithItems, getEstimateFileUrl } from '@/lib/estimates-api';
import { generateQuoteSummary } from '@/lib/gemini-api';
import type { Company, Estimate, ItemField, Quote, QuoteItem, QuoteStatus, QuoteType } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteItemWithFields = QuoteItem & { fields: ItemField[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const STATUS_CONFIG: Record<
  QuoteStatus,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon: React.ReactNode }
> = {
  draft: { variant: 'secondary', label: 'Draft', icon: <FileText className="h-3.5 w-3.5" /> },
  sent: { variant: 'default', label: 'Sent', icon: <Send className="h-3.5 w-3.5" /> },
  approved: {
    variant: 'outline',
    label: 'Approved',
    icon: <CheckCircle className="h-3.5 w-3.5 text-green-600" />,
  },
  rejected: {
    variant: 'destructive',
    label: 'Rejected',
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
  converted: {
    variant: 'outline',
    label: 'Converted',
    icon: <CheckCircle className="h-3.5 w-3.5 text-blue-600" />,
  },
};

const TYPE_CONFIG: Record<QuoteType, { label: string; className: string }> = {
  customer: { label: 'Customer', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  manufacturer: {
    label: 'Manufacturer',
    className: 'bg-purple-100 text-purple-700 border-purple-200',
  },
  both: {
    label: 'Customer & Manufacturer',
    className: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  },
};

const NEXT_STATUSES: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['sent', 'rejected'],
  sent: ['approved', 'rejected'],
  approved: ['converted'],
  rejected: [],
  converted: [],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: QuoteStatus }) {
  const { variant, label, icon } = STATUS_CONFIG[status];
  return (
    <Badge variant={variant} className="flex items-center gap-1.5 text-sm px-3 py-1">
      {icon}
      {label}
    </Badge>
  );
}

function TypeBadge({ quoteType }: { quoteType: QuoteType }) {
  const { label, className } = TYPE_CONFIG[quoteType];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${className}`}
    >
      <Tag className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function MarkupBadge({ multiplier }: { multiplier: number }) {
  const color =
    multiplier >= 1.4
      ? 'bg-red-100 text-red-700 border-red-200'
      : multiplier >= 1.2
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-green-100 text-green-700 border-green-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${color}`}
    >
      <TrendingUp className="h-3.5 w-3.5" />
      {multiplier}× markup
    </span>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItemWithFields[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // PDF download states
  const [isDownloadingCustomer, setIsDownloadingCustomer] = useState(false);
  const [isDownloadingManufacturer, setIsDownloadingManufacturer] = useState(false);

  // Estimate panel state
  const [showEstimatePanel, setShowEstimatePanel] = useState(false);
  const [estimateFileUrl, setEstimateFileUrl] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [isLoadingEstimate, setIsLoadingEstimate] = useState(false);

  useEffect(() => {
    if (!id) return;

    getQuoteWithItems(id)
      .then(async (result) => {
        if (!result) {
          toast({ title: 'Quote not found', variant: 'destructive' });
          navigate('/app/quotes');
          return;
        }
        setQuote(result.quote);
        setItems(result.items);

        if (result.quote.companyId) {
          const co = await getCompany(result.quote.companyId).catch(() => null);
          setCompany(co);
        }
      })
      .catch((err) => {
        toast({ title: 'Failed to load quote', description: err.message, variant: 'destructive' });
      })
      .finally(() => setIsLoading(false));
  }, [id, navigate, toast]);

  // ── Status update ──────────────────────────────────────────────────────────

  const handleStatusChange = async (newStatus: QuoteStatus) => {
    if (!quote) return;
    setIsUpdatingStatus(true);
    try {
      const updated = await updateQuoteStatus(quote.id, newStatus);
      setQuote(updated);
      toast({
        title: 'Status updated',
        description: `Quote marked as ${STATUS_CONFIG[newStatus].label}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Failed to update status', description: message, variant: 'destructive' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // ── PDF downloads ──────────────────────────────────────────────────────────

  const handleDownloadCustomer = useCallback(async () => {
    if (!quote) return;
    setIsDownloadingCustomer(true);
    try {
      let aiSummary: string | null = null;
      try {
        aiSummary = await generateQuoteSummary({
          companyName: company?.name ?? null,
          items: items.map((i) => ({
            label: i.itemLabel,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
          })),
          total: quote.total,
          currency: quote.currency,
          notes: quote.notes,
        });
      } catch {
        // AI summary is optional — skip silently
      }

      const blob = await pdf(
        <CustomerQuotePdf quote={quote} items={items} company={company} aiSummary={aiSummary} />
      ).toBlob();

      const name = company?.name ?? 'Customer';
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `Quote-${name.replace(/\s+/g, '-')}-${date}.pdf`);
    } catch (err) {
      toast({
        title: 'PDF generation failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingCustomer(false);
    }
  }, [quote, items, company, toast]);

  const handleDownloadManufacturer = useCallback(async () => {
    if (!quote) return;
    setIsDownloadingManufacturer(true);
    try {
      const mfrItems: ManufacturerQuoteItem[] = items.map((i) => ({
        ...i,
        fields: i.fields,
      }));

      const blob = await pdf(
        <ManufacturerQuotePdf quote={quote} items={mfrItems} company={company} />
      ).toBlob();

      const name = company?.name ?? 'Manufacturer';
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `RFQ-${name.replace(/\s+/g, '-')}-${date}.pdf`);
    } catch (err) {
      toast({
        title: 'PDF generation failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingManufacturer(false);
    }
  }, [quote, items, company, toast]);

  const handleDownloadBoth = useCallback(async () => {
    await Promise.all([handleDownloadCustomer(), handleDownloadManufacturer()]);
  }, [handleDownloadCustomer, handleDownloadManufacturer]);

  // ── Estimate panel ─────────────────────────────────────────────────────────

  const handleViewSourceEstimate = useCallback(async () => {
    if (!quote) return;

    // If we already have the file URL, just show the panel
    if (estimateFileUrl) {
      setShowEstimatePanel(true);
      return;
    }

    setIsLoadingEstimate(true);
    try {
      const result = await getEstimateWithItems(quote.estimateId);
      if (!result) {
        toast({ title: 'Source estimate not found', variant: 'destructive' });
        return;
      }
      setEstimate(result.estimate);
      const url = await getEstimateFileUrl(result.estimate.originalFileUrl);
      setEstimateFileUrl(url);
      setShowEstimatePanel(true);
    } catch (err) {
      toast({
        title: 'Failed to load estimate',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsLoadingEstimate(false);
    }
  }, [quote, estimateFileUrl, toast]);

  // ── Loading / not found ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) return null;

  // ── Derived values ─────────────────────────────────────────────────────────

  const nextStatuses = NEXT_STATUSES[quote.status];
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const showCustomerPdf = quote.quoteType === 'customer' || quote.quoteType === 'both';
  const showManufacturerPdf = quote.quoteType === 'manufacturer' || quote.quoteType === 'both';
  const isBusy = isDownloadingCustomer || isDownloadingManufacturer;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/app/quotes')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl sm:text-3xl tracking-wide">
                Q-{quote.id.slice(-8).toUpperCase()}
              </h1>
              <StatusBadge status={quote.status} />
              <TypeBadge quoteType={quote.quoteType} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Created{' '}
              {new Date(quote.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {nextStatuses.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isUpdatingStatus}>
                  {isUpdatingStatus ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="mr-2 h-4 w-4" />
                  )}
                  Update Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {nextStatuses.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => handleStatusChange(s)}>
                    <span className="flex items-center gap-2">
                      {STATUS_CONFIG[s].icon}
                      Mark as {STATUS_CONFIG[s].label}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* PDF download buttons */}
          {showCustomerPdf && showManufacturerPdf ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isBusy}>
                  {isBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download PDF
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={handleDownloadCustomer}
                  disabled={isDownloadingCustomer}
                >
                  {isDownloadingCustomer ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Customer Quote PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDownloadManufacturer}
                  disabled={isDownloadingManufacturer}
                >
                  {isDownloadingManufacturer ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Manufacturer RFQ PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadBoth} disabled={isBusy}>
                  {isBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download Both
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : showCustomerPdf ? (
            <Button variant="outline" onClick={handleDownloadCustomer} disabled={isDownloadingCustomer}>
              {isDownloadingCustomer ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Customer Quote PDF
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleDownloadManufacturer}
              disabled={isDownloadingManufacturer}
            >
              {isDownloadingManufacturer ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Manufacturer RFQ PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: line items + totals + notes */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm">No line items found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-center w-16">Qty</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{item.itemLabel}</p>
                              {item.canonicalCode && (
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {item.canonicalCode}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {fmt(item.unitCost, quote.currency)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {fmt(item.unitPrice, quote.currency)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {fmt(item.lineTotal, quote.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardContent className="p-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmt(subtotal, quote.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Markup ({quote.markupMultiplier}×)
                  </span>
                  <span>{fmt(subtotal * (quote.markupMultiplier - 1), quote.currency)}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between text-base font-semibold">
                  <span>Total</span>
                  <span>{fmt(quote.total, quote.currency)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {quote.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Details & Summary panel OR Estimate file preview */}
        <div className="space-y-4">
          {showEstimatePanel && estimateFileUrl && estimate ? (
            /* ── Estimate file preview ── */
            <FilePreview
              fileUrl={estimateFileUrl}
              fileName={estimate.originalFileName}
              fileType={estimate.fileType === 'image' ? 'image' : 'pdf'}
              className="h-[600px]"
              onClose={() => setShowEstimatePanel(false)}
            />
          ) : (
            /* ── Details & Summary ── */
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <InfoCard
                    icon={<Tag className="h-4 w-4" />}
                    label="Quote Type"
                    value={<TypeBadge quoteType={quote.quoteType} />}
                  />
                  <InfoCard
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="Markup"
                    value={<MarkupBadge multiplier={quote.markupMultiplier} />}
                  />
                  {company && (
                    <InfoCard
                      icon={<Building2 className="h-4 w-4" />}
                      label="Customer"
                      value={
                        <button
                          className="text-primary hover:underline text-sm font-medium"
                          onClick={() => navigate(`/app/customers/${company.id}`)}
                        >
                          {company.name}
                        </button>
                      }
                    />
                  )}
                  <InfoCard
                    icon={<Calendar className="h-4 w-4" />}
                    label="Created"
                    value={new Date(quote.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  />
                  <InfoCard
                    icon={<Calendar className="h-4 w-4" />}
                    label="Last Updated"
                    value={new Date(quote.updatedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Items</span>
                    <span className="font-medium">{items.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Currency</span>
                    <span className="font-medium">{quote.currency}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Total</span>
                    <span className="text-lg">{fmt(quote.total, quote.currency)}</span>
                  </div>
                </CardContent>
              </Card>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleViewSourceEstimate}
                disabled={isLoadingEstimate}
              >
                {isLoadingEstimate ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PanelRight className="mr-2 h-4 w-4" />
                )}
                View Source Estimate
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
