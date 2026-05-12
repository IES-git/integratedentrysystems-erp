import { useState, useEffect } from 'react';
import {
  DoorOpen,
  Square,
  Wrench,
  Package,
  Layers,
  Box,
  Tag,
  Plus,
  ArrowRight,
  Trash2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { getItemTypeRegistry, deleteItemType } from '@/lib/item-fields-api';
import type { ItemTypeRegistryEntry } from '@/types';
import { AddItemTypeDialog } from './AddItemTypeDialog';

// ---------------------------------------------------------------------------
// Icon resolver — maps stored lucide icon names to components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  DoorOpen,
  Square,
  Wrench,
  Package,
  Layers,
  Box,
  Tag,
};

function CategoryIcon({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  const Icon = name ? (ICON_MAP[name] ?? Package) : Package;
  return <Icon className={className} />;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CategoryDashboardProps {
  onSelectCategory: (slug: string, name: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CategoryDashboard({ onSelectCategory }: CategoryDashboardProps) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<ItemTypeRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ItemTypeRegistryEntry | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  async function load() {
    try {
      const data = await getItemTypeRegistry();
      setEntries(data);
    } catch (err) {
      toast({
        title: 'Failed to load item types',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirmDelete() {
    // Capture immediately — dialog auto-close may null out deleteTarget before the await resolves
    const target = deleteTarget;
    if (!target) return;
    setDeletingSlug(target.slug);
    try {
      await deleteItemType(target.slug);
      // Reload from DB to ensure UI reflects the actual state
      const fresh = await getItemTypeRegistry();
      setEntries(fresh);
      toast({ title: `"${target.name}" deleted` });
    } catch (err) {
      toast({
        title: 'Failed to delete item type',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setDeletingSlug(null);
      setDeleteTarget(null);
    }
  }

  function handleCreated(entry: ItemTypeRegistryEntry) {
    setEntries((prev) => [...prev, entry]);
    setAddDialogOpen(false);
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Item Fields</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage field options for each item category. Select a category to configure its fields.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Item Type
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading categories…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {entries.filter((e) => e.parentSlug === null).map((entry) => (
              <div
                key={entry.slug}
                className="group relative flex flex-col gap-4 rounded-2xl border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all cursor-pointer"
                onClick={() => onSelectCategory(entry.slug, entry.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectCategory(entry.slug, entry.name); }}
              >
                <div className="flex items-start justify-between">
                  <div className="rounded-xl bg-primary/10 p-3">
                    <CategoryIcon name={entry.icon} className="h-6 w-6 text-primary" />
                  </div>

                  {/* Right side: delete (non-system only) + arrow */}
                  <div className="flex items-center gap-1">
                    {!entry.isSystem && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry); }}
                        disabled={deletingSlug === entry.slug}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                        aria-label={`Delete ${entry.name}`}
                      >
                        {deletingSlug === entry.slug ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-semibold">{entry.name}</h2>
                  {entry.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                      {entry.description}
                    </p>
                  )}
                </div>

                <div className="mt-auto">
                  <Button size="sm" className="gap-1.5 w-full pointer-events-none" tabIndex={-1}>
                    Configure Fields
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {entries.filter((e) => e.parentSlug === null).length === 0 && !loading && (
              <div className="col-span-full flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Package className="h-10 w-10 opacity-30" />
                <p className="text-sm">No item types yet. Add one to get started.</p>
              </div>
            )}
          </div>
        )}

        <AddItemTypeDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onCreated={handleCreated}
        />
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item type?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its configured
              base fields. Items of this type that already exist will not be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingSlug}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmDelete()}
              disabled={!!deletingSlug}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingSlug ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
