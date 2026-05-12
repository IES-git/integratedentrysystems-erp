import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Loader2, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  FieldDefinition,
  ItemTypeFieldDependency,
  ResolvedFieldDependency,
} from '@/types';
import {
  getItemTypeFieldDependencies,
  getResolvedDependencies,
  removeItemTypeFieldDependency,
  removeItemFieldDependency,
} from '@/lib/item-fields-api';
import { formatConditionBadge } from '@/lib/field-dependencies';
import { useToast } from '@/hooks/use-toast';
import { AddDependencyDialog, type DependencyDataSource } from './AddDependencyDialog';
import { FieldOptionsPanel } from './FieldOptionsPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldDepSource =
  | { itemTypeSlug: string }
  | { canonicalCode: string };

interface FieldDependenciesSectionProps {
  /** The parent field whose conditional sub-fields we're managing. */
  parentField: FieldDefinition;
  dataSource: FieldDepSource;
  /** When true, hides the "Add sub-field" button and the section header —
   *  used to prevent grandchildren when rendering a child's FieldOptionsPanel. */
  disableNestedDependencies?: boolean;
}

// ---------------------------------------------------------------------------
// Row for one resolved dependency (per-item / canonical-code view)
// ---------------------------------------------------------------------------

interface ResolvedDepRowProps {
  dep: ResolvedFieldDependency;
  isInherited: boolean;
  canonicalCode: string;
  parentField: FieldDefinition;
  parentIds: Set<string>;
  onRemoved: () => void;
  onEdited: () => void;
}

function ResolvedDepRow({
  dep,
  isInherited,
  canonicalCode,
  parentField,
  parentIds,
  onRemoved,
  onEdited,
}: ResolvedDepRowProps) {
  const { toast } = useToast();
  const [removing, setRemoving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await removeItemFieldDependency(
        canonicalCode,
        dep.parentFieldDefinitionId,
        dep.childField.id,
        !isInherited
      );
      onRemoved();
    } catch {
      toast({ title: 'Error', description: 'Failed to remove sub-field', variant: 'destructive' });
    } finally {
      setRemoving(false);
    }
  }

  // Build a minimal "editingRule"-compatible object for the dialog
  const editingOverride = {
    id: '',
    canonicalCode,
    parentFieldDefinitionId: dep.parentFieldDefinitionId,
    childFieldDefinitionId: dep.childField.id,
    operator: dep.operator,
    triggerValues: dep.triggerValues,
    sortOrder: dep.sortOrder,
    isHidden: false,
    isAddedLocally: !isInherited,
    createdAt: '',
    updatedAt: '',
  };

  return (
    <>
      <div className="pl-4 border-l-2 border-primary/20 space-y-1.5 py-1">
        {/* Condition badge + action buttons */}
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="text-xs gap-1 font-normal"
          >
            <GitBranch className="h-2.5 w-2.5" />
            Shown when {formatConditionBadge(dep.operator, dep.triggerValues)}
          </Badge>
          {isInherited && (
            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
              inherited
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Edit condition"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              title={isInherited ? 'Hide this sub-field' : 'Remove sub-field'}
              onClick={() => void handleRemove()}
              disabled={removing}
            >
              {removing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>

        {/* Child field panel — nested, no further dependencies */}
        <FieldOptionsPanel
          field={dep.childField}
          dataSource={{ canonicalCode }}
          disableNestedDependencies
        />
      </div>

      <AddDependencyDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        parentField={parentField}
        existingDependencyParentIds={parentIds}
        dataSource={{ canonicalCode, existingParentIds: parentIds }}
        editingRule={editingOverride}
        onSuccess={onEdited}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Row for one item-type-level dependency
// ---------------------------------------------------------------------------

interface TypeDepRowProps {
  dep: ItemTypeFieldDependency;
  itemTypeSlug: string;
  parentField: FieldDefinition;
  parentIds: Set<string>;
  onRemoved: () => void;
  onEdited: () => void;
}

function TypeDepRow({
  dep,
  itemTypeSlug,
  parentField,
  parentIds,
  onRemoved,
  onEdited,
}: TypeDepRowProps) {
  const { toast } = useToast();
  const [removing, setRemoving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await removeItemTypeFieldDependency(dep.id);
      onRemoved();
    } catch {
      toast({ title: 'Error', description: 'Failed to remove sub-field', variant: 'destructive' });
    } finally {
      setRemoving(false);
    }
  }

  if (!dep.childField) return null;

  return (
    <>
      <div className="pl-4 border-l-2 border-primary/20 space-y-1.5 py-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs gap-1 font-normal">
            <GitBranch className="h-2.5 w-2.5" />
            Shown when {formatConditionBadge(dep.operator, dep.triggerValues)}
          </Badge>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Edit condition"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              title="Remove sub-field"
              onClick={() => void handleRemove()}
              disabled={removing}
            >
              {removing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>

        {/* Child field panel — global dataSource, no further dependencies */}
        <FieldOptionsPanel
          field={dep.childField}
          dataSource={{ itemTypeSlug }}
          disableNestedDependencies
        />
      </div>

      <AddDependencyDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        parentField={parentField}
        existingDependencyParentIds={parentIds}
        dataSource={{ itemTypeSlug, existingParentIds: parentIds }}
        editingRule={dep}
        onSuccess={onEdited}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

export function FieldDependenciesSection({
  parentField,
  dataSource,
  disableNestedDependencies = false,
}: FieldDependenciesSectionProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  // item-type mode
  const [typeDeps, setTypeDeps] = useState<ItemTypeFieldDependency[]>([]);
  // per-item mode
  const [resolvedDeps, setResolvedDeps] = useState<ResolvedFieldDependency[]>([]);
  // IDs of fields already used as parent (to block grandchildren)
  const [existingParentIds, setExistingParentIds] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);

  const isItemTypeMode = 'itemTypeSlug' in dataSource;
  const itemTypeSlug = isItemTypeMode ? dataSource.itemTypeSlug : '';
  const canonicalCode = !isItemTypeMode ? dataSource.canonicalCode : '';

  const loadDeps = useCallback(async () => {
    setLoading(true);
    try {
      if (isItemTypeMode) {
        const all = await getItemTypeFieldDependencies(itemTypeSlug);
        setTypeDeps(all);
        setExistingParentIds(new Set(all.map((d) => d.parentFieldDefinitionId)));
      } else {
        const resolved = await getResolvedDependencies(canonicalCode);
        setResolvedDeps(resolved);
        setExistingParentIds(new Set(resolved.map((d) => d.parentFieldDefinitionId)));
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load conditional sub-fields',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [isItemTypeMode, itemTypeSlug, canonicalCode, toast]);

  useEffect(() => {
    void loadDeps();
  }, [loadDeps]);

  // Filter to only this parent's deps
  const myTypeDeps = typeDeps.filter(
    (d) => d.parentFieldDefinitionId === parentField.id
  );
  const myResolvedDeps = resolvedDeps.filter(
    (d) => d.parentFieldDefinitionId === parentField.id
  );

  // Build dialog dataSource
  const dialogDataSource: DependencyDataSource = isItemTypeMode
    ? { itemTypeSlug, existingParentIds }
    : { canonicalCode, existingParentIds };

  const hasDeps = isItemTypeMode ? myTypeDeps.length > 0 : myResolvedDeps.length > 0;

  if (disableNestedDependencies) return null;

  return (
    <div className={cn('mt-3 space-y-2')}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Conditional sub-fields</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-3 w-3" />
          Add sub-field
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading…
        </div>
      ) : !hasDeps ? (
        <p className="text-xs text-muted-foreground italic">
          None yet.{' '}
          <button
            className="underline underline-offset-2 hover:text-foreground transition-colors"
            onClick={() => setAddOpen(true)}
          >
            Add one
          </button>
          .
        </p>
      ) : isItemTypeMode ? (
        <div className="space-y-3">
          {myTypeDeps.map((dep) => (
            <TypeDepRow
              key={dep.id}
              dep={dep}
              itemTypeSlug={itemTypeSlug}
              parentField={parentField}
              parentIds={existingParentIds}
              onRemoved={loadDeps}
              onEdited={loadDeps}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {myResolvedDeps.map((dep) => {
            // A dep is "inherited" when it comes from the type level (not added locally).
            // We can detect this by checking resolvedDeps: locally added overrides have
            // no matching type-rule. Since we don't have that info here, we treat all
            // resolved deps as potentially inherited — the remove handler deals with it.
            return (
              <ResolvedDepRow
                key={`${dep.parentFieldDefinitionId}::${dep.childField.id}`}
                dep={dep}
                isInherited={true}
                canonicalCode={canonicalCode}
                parentField={parentField}
                parentIds={existingParentIds}
                onRemoved={loadDeps}
                onEdited={loadDeps}
              />
            );
          })}
        </div>
      )}

      <AddDependencyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        parentField={parentField}
        existingDependencyParentIds={existingParentIds}
        dataSource={dialogDataSource}
        onSuccess={loadDeps}
      />
    </div>
  );
}
