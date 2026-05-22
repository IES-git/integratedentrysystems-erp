import { useState, useEffect, useCallback } from 'react';
import { Layers, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleGridEditor } from './SimpleGridEditor';
import { createPricingTable, addPricingTableItem } from '@/lib/pricing-api';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface LitesLouversGlassItemEditorProps {
  /** canonical_code of the item — used as series_value on the pricing table */
  canonicalCode: string;
  /** Human-readable label for display (fetched if not provided) */
  itemLabel?: string;
  onBack: () => void;
}

/**
 * Wrapper that resolves a lites/louvers/glass item's canonical_code to its
 * pricing table id, then renders SimpleGridEditor. If no table exists yet,
 * it shows a prompt to create one.
 */
export function LitesLouversGlassItemEditor({
  canonicalCode,
  itemLabel,
  onBack,
}: LitesLouversGlassItemEditorProps) {
  const { toast } = useToast();
  const [tableId, setTableId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [creating, setCreating] = useState(false);

  const resolveTable = useCallback(async () => {
    const { data, error } = await supabase
      .from('pricing_tables')
      .select('id')
      .eq('category', 'lites_louvers_glass')
      .eq('series_value', canonicalCode)
      .maybeSingle();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setTableId(null);
      return;
    }
    setTableId(data?.id ?? null);
  }, [canonicalCode, toast]);

  useEffect(() => {
    void resolveTable();
  }, [resolveTable]);

  async function handleCreate() {
    setCreating(true);
    try {
      const label = itemLabel ?? canonicalCode;
      const table = await createPricingTable('lites_louvers_glass', canonicalCode, label);
      // Auto-tag this item to the new table so it appears in the grouped list
      await addPricingTableItem(table.id, canonicalCode, 'lites_louvers_glass');
      setTableId(table.id);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create pricing table',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }

  // Loading state
  if (tableId === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  // Table exists — render the grid editor
  if (tableId !== null) {
    return <SimpleGridEditor tableId={tableId} onBack={onBack} />;
  }

  // No table yet — show create prompt
  const displayLabel = itemLabel ?? canonicalCode;
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="rounded-2xl bg-primary/10 p-4">
        <Layers className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">{displayLabel}</h2>
        <p className="text-muted-foreground text-sm mt-1">
          No pricing table exists for this item yet.
        </p>
      </div>
      <Button onClick={() => void handleCreate()} disabled={creating} className="gap-1.5 mt-2">
        <Plus className="h-4 w-4" />
        {creating ? 'Creating…' : 'Create Pricing Table'}
      </Button>
      <Button variant="ghost" onClick={onBack} disabled={creating} className="text-muted-foreground">
        Go back
      </Button>
    </div>
  );
}
