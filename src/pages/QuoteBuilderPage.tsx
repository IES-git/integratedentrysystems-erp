import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import {
  ArrowLeft,
  Building2,
  Download,
  FileText,
  Loader2,
  Save,
  Tag,
  TrendingUp,
  Wrench,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getEstimateWithItems } from '@/lib/estimates-api';
import { getCompany } from '@/lib/companies-api';
import { createQuote } from '@/lib/quotes-api';
import { generateQuoteSummary } from '@/lib/gemini-api';
import { CustomerQuotePdf } from '@/components/quotes/CustomerQuotePdf';
import { ManufacturerQuotePdf } from '@/components/quotes/ManufacturerQuotePdf';
import type { Company, EstimateItem, ItemField, Quote, QuoteItem, QuoteType } from '@/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface EstimateItemWithFields extends EstimateItem {
  fields: ItemField[];
}

interface LineItem {
  estimateItem: EstimateItemWithFields;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function MultiplierBadge({ multiplier }: { multiplier: number }) {
  const color =
    multiplier >= 1.4
      ? 'bg-red-100 text-red-700 border-red-200'
      : multiplier >= 1.2
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-green-100 text-green-700 border-green-200';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      <TrendingUp className="h-3 w-3" />
      {multiplier}×
    </span>
  );
}

interface CustomerLineItemsTableProps {
  items: LineItem[];
  currency: string;
}

function CustomerLineItemsTable({ items, currency }: CustomerLineItemsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">Qty</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Customer Price</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.estimateItem.id}
              className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
            >
              <td className="px-4 py-3">
                <span className="font-medium">{item.estimateItem.itemLabel}</span>
              </td>
              <td className="px-4 py-3 text-center text-muted-foreground">
                {item.estimateItem.quantity}
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                  {fmt(item.unitCost, currency)}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-semibold text-foreground">
                  {fmt(item.unitPrice, currency)}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold">
                {fmt(item.lineTotal, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ManufacturerLineItemsTableProps {
  items: LineItem[];
  currency: string;
}

function ManufacturerLineItemsTable({ items, currency }: ManufacturerLineItemsTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const isOpen = expanded[item.estimateItem.id] ?? false;
        const hasFields = item.estimateItem.fields.length > 0;
        const lineCost = item.estimateItem.quantity * item.unitCost;

        return (
          <div key={item.estimateItem.id} className="rounded-lg border overflow-hidden">
            {/* Row header */}
            <div
              className={`flex items-center gap-3 px-4 py-3 ${
                idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
              } ${hasFields ? 'cursor-pointer hover:bg-muted/30' : ''}`}
              onClick={() => hasFields && toggle(item.estimateItem.id)}
            >
              {/* Expand toggle */}
              <button
                type="button"
                className={`flex-none text-muted-foreground transition-transform ${
                  !hasFields ? 'opacity-20 cursor-default' : ''
                }`}
                tabIndex={-1}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>

              {/* Item label + code */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.estimateItem.itemLabel}</div>
                {item.estimateItem.canonicalCode && (
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {item.estimateItem.canonicalCode}
                  </div>
                )}
              </div>

              {/* Meta columns */}
              <div className="flex items-center gap-6 text-sm shrink-0">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Qty</div>
                  <div className="font-medium">{item.estimateItem.quantity}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Unit Cost</div>
                  <div className="font-medium">{fmt(item.unitCost, currency)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Line Total</div>
                  <div className="font-semibold">{fmt(lineCost, currency)}</div>
                </div>
                {hasFields && (
                  <Badge variant="outline" className="text-xs">
                    <Wrench className="mr-1 h-3 w-3" />
                    {item.estimateItem.fields.length} spec{item.estimateItem.fields.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </div>

            {/* Expandable spec grid */}
            {isOpen && hasFields && (
              <div className="border-t bg-muted/5 px-4 py-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {item.estimateItem.fields.map((field) => (
                    <div key={field.id} className="rounded-md bg-background border px-3 py-2">
                      <div className="text-xs text-muted-foreground">{field.fieldLabel}</div>
                      <div className="mt-0.5 text-sm font-medium truncate">{field.fieldValue}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QuoteBuilderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();

  const estimateId = searchParams.get('estimateId');
  const customerId = searchParams.get('customerId');
  const quoteType = (searchParams.get('quoteType') ?? 'customer') as QuoteType;

  // ── State ──────────────────────────────────────────────────────────────────
  const [estimateItems, setEstimateItems] = useState<EstimateItemWithFields[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadingCustomer, setIsDownloadingCustomer] = useState(false);
  const [isDownloadingManufacturer, setIsDownloadingManufacturer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [savedQuote, setSavedQuote] = useState<Quote | null>(null);
  const [editableMultiplier, setEditableMultiplier] = useState(1.0);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!estimateId) {
      navigate('/app/estimates');
      return;
    }

    const load = async () => {
      try {
        const result = await getEstimateWithItems(estimateId);
        if (!result) {
          toast({
            title: 'Estimate not found',
            variant: 'destructive',
          });
          navigate('/app/estimates');
          return;
        }
        setEstimateItems(result.items);

        if (customerId) {
          const co = await getCompany(customerId);
          setCompany(co);
          if (co) {
            setEditableMultiplier(co.settings?.costMultiplier ?? 1.0);
          }
        }
      } catch (err) {
        console.error(err);
        toast({
          title: 'Failed to load estimate',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        });
        navigate('/app/estimates');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [estimateId, customerId, navigate, toast]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const companyDefaultMultiplier = company?.settings?.costMultiplier ?? 1.0;

  const lineItems = useMemo<LineItem[]>(
    () =>
      estimateItems.map((ei) => {
        const unitCost = ei.unitPrice ?? 0;
        const unitPrice = parseFloat((unitCost * editableMultiplier).toFixed(2));
        const qty = ei.quantity;
        return {
          estimateItem: ei,
          unitCost,
          unitPrice,
          lineTotal: parseFloat((qty * unitPrice).toFixed(2)),
        };
      }),
    [estimateItems, editableMultiplier]
  );

  const subtotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.lineTotal, 0),
    [lineItems]
  );

  const total = subtotal;

  const costSubtotal = useMemo(
    () =>
      lineItems.reduce(
        (sum, li) => sum + li.estimateItem.quantity * li.unitCost,
        0
      ),
    [lineItems]
  );

  // ── Build quote items for Supabase ─────────────────────────────────────────
  const buildQuoteItems = useCallback(
    () =>
      lineItems.map((li, idx) => ({
        estimateItemId: li.estimateItem.id,
        itemLabel: li.estimateItem.itemLabel,
        canonicalCode: li.estimateItem.canonicalCode ?? null,
        quantity: li.estimateItem.quantity,
        unitCost: li.unitCost,
        unitPrice: li.unitPrice,
        lineTotal: li.lineTotal,
        sortOrder: idx,
      })),
    [lineItems]
  );

  // ── Save quote ─────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!estimateId || !user) return;
    setIsSaving(true);
    try {
      const quote = await createQuote({
        estimateId,
        companyId: customerId ?? null,
        createdByUserId: user.id,
        quoteType,
        markupMultiplier: editableMultiplier,
        subtotal,
        total,
        notes: notes.trim() || null,
        items: buildQuoteItems(),
      });
      setSavedQuote(quote);
      toast({
        title: 'Quote saved',
        description: `Quote Q-${quote.id.slice(-8).toUpperCase()} saved as draft.`,
      });
      navigate('/app/quotes');
    } catch (err) {
      toast({
        title: 'Failed to save quote',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [estimateId, user, customerId, quoteType, editableMultiplier, subtotal, total, notes, buildQuoteItems, toast, navigate]);

  // ── PDF helpers ────────────────────────────────────────────────────────────
  const buildQuoteForPdf = useCallback((): Quote => {
    const now = new Date().toISOString();
    const base = savedQuote ?? {
      id: `preview-${Date.now()}`,
      estimateId: estimateId ?? '',
      companyId: customerId ?? null,
      createdByUserId: user?.id ?? '',
      status: 'draft' as const,
      quoteType,
      markupMultiplier: editableMultiplier,
      subtotal,
      total,
      currency: 'USD',
      notes: notes.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    return base;
  }, [savedQuote, estimateId, customerId, user, quoteType, editableMultiplier, subtotal, total, notes]);

  const buildQuoteItemsForPdf = useCallback((): QuoteItem[] => {
    const now = new Date().toISOString();
    return lineItems.map((li, idx) => ({
      id: li.estimateItem.id,
      quoteId: savedQuote?.id ?? 'preview',
      estimateItemId: li.estimateItem.id,
      itemLabel: li.estimateItem.itemLabel,
      canonicalCode: li.estimateItem.canonicalCode ?? null,
      quantity: li.estimateItem.quantity,
      unitCost: li.unitCost,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
      sortOrder: idx,
      createdAt: now,
    }));
  }, [lineItems, savedQuote]);

  const handleDownloadCustomer = useCallback(async () => {
    setIsDownloadingCustomer(true);
    try {
      const quote = buildQuoteForPdf();
      const items = buildQuoteItemsForPdf();

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
      } catch (aiErr) {
        console.warn('AI summary skipped:', aiErr);
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
  }, [buildQuoteForPdf, buildQuoteItemsForPdf, company, toast]);

  const handleDownloadManufacturer = useCallback(async () => {
    setIsDownloadingManufacturer(true);
    try {
      const quote = buildQuoteForPdf();
      const items = buildQuoteItemsForPdf().map((qi, idx) => ({
        ...qi,
        fields: lineItems[idx]?.estimateItem.fields ?? [],
      }));
      const blob = await pdf(
        <ManufacturerQuotePdf quote={quote} items={items} company={company} />
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
  }, [buildQuoteForPdf, buildQuoteItemsForPdf, lineItems, company, toast]);

  const handleDownloadBoth = useCallback(async () => {
    await Promise.all([handleDownloadCustomer(), handleDownloadManufacturer()]);
  }, [handleDownloadCustomer, handleDownloadManufacturer]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const quoteTypeBadgeMap: Record<QuoteType, { label: string; className: string }> = {
    customer: {
      label: 'Customer Quote',
      className: 'bg-blue-100 text-blue-700 border-blue-200',
    },
    manufacturer: {
      label: 'Manufacturer RFQ',
      className: 'bg-purple-100 text-purple-700 border-purple-200',
    },
    both: {
      label: 'Customer + Manufacturer',
      className: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    },
  };

  const typeBadge = quoteTypeBadgeMap[quoteType];

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8">
          {/* Header */}
          <div className="mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/app/quotes')}
              className="mb-4 -ml-2"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Quotes
            </Button>

            <div className="flex flex-wrap items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl sm:text-3xl tracking-wide">
                    Quote Builder
                  </h1>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeBadge.className}`}
                  >
                    {typeBadge.label}
                  </span>
                </div>
                {company && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" />
                    {company.name}
                  </p>
                )}
              </div>
            </div>

            {/* Markup banner (customer or both) — always visible, multiplier is editable */}
            {(quoteType === 'customer' || quoteType === 'both') && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Tag className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0">
                  {company ? `Markup for ${company.name}` : 'Markup multiplier'} — customer prices update dynamically.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-xs font-semibold uppercase tracking-wide opacity-70">
                    Multiplier
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.05"
                    value={editableMultiplier}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setEditableMultiplier(parseFloat(v.toFixed(2)));
                    }}
                    className="w-20 rounded border border-amber-300 bg-white px-2 py-1 text-center text-sm font-semibold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <span className="font-semibold">×</span>
                  {editableMultiplier !== companyDefaultMultiplier && (
                    <button
                      type="button"
                      onClick={() => setEditableMultiplier(companyDefaultMultiplier)}
                      className="text-xs underline opacity-70 hover:opacity-100 whitespace-nowrap"
                    >
                      Reset to {companyDefaultMultiplier}×
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Line items */}
          {quoteType === 'both' ? (
            <Tabs defaultValue="customer">
              <TabsList className="mb-4">
                <TabsTrigger value="customer">Customer Quote</TabsTrigger>
                <TabsTrigger value="manufacturer">Manufacturer RFQ</TabsTrigger>
              </TabsList>
              <TabsContent value="customer">
                <CustomerLineItemsTable items={lineItems} currency="USD" />
              </TabsContent>
              <TabsContent value="manufacturer">
                <ManufacturerLineItemsTable items={lineItems} currency="USD" />
              </TabsContent>
            </Tabs>
          ) : quoteType === 'customer' ? (
            <CustomerLineItemsTable items={lineItems} currency="USD" />
          ) : (
            <ManufacturerLineItemsTable items={lineItems} currency="USD" />
          )}
        </div>
      </div>

      {/* ── Sidebar ── */}
      <div className="w-full shrink-0 border-t bg-muted/5 lg:w-80 lg:border-l lg:border-t-0">
        <div className="sticky top-0 overflow-y-auto p-4 sm:p-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Quote Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Company */}
              {company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{company.name}</span>
                </div>
              )}

              {/* Type badge */}
              <div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeBadge.className}`}
                >
                  {typeBadge.label}
                </span>
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-2 text-sm">
                {(quoteType === 'customer' || quoteType === 'both') && (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Cost Subtotal</span>
                      <span>{fmt(costSubtotal)}</span>
                    </div>
                    {editableMultiplier !== 1.0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span className="flex items-center gap-1">
                          Markup
                          <MultiplierBadge multiplier={editableMultiplier} />
                        </span>
                        <span>+{fmt(subtotal - costSubtotal)}</span>
                      </div>
                    )}
                  </>
                )}
                {quoteType === 'manufacturer' && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Cost Subtotal</span>
                    <span>{fmt(costSubtotal)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-semibold text-base">
                  <span>Total</span>
                  <span>{fmt(quoteType === 'manufacturer' ? costSubtotal : total)}</span>
                </div>
              </div>

              <Separator />

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Notes
                </label>
                <Textarea
                  placeholder="Add any notes or special instructions..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                />
              </div>

              <Separator />

              {/* Save */}
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || lineItems.length === 0}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Quote
              </Button>

              {/* Download buttons */}
              <div className="space-y-2">
                {(quoteType === 'customer' || quoteType === 'both') && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleDownloadCustomer}
                    disabled={isDownloadingCustomer || lineItems.length === 0}
                  >
                    {isDownloadingCustomer ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Customer Quote PDF
                  </Button>
                )}

                {(quoteType === 'manufacturer' || quoteType === 'both') && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleDownloadManufacturer}
                    disabled={isDownloadingManufacturer || lineItems.length === 0}
                  >
                    {isDownloadingManufacturer ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Manufacturer RFQ PDF
                  </Button>
                )}

                {quoteType === 'both' && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleDownloadBoth}
                    disabled={
                      isDownloadingCustomer ||
                      isDownloadingManufacturer ||
                      lineItems.length === 0
                    }
                  >
                    {isDownloadingCustomer || isDownloadingManufacturer ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Download Both PDFs
                  </Button>
                )}
              </div>

              {/* Item count */}
              <p className="text-center text-xs text-muted-foreground">
                {lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
