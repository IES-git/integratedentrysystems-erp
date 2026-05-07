import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { EstimateItem, ItemTypeRegistryEntry } from '@/types';
import { getItemTypeRegistry } from '@/lib/item-fields-api';
import { createManualItem } from '@/lib/estimates-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: EstimateItem) => void;
  /** Pre-select an item type slug (e.g. from a category-specific "New Item" button). */
  defaultItemTypeSlug?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
  defaultItemTypeSlug,
}: CreateItemDialogProps) {
  const { toast } = useToast();

  const [itemName, setItemName] = useState('');
  const [canonicalCode, setCanonicalCode] = useState('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [selectedTypeSlug, setSelectedTypeSlug] = useState(defaultItemTypeSlug ?? '');
  const [itemTypes, setItemTypes] = useState<ItemTypeRegistryEntry[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset and load registry when dialog opens
  useEffect(() => {
    if (!open) return;
    setItemName('');
    setCanonicalCode('');
    setCodeManuallyEdited(false);
    setSelectedTypeSlug(defaultItemTypeSlug ?? '');

    setTypesLoading(true);
    getItemTypeRegistry()
      .then(setItemTypes)
      .catch(() => {
        toast({ title: 'Error', description: 'Failed to load item types', variant: 'destructive' });
      })
      .finally(() => setTypesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleNameChange(value: string) {
    setItemName(value);
    if (!codeManuallyEdited) {
      setCanonicalCode(slugify(value));
    }
  }

  async function handleSubmit() {
    if (!itemName.trim() || !selectedTypeSlug || !canonicalCode.trim()) return;

    setSubmitting(true);
    try {
      const created = await createManualItem({
        itemLabel: itemName.trim(),
        canonicalCode: canonicalCode.trim(),
        itemTypeSlug: selectedTypeSlug,
        fieldValues: [],
      });

      onCreated(created);
      onOpenChange(false);
      toast({
        title: 'Item created',
        description: `"${created.itemLabel}" has been added. Expand it below to fill in field values.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create item',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = itemName.trim() !== '' && selectedTypeSlug !== '' && canonicalCode.trim() !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">New Item</DialogTitle>
          <DialogDescription>
            Give the item a name and select its type. You can fill in field values after it's
            created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="item-name">Item Name</Label>
            <Input
              id="item-name"
              placeholder="e.g. Hollow Metal Door 3-0 x 7-0"
              value={itemName}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void handleSubmit();
              }}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="canonical-code">Canonical Code</Label>
            <Input
              id="canonical-code"
              placeholder="auto-generated from name"
              value={canonicalCode}
              onChange={(e) => {
                setCanonicalCode(e.target.value);
                setCodeManuallyEdited(true);
              }}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Unique machine-readable ID. Auto-filled from the item name.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-type">Item Type</Label>
            {typesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading item types…
              </div>
            ) : (
              <Select value={selectedTypeSlug} onValueChange={setSelectedTypeSlug}>
                <SelectTrigger id="item-type">
                  <SelectValue placeholder="Select a type…" />
                </SelectTrigger>
                <SelectContent>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.name}
                      {t.description && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          — {t.description}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
