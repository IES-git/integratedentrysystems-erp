import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Building2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Company } from '@/types';
import {
  listManufacturerCompanies,
  attachPricingTableVendor,
  detachPricingTableVendor,
} from '@/lib/pricing-api';
import { useToast } from '@/hooks/use-toast';

export interface VendorChip {
  id: string;
  name: string;
}

interface VendorMultiSelectProps {
  tableId: string;
  vendors: VendorChip[];
  onVendorsChange: (vendors: VendorChip[]) => void;
}

export function VendorMultiSelect({ tableId, vendors, onVendorsChange }: VendorMultiSelectProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const loadCompanies = useCallback(async () => {
    if (companies.length > 0) return;
    setLoadingCompanies(true);
    try {
      setCompanies(await listManufacturerCompanies());
    } catch {
      toast({ title: 'Error', description: 'Failed to load manufacturers', variant: 'destructive' });
    } finally {
      setLoadingCompanies(false);
    }
  }, [companies.length, toast]);

  useEffect(() => {
    if (open) void loadCompanies();
  }, [open, loadCompanies]);

  const attachedIds = new Set(vendors.map((v) => v.id));
  const filtered = companies.filter(
    (c) =>
      !attachedIds.has(c.id) &&
      c.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAttach(company: Company) {
    const prev = vendors;
    onVendorsChange([...vendors, { id: company.id, name: company.name }]);
    setOpen(false);
    setSearch('');
    try {
      await attachPricingTableVendor(tableId, company.id);
    } catch {
      onVendorsChange(prev);
      toast({ title: 'Error', description: 'Failed to attach vendor', variant: 'destructive' });
    }
  }

  async function handleDetach(vendorId: string) {
    const prev = vendors;
    onVendorsChange(vendors.filter((v) => v.id !== vendorId));
    try {
      await detachPricingTableVendor(tableId, vendorId);
    } catch {
      onVendorsChange(prev);
      toast({ title: 'Error', description: 'Failed to remove vendor', variant: 'destructive' });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {vendors.length === 0 && (
        <span className="text-sm text-muted-foreground italic">
          No vendors attached — this pricing applies generically.
        </span>
      )}

      {vendors.map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center gap-1 rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-medium"
        >
          <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
          {v.name}
          <button
            onClick={() => void handleDetach(v.id)}
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
            title={`Remove ${v.name}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 text-xs"
            title="Add another manufacturer to this pricing table"
          >
            <Plus className="h-3 w-3" />
            Add manufacturer
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search manufacturers…"
              className="h-7 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {loadingCompanies && (
              <p className="px-3 py-2 text-xs text-muted-foreground animate-pulse">Loading…</p>
            )}
            {!loadingCompanies && filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">
                {companies.length > 0 && attachedIds.size === companies.length
                  ? 'All manufacturers already attached'
                  : 'No matches'}
              </p>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => void handleAttach(c)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {c.name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
