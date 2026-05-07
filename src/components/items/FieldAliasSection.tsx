import { useState, useCallback } from 'react';
import {
  Building2,
  Plus,
  X,
  ArrowLeftRight,
  RefreshCw,
  CheckCircle2,
  Clock,
  Check,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import type { ManufacturerFieldLabel, ItemTypeManufacturerFieldLabel, FieldDefinition, Company } from '@/types';
import {
  getManufacturerFieldLabels,
  upsertManufacturerFieldLabel,
  deleteManufacturerFieldLabel,
  updateManufacturerFieldLabelStatus,
  moveManufacturerFieldLabel,
  getFieldDefinitions,
} from '@/lib/estimates-api';
import {
  getItemFieldAliases,
  addItemFieldAlias,
  updateItemFieldAliasStatus,
  deleteItemFieldAlias,
} from '@/lib/item-fields-api';
import { listCompanies, createCompany } from '@/lib/companies-api';

type AliasRow = ManufacturerFieldLabel | ItemTypeManufacturerFieldLabel;

function isPerItemAlias(alias: AliasRow): alias is ItemTypeManufacturerFieldLabel {
  return 'isRemoved' in alias;
}

interface FieldAliasSectionProps {
  /** The field definition whose aliases are managed. */
  fieldDefinitionId: string;
  fieldLabel: string;
  /** When `{ canonicalCode }`, reads/writes go through per-item tables. Defaults to `'global'`. */
  dataSource?: 'global' | { canonicalCode: string };
}

export function FieldAliasSection({ fieldDefinitionId, fieldLabel, dataSource = 'global' }: FieldAliasSectionProps) {
  const { toast } = useToast();
  const canonicalCode = typeof dataSource === 'object' ? dataSource.canonicalCode : null;
  const isPerItem = canonicalCode !== null;

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Shared resources loaded lazily when a dialog opens ───────────────────
  const [manufacturers, setManufacturers] = useState<Pick<Company, 'id' | 'name'>[]>([]);
  const [allFieldDefs, setAllFieldDefs] = useState<FieldDefinition[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  // ── Add alias dialog ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [newAliasManufacturerId, setNewAliasManufacturerId] = useState('');
  const [newAliasLabel, setNewAliasLabel] = useState('');
  const [addAliasLoading, setAddAliasLoading] = useState(false);
  const [showNewManufacturer, setShowNewManufacturer] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [newManufacturerLoading, setNewManufacturerLoading] = useState(false);

  // ── Move alias dialog ─────────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<ManufacturerFieldLabel | null>(null);
  const [moveFieldDefId, setMoveFieldDefId] = useState('');
  const [moveLoading, setMoveLoading] = useState(false);

  // ── Load aliases (called when panel expands) ──────────────────────────────
  const loadAliases = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      let data: AliasRow[];
      if (isPerItem && canonicalCode) {
        data = await getItemFieldAliases(canonicalCode, fieldDefinitionId);
      } else {
        data = await getManufacturerFieldLabels(fieldDefinitionId);
      }
      setAliases(data);
      setLoaded(true);
    } catch {
      toast({ title: 'Error', description: 'Failed to load aliases', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [canonicalCode, fieldDefinitionId, isPerItem, loaded, toast]);

  // Expose load function so parent can call on expand
  // We run it inside an effect-like pattern: parent calls loadAliases() directly.

  // ── Load shared resources (manufacturers + all field defs) ────────────────
  async function loadResources() {
    if (manufacturers.length > 0 && allFieldDefs.length > 0) return;
    setResourcesLoading(true);
    try {
      const [companies, defs] = await Promise.all([
        listCompanies(),
        getFieldDefinitions(),
      ]);
      setManufacturers(
        companies
          .filter((c) => c.companyType === 'manufacturer' || c.companyType === 'both')
          .map((c) => ({ id: c.id, name: c.name }))
      );
      setAllFieldDefs(defs);
    } catch {
      toast({ title: 'Error', description: 'Failed to load resources', variant: 'destructive' });
    } finally {
      setResourcesLoading(false);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleApprove(alias: AliasRow) {
    const key = `alias-${alias.id}`;
    try {
      setActionLoading(key);
      let updated: AliasRow;
      if (isPerItem && isPerItemAlias(alias)) {
        await updateItemFieldAliasStatus(alias.id, 'approved');
        updated = { ...alias, status: 'approved' as const };
      } else {
        updated = await updateManufacturerFieldLabelStatus(alias.id, 'approved');
      }
      setAliases((prev) => prev.map((a) => (a.id === alias.id ? updated : a)));
      toast({ title: 'Alias approved', description: `"${alias.manufacturerFieldLabel}" is now approved.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to approve alias', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(alias: AliasRow) {
    const key = `alias-${alias.id}`;
    try {
      setActionLoading(key);
      if (isPerItem && canonicalCode) {
        const isGlobal = !isPerItemAlias(alias);
        await deleteItemFieldAlias(alias.id, {
          isGlobalAlias: isGlobal,
          canonicalCode,
          fieldDefinitionId,
          manufacturerId: alias.manufacturerId,
          manufacturerFieldLabel: alias.manufacturerFieldLabel,
        });
      } else {
        await deleteManufacturerFieldLabel(alias.id);
      }
      setAliases((prev) => prev.filter((a) => a.id !== alias.id));
      toast({ title: 'Alias removed', description: `"${alias.manufacturerFieldLabel}" has been removed.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to remove alias', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  }

  function openMove(alias: AliasRow) {
    setMoveTarget(alias as ManufacturerFieldLabel);
    setMoveFieldDefId('');
    void loadResources();
  }

  async function handleMove() {
    if (!moveTarget || !moveFieldDefId) return;
    try {
      setMoveLoading(true);
      const updated = await moveManufacturerFieldLabel(moveTarget.id, moveFieldDefId);
      setAliases((prev) => prev.filter((a) => a.id !== updated.id));
      toast({ title: 'Alias moved', description: `"${moveTarget.manufacturerFieldLabel}" reassigned to new field.` });
      setMoveTarget(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to move alias', variant: 'destructive' });
    } finally {
      setMoveLoading(false);
    }
  }

  function openAdd() {
    setAddOpen(true);
    setNewAliasManufacturerId('');
    setNewAliasLabel('');
    setShowNewManufacturer(false);
    setNewManufacturerName('');
    void loadResources();
  }

  async function handleCreateManufacturer() {
    if (!newManufacturerName.trim()) return;
    try {
      setNewManufacturerLoading(true);
      const created = await createCompany({ name: newManufacturerName.trim(), companyType: 'manufacturer' });
      setManufacturers((prev) => [...prev, { id: created.id, name: created.name }]);
      setNewAliasManufacturerId(created.id);
      setShowNewManufacturer(false);
      setNewManufacturerName('');
      toast({ title: 'Manufacturer created', description: `"${created.name}" has been added.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to create manufacturer', variant: 'destructive' });
    } finally {
      setNewManufacturerLoading(false);
    }
  }

  async function handleAddAlias() {
    if (!newAliasLabel.trim()) return;
    try {
      setAddAliasLoading(true);
      let saved: AliasRow;
      if (isPerItem && canonicalCode) {
        saved = await addItemFieldAlias({
          canonicalCode,
          fieldDefinitionId,
          manufacturerId: newAliasManufacturerId || null,
          manufacturerFieldLabel: newAliasLabel.trim(),
        });
      } else {
        saved = await upsertManufacturerFieldLabel({
          fieldDefinitionId,
          manufacturerId: newAliasManufacturerId || null,
          manufacturerFieldLabel: newAliasLabel.trim(),
        });
      }
      setAliases((prev) => {
        const alreadyExists = prev.some((a) => a.id === saved.id);
        return alreadyExists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved];
      });
      toast({ title: 'Alias added', description: `"${saved.manufacturerFieldLabel}" mapped to this field.` });
      setAddOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to add alias', variant: 'destructive' });
    } finally {
      setAddAliasLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Inline alias section ──────────────────────────────────────────── */}
      <div className="border-b pb-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Building2 className="h-3 w-3" />
            Manufacturer Aliases
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs gap-1 px-2"
            onClick={async () => {
              await loadAliases();
              openAdd();
            }}
          >
            <Plus className="h-3 w-3" />
            Add Alias
          </Button>
        </div>

        {/* Trigger lazy load on first render */}
        <AliasLoader onLoad={loadAliases} />

        {loading ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading aliases…
          </div>
        ) : aliases.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-0.5">
            No aliases yet.{' '}
            <button
              className="underline underline-offset-2 hover:text-foreground transition-colors"
              onClick={openAdd}
            >
              Add one
            </button>{' '}
            to map how manufacturers refer to this field.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {aliases.map((alias) => {
              const isPending = alias.status === 'pending';
              const isActioning = actionLoading === `alias-${alias.id}`;
              return (
                <div
                  key={alias.id}
                  className={[
                    'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                    isPending
                      ? 'border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20'
                      : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/20',
                  ].join(' ')}
                >
                  {isPending ? (
                    <Clock className="h-3 w-3 shrink-0 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                  )}
                  <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span
                    className={[
                      'font-medium',
                      isPending
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-300',
                    ].join(' ')}
                  >
                    {alias.manufacturer?.name ?? 'Any Manufacturer'}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="flex items-center gap-1">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    <span
                      className={
                        isPending
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-emerald-700 dark:text-emerald-300'
                      }
                    >
                      {alias.manufacturerFieldLabel}
                    </span>
                  </span>

                  <div className="ml-1 flex items-center gap-0.5">
                    {isPending && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-emerald-500/20 hover:text-emerald-600 transition-colors"
                            onClick={() => void handleApprove(alias)}
                            disabled={isActioning}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Approve alias</TooltipContent>
                      </Tooltip>
                    )}

                    {!isPerItem && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-blue-500/20 hover:text-blue-600 transition-colors"
                            onClick={() => openMove(alias)}
                            disabled={isActioning}
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Move to different field</TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          onClick={() => void handleDelete(alias)}
                          disabled={isActioning}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Remove alias</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add Alias Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Add Manufacturer Alias</DialogTitle>
            <DialogDescription>
              Map how a manufacturer refers to the master field{' '}
              <span className="font-semibold">&ldquo;{fieldLabel}&rdquo;</span>.{' '}
              This helps the AI normalize manufacturer terminology during extraction.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="alias-mfr">Manufacturer</Label>
              {resourcesLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              ) : (
                <Select
                  value={newAliasManufacturerId || '__none__'}
                  onValueChange={(v) => {
                    setNewAliasManufacturerId(v === '__none__' ? '' : v);
                    setShowNewManufacturer(false);
                  }}
                >
                  <SelectTrigger id="alias-mfr">
                    <SelectValue placeholder="Any manufacturer (generic alias)…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any manufacturer (generic alias)</SelectItem>
                    {manufacturers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {!showNewManufacturer ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => setShowNewManufacturer(true)}
                >
                  <Plus className="h-3 w-3" />
                  Add a new manufacturer
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <Input
                    autoFocus
                    placeholder="Manufacturer name…"
                    value={newManufacturerName}
                    onChange={(e) => setNewManufacturerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateManufacturer();
                      if (e.key === 'Escape') {
                        setShowNewManufacturer(false);
                        setNewManufacturerName('');
                      }
                    }}
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => void handleCreateManufacturer()}
                    disabled={!newManufacturerName.trim() || newManufacturerLoading}
                  >
                    {newManufacturerLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 px-2"
                    onClick={() => {
                      setShowNewManufacturer(false);
                      setNewManufacturerName('');
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {!showNewManufacturer && (
                <p className="text-xs text-muted-foreground">
                  Leave blank to apply this alias to all manufacturers.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="alias-label">Their Field Label</Label>
              <Input
                id="alias-label"
                placeholder="e.g. Width, Opening Width, Frame Width…"
                value={newAliasLabel}
                onChange={(e) => setNewAliasLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddAlias(); }}
              />
              <p className="text-xs text-muted-foreground">
                Exactly how this manufacturer labels this field in their estimates.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddAlias()}
              disabled={!newAliasLabel.trim() || addAliasLoading}
            >
              {addAliasLoading ? 'Saving…' : 'Save Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move Alias Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Move Alias to Different Field</DialogTitle>
            <DialogDescription>
              Reassign{' '}
              <span className="font-semibold">&ldquo;{moveTarget?.manufacturerFieldLabel}&rdquo;</span>{' '}
              {moveTarget?.manufacturer?.name ? (
                <>from <span className="font-semibold">{moveTarget.manufacturer.name}</span> </>
              ) : null}
              to a different master field label. Use this when the alias was extracted into the wrong field.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="move-alias-field">Target Field</Label>
              {resourcesLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              ) : (() => {
                const available = allFieldDefs.filter((fd) => fd.id !== fieldDefinitionId);
                return available.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other field definitions available.</p>
                ) : (
                  <Select value={moveFieldDefId} onValueChange={setMoveFieldDefId}>
                    <SelectTrigger id="move-alias-field">
                      <SelectValue placeholder="Select target field…" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((fd) => (
                        <SelectItem key={fd.id} value={fd.id}>
                          {fd.fieldLabel}
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            ({fd.fieldKey})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                The alias will be removed from its current field and associated with the selected field.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setMoveTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleMove()}
              disabled={!moveFieldDefId || moveLoading}
            >
              {moveLoading ? 'Moving…' : 'Move Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Tiny helper that calls `onLoad` once on mount — avoids putting
// imperative calls in the parent's render while keeping the component pure.
function AliasLoader({ onLoad }: { onLoad: () => Promise<void> }) {
  const [called, setCalled] = useState(false);
  if (!called) {
    setCalled(true);
    void onLoad();
  }
  return null;
}
