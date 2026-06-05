/**
 * CompareVendorsPanel — multi-vendor what-if for one opening (CPQ Phase 5).
 *
 * Prices the opening under each manufacturer (and a custom mixed-vendor
 * selection) read-only, shows side-by-side totals, and lets the user apply a
 * scenario (writes manufacturer_id per category, then re-prices).
 */

import { useState } from 'react';
import { GitCompare, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { normalizeCategoryKey } from '@/lib/pricing-lookup';
import {
  compareOpeningVendors, applyVendorScenario,
  type VendorScenario, type ScenarioResult,
} from '@/lib/cpq/service';
import type { Company, EstimateItem, EstimateOpeningWithItems, VendorOverride } from '@/types';

const CATEGORY_LABELS: Record<string, string> = {
  doors: 'Doors',
  frames: 'Frames',
  panels: 'Panels',
  lites_louvers_glass: 'Lites / Louvers / Glass',
  hardware: 'Hardware',
};

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function allItems(opening: EstimateOpeningWithItems): EstimateItem[] {
  return [
    ...opening.items,
    ...opening.items.flatMap((i) => i.hardware ?? []),
    ...(opening.hardware ?? []),
  ];
}

interface CompareVendorsPanelProps {
  opening: EstimateOpeningWithItems;
  manufacturers: Company[];
  onApplied: () => void | Promise<void>;
}

export function CompareVendorsPanel({ opening, manufacturers, onApplied }: CompareVendorsPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [customByCategory, setCustomByCategory] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

  // Distinct normalized categories present in the opening.
  const presentCategories = [...new Set(allItems(opening).map((i) => normalizeCategoryKey(i.itemType, i.subcategory)))]
    .filter((c) => c !== 'unknown');

  const runComparison = async () => {
    setComparing(true);
    try {
      const scenarios: VendorScenario[] = [
        { id: 'current', label: 'Current', override: {} },
        ...manufacturers.map((m) => ({
          id: m.id,
          label: m.name,
          override: { byCategory: Object.fromEntries(presentCategories.map((c) => [c, m.id])) } as VendorOverride,
        })),
      ];
      // Include the custom mixed scenario if the user has set any category vendor.
      if (Object.keys(customByCategory).length > 0) {
        scenarios.push({ id: 'custom', label: 'Custom (mixed)', override: { byCategory: { ...customByCategory } } });
      }
      const res = await compareOpeningVendors(opening, scenarios);
      // Sort priced scenarios by total ascending, keep Current first.
      res.sort((a, b) => {
        if (a.scenarioId === 'current') return -1;
        if (b.scenarioId === 'current') return 1;
        return a.total - b.total;
      });
      setResults(res);
    } catch (err) {
      toast({ title: 'Comparison failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setComparing(false);
    }
  };

  const applyScenario = async (override: VendorOverride, label: string) => {
    setApplying(true);
    try {
      const updated = await applyVendorScenario(opening, override);
      toast({ title: 'Vendor scenario applied', description: `${label}: ${updated} item${updated !== 1 ? 's' : ''} reassigned. Re-pricing…` });
      setOpen(false);
      await onApplied();
    } catch (err) {
      toast({ title: 'Apply failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const applySingleVendor = (vendorId: string, label: string) =>
    applyScenario({ byCategory: Object.fromEntries(presentCategories.map((c) => [c, vendorId])) }, label);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <GitCompare className="h-3.5 w-3.5" /> Compare vendors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare vendors — {opening.name}</DialogTitle>
        </DialogHeader>

        {manufacturers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No manufacturers available.</p>
        ) : (
          <div className="space-y-4">
            {/* Custom mixed-vendor selection */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Custom mixed-vendor scenario (per category)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {presentCategories.map((cat) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="w-32 text-xs">{CATEGORY_LABELS[cat] ?? cat}</span>
                    <Select
                      value={customByCategory[cat] ?? ''}
                      onValueChange={(v) => setCustomByCategory((p) => ({ ...p, [cat]: v }))}
                    >
                      <SelectTrigger className="h-8"><SelectValue placeholder="vendor" /></SelectTrigger>
                      <SelectContent>
                        {manufacturers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={runComparison} disabled={comparing} size="sm">
              {comparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitCompare className="mr-2 h-4 w-4" />}
              Compare totals
            </Button>

            {results.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scenario</TableHead>
                    <TableHead className="text-right">Opening total</TableHead>
                    <TableHead className="text-right">Unpriced</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.scenarioId}>
                      <TableCell className="font-medium">
                        {r.label}
                        {r.scenarioId === 'current' && <Badge variant="outline" className="ml-2 text-[10px]">current</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.total)}</TableCell>
                      <TableCell className="text-right">
                        {r.unpricedCount > 0
                          ? <Badge variant="secondary" className="text-[10px]">{r.unpricedCount}</Badge>
                          : <span className="text-xs text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.scenarioId !== 'current' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={applying}
                            onClick={() =>
                              r.scenarioId === 'custom'
                                ? applyScenario({ byCategory: { ...customByCategory } }, 'Custom')
                                : applySingleVendor(r.scenarioId, r.label)
                            }
                          >
                            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-1 h-3.5 w-3.5" />Apply</>}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
