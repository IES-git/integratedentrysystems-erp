/**
 * ExceptionReviewPanel — surfaces pricing lookups that failed during Refresh
 * Prices. For each, the user can ask the agent for a closest-match suggestion,
 * then approve (writes the price) or dismiss. Propose-only: the agent never
 * writes prices; approval is an explicit human action.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Sparkles, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import {
  listPendingExceptionsForEstimate,
  approveExceptionWithPrice,
  rejectException,
  attachSuggestion,
} from '@/lib/pricing-exceptions-api';
import { explainPricingException, type PricingExceptionContext } from '@/lib/gemini-api';
import type { PricingException } from '@/types';

interface ExceptionReviewPanelProps {
  estimateId: string;
  onResolved: () => void | Promise<void>;
}

interface RowWorkState {
  loadingSuggestion?: boolean;
  reason?: string;
  priceInput?: string;
  saving?: boolean;
}

async function fetchCellPrice(rowId: string, columnId: string): Promise<number | null> {
  const { data } = await supabase
    .from('pricing_cells')
    .select('price')
    .eq('pricing_row_id', rowId)
    .eq('pricing_column_id', columnId)
    .maybeSingle();
  return (data?.price as number | null) ?? null;
}

export function ExceptionReviewPanel({ estimateId, onResolved }: ExceptionReviewPanelProps) {
  const [exceptions, setExceptions] = useState<PricingException[]>([]);
  const [loading, setLoading] = useState(true);
  const [work, setWork] = useState<Record<string, RowWorkState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPendingExceptionsForEstimate(estimateId);
      setExceptions(data);
    } catch (err) {
      console.error('Failed to load pricing exceptions:', err);
    } finally {
      setLoading(false);
    }
  }, [estimateId]);

  useEffect(() => { void load(); }, [load]);

  const setRowWork = (id: string, patch: RowWorkState) =>
    setWork((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const getSuggestion = async (exc: PricingException) => {
    setRowWork(exc.id, { loadingSuggestion: true });
    try {
      const ctx = exc.context as Partial<PricingExceptionContext> & {
        availableRows?: { id: string; label: string }[];
        availableColumns?: { id: string; label: string }[];
        fields?: { key: string; value: string }[];
        warning?: string | null;
        itemType?: string | null;
      };
      const result = await explainPricingException({
        itemLabel: exc.itemLabel,
        itemType: ctx.itemType ?? null,
        status: exc.lookupStatus,
        fields: ctx.fields ?? [],
        availableRows: ctx.availableRows,
        availableColumns: ctx.availableColumns,
        warning: ctx.warning ?? undefined,
      });

      let suggestedPrice: number | null = null;
      if (result.kind === 'closest_cell' && result.suggestedRowId && result.suggestedColumnId) {
        suggestedPrice = await fetchCellPrice(result.suggestedRowId, result.suggestedColumnId);
      }

      await attachSuggestion(
        exc.id,
        { ...result, suggestedPrice },
        result.reason,
      );
      setRowWork(exc.id, {
        loadingSuggestion: false,
        reason: result.reason,
        priceInput: suggestedPrice != null ? String(suggestedPrice) : '',
      });
    } catch (err) {
      setRowWork(exc.id, { loadingSuggestion: false, reason: `Agent error: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const approve = async (exc: PricingException) => {
    const raw = work[exc.id]?.priceInput ?? '';
    const price = parseFloat(raw);
    if (isNaN(price) || !exc.estimateItemId) return;
    setRowWork(exc.id, { saving: true });
    try {
      await approveExceptionWithPrice(exc.id, exc.estimateItemId, price);
      await load();
      await onResolved();
    } finally {
      setRowWork(exc.id, { saving: false });
    }
  };

  const dismiss = async (exc: PricingException) => {
    setRowWork(exc.id, { saving: true });
    try {
      await rejectException(exc.id);
      await load();
    } finally {
      setRowWork(exc.id, { saving: false });
    }
  };

  if (loading) return null;
  if (exceptions.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-900">
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Pricing exceptions ({exceptions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {exceptions.map((exc) => {
          const w = work[exc.id] ?? {};
          return (
            <div key={exc.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{exc.itemLabel}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{exc.lookupStatus.replace(/_/g, ' ')}</Badge>
              </div>
              {typeof exc.context?.warning === 'string' && exc.context.warning && (
                <p className="mt-1 text-xs text-muted-foreground">{exc.context.warning as string}</p>
              )}

              {w.reason && (
                <div className="mt-2 rounded bg-muted/50 px-2 py-1.5 text-xs flex items-start gap-1.5">
                  <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                  <span>{w.reason}</span>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => getSuggestion(exc)} disabled={w.loadingSuggestion}>
                  {w.loadingSuggestion ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Suggest fix
                </Button>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input
                    className="h-8 w-24"
                    placeholder="price"
                    value={w.priceInput ?? ''}
                    onChange={(e) => setRowWork(exc.id, { priceInput: e.target.value })}
                  />
                </div>
                <Button size="sm" onClick={() => approve(exc)} disabled={w.saving || !(w.priceInput ?? '').trim()}>
                  {w.saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  Approve price
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss(exc)} disabled={w.saving}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
