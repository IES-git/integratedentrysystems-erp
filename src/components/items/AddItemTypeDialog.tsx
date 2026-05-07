import { useState } from 'react';
import {
  DoorOpen,
  Square,
  Wrench,
  Package,
  Layers,
  Box,
  Tag,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { createItemType } from '@/lib/item-fields-api';
import type { ItemTypeRegistryEntry } from '@/types';

// ---------------------------------------------------------------------------
// Icon picker options
// ---------------------------------------------------------------------------

const ICON_OPTIONS: Array<{
  name: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { name: 'Package', label: 'Package', Icon: Package },
  { name: 'DoorOpen', label: 'Door', Icon: DoorOpen },
  { name: 'Square', label: 'Frame', Icon: Square },
  { name: 'Wrench', label: 'Wrench', Icon: Wrench },
  { name: 'Layers', label: 'Layers', Icon: Layers },
  { name: 'Box', label: 'Box', Icon: Box },
  { name: 'Tag', label: 'Tag', Icon: Tag },
];

// ---------------------------------------------------------------------------
// Slug helpers
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

interface AddItemTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (entry: ItemTypeRegistryEntry) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddItemTypeDialog({ open, onOpenChange, onCreated }: AddItemTypeDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>('Package');
  const [saving, setSaving] = useState(false);

  const slug = slugify(name);
  const isValid = slug.length > 0;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('');
      setDescription('');
      setSelectedIcon('Package');
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const entry = await createItemType({
        name: name.trim(),
        slug,
        icon: selectedIcon,
        description: description.trim() || null,
      });
      toast({ title: `"${entry.name}" item type created` });
      onCreated(entry);
      handleOpenChange(false);
    } catch (err) {
      toast({
        title: 'Failed to create item type',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Item Type</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-type-name">Name</Label>
            <Input
              id="item-type-name"
              placeholder="e.g. Storefronts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
            {slug && (
              <p className="text-xs text-muted-foreground">
                Slug: <span className="font-mono">{slug}</span>
              </p>
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-type-desc">
              Description{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="item-type-desc"
              placeholder="e.g. Storefront systems and their field definitions"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Icon picker */}
          <div className="flex flex-col gap-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map(({ name: iconName, label, Icon }) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setSelectedIcon(iconName)}
                  title={label}
                  className={`flex items-center justify-center rounded-xl p-3 border transition-all ${
                    selectedIcon === iconName
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Creating…
                </>
              ) : (
                'Create Item Type'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
