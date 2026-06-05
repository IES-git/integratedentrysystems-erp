/**
 * LivePriceBadge — debounced read-only price for an in-progress builder item.
 * Resolves against the pricing engine as the user picks specs/vendor, surfacing
 * a price or the reason it can't be priced yet. Reports the resolved unit price
 * to the parent via onResolved so it can compute a running opening subtotal.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, DollarSign, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { priceLocalItem, type LivePriceInput } from '@/lib/cpq/live-pricing';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

interface LivePriceBadgeProps extends LivePriceInput {
  /** Notifies the parent of the resolved unit price (null when unpriced). */
  onResolved?: (unitPrice: number | null) => void;
  debounceMs?: number;
}

export function LivePriceBadge(props: LivePriceBadgeProps) {
  const { onResolved, debounceMs = 500, ...input } = props;
  const [loading, setLoading] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  // Re-resolve whenever the meaningful inputs change.
  const depKey = JSON.stringify({
    c: input.category,
    code: input.canonicalCode,
    m: input.manufacturerId,
    sub: input.subcategory,
    f: input.fields,
  });

  useEffect(() => {
    if (!input.canonicalCode || !input.category) {
      setPrice(null);
      setStatus('');
      onResolvedRef.current?.(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const result = await priceLocalItem(input);
        if (cancelled) return;
        if (result.status === 'matched' && result.totalUnitPrice !== null) {
          setPrice(result.totalUnitPrice);
          setStatus('matched');
          onResolvedRef.current?.(result.totalUnitPrice);
        } else {
          setPrice(null);
          setStatus(result.status);
          onResolvedRef.current?.(null);
        }
      } catch {
        if (!cancelled) { setPrice(null); setStatus('error'); onResolvedRef.current?.(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, debounceMs]);

  if (loading) {
    return <Badge variant="outline" className="gap-1 text-[10px]"><Loader2 className="h-2.5 w-2.5 animate-spin" />pricing…</Badge>;
  }
  if (price !== null) {
    return <Badge className="gap-1 bg-green-600 text-[10px] hover:bg-green-600"><DollarSign className="h-2.5 w-2.5" />{fmt(price)}</Badge>;
  }
  if (status && status !== '') {
    return <Badge variant="secondary" className="gap-1 text-[10px] text-amber-700"><AlertTriangle className="h-2.5 w-2.5" />{status.replace(/_/g, ' ')}</Badge>;
  }
  return null;
}
