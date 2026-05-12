import { useState, useEffect } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type {
  FieldDefinition,
  DependencyOperator,
  ItemTypeFieldDependency,
  ItemTypeFieldDependencyOverride,
} from '@/types';
import {
  getFieldDefinitions,
  createOrApproveFieldDefinition,
  getFieldValueOptions,
} from '@/lib/estimates-api';
import {
  getItemFieldOptions,
  addItemTypeFieldDependency,
  addItemFieldDependencyOverride,
  updateItemTypeFieldDependency,
  updateItemFieldDependencyOverride,
} from '@/lib/item-fields-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyDataSource =
  | { itemTypeSlug: string; existingParentIds: Set<string> }
  | { canonicalCode: string; existingParentIds: Set<string> };

interface AddDependencyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The parent field this sub-field will be conditional on. */
  parentField: FieldDefinition;
  /** Existing type-level or override deps (to block child = existing parent). */
  existingDependencyParentIds: Set<string>;
  dataSource: DependencyDataSource;
  /** If provided, pre-populates the dialog for editing an existing dependency. */
  editingRule?: ItemTypeFieldDependency | ItemTypeFieldDependencyOverride | null;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_OPERATORS: { value: DependencyOperator; label: string; numeric: boolean }[] = [
  { value: 'equals', label: 'equals', numeric: false },
  { value: 'not_equals', label: 'not equals', numeric: false },
  { value: 'in', label: 'is one of', numeric: false },
  { value: 'not_in', label: 'is not one of', numeric: false },
  { value: 'gt', label: 'greater than (>)', numeric: true },
  { value: 'lt', label: 'less than (<)', numeric: true },
  { value: 'gte', label: 'greater than or equal (≥)', numeric: true },
  { value: 'lte', label: 'less than or equal (≤)', numeric: true },
  { value: 'between', label: 'between', numeric: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddDependencyDialog({
  open,
  onOpenChange,
  parentField,
  existingDependencyParentIds,
  dataSource,
  editingRule,
  onSuccess,
}: AddDependencyDialogProps) {
  const { toast } = useToast();
  const isEditing = !!editingRule;

  // Field picker state
  const [addMode, setAddMode] = useState<'select' | 'create'>('select');
  const [allFieldDefs, setAllFieldDefs] = useState<FieldDefinition[]>([]);
  const [fieldDefsLoading, setFieldDefsLoading] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');

  // Condition state
  const [operator, setOperator] = useState<DependencyOperator>('equals');
  const [triggerValues, setTriggerValues] = useState<string[]>([]);
  const [numericA, setNumericA] = useState('');
  const [numericB, setNumericB] = useState('');
  const [multiSelectDraft, setMultiSelectDraft] = useState('');

  // Parent field options (for string operators)
  const [parentOptions, setParentOptions] = useState<string[]>([]);
  const [parentOptionsLoading, setParentOptionsLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const isNumericParent = parentField.valueType === 'number';
  const availableOperators = ALL_OPERATORS.filter(
    (op) => isNumericParent || !op.numeric
  );
  const selectedOp = ALL_OPERATORS.find((o) => o.value === operator)!;
  const isMultiSelect =
    !selectedOp.numeric && (operator === 'in' || operator === 'not_in');
  const isSingleString =
    !selectedOp.numeric && (operator === 'equals' || operator === 'not_equals');
  const isBetween = operator === 'between';
  const isSingleNumeric = selectedOp.numeric && !isBetween;

  // Reset when dialog opens/closes or editingRule changes
  useEffect(() => {
    if (!open) return;

    if (editingRule) {
      const op =
        'operator' in editingRule && editingRule.operator
          ? (editingRule.operator as DependencyOperator)
          : 'equals';
      const tv = editingRule.triggerValues ?? [];
      setOperator(op);
      const opDef = ALL_OPERATORS.find((o) => o.value === op)!;
      if (opDef.numeric) {
        setNumericA(String(tv[0] ?? ''));
        setNumericB(String(tv[1] ?? ''));
        setTriggerValues([]);
      } else {
        setTriggerValues(tv.map(String));
        setNumericA('');
        setNumericB('');
      }
      // In edit mode we only update the condition, not the child field
      setSelectedChildId('');
      setNewFieldLabel('');
    } else {
      setOperator('equals');
      setTriggerValues([]);
      setNumericA('');
      setNumericB('');
      setSelectedChildId('');
      setNewFieldLabel('');
    }
    setAddMode('select');
    setMultiSelectDraft('');
  }, [open, editingRule]);

  // Load all field defs when dialog opens
  useEffect(() => {
    if (!open || isEditing) return;
    setFieldDefsLoading(true);
    getFieldDefinitions()
      .then(setAllFieldDefs)
      .catch(() =>
        toast({ title: 'Error', description: 'Failed to load field definitions', variant: 'destructive' })
      )
      .finally(() => setFieldDefsLoading(false));
  }, [open, isEditing, toast]);

  // Load parent field options when operator is string-based
  useEffect(() => {
    if (!open || selectedOp.numeric) return;
    setParentOptionsLoading(true);
    const fetchOpts =
      'canonicalCode' in dataSource
        ? getItemFieldOptions(dataSource.canonicalCode, parentField.id)
        : getFieldValueOptions(parentField.id);
    fetchOpts
      .then((opts) => setParentOptions(opts.map((o) => o.value)))
      .catch(() => setParentOptions([]))
      .finally(() => setParentOptionsLoading(false));
  }, [open, operator, dataSource, parentField.id, selectedOp.numeric]);

  // Filtered child picker — exclude parent itself, existing parents (one-level), already-subfields
  const availableChildren = allFieldDefs.filter(
    (d) =>
      d.id !== parentField.id &&
      !existingDependencyParentIds.has(d.id)
  );

  function buildTriggerValues(): (string | number)[] {
    if (selectedOp.numeric) {
      if (isBetween) return [parseFloat(numericA), parseFloat(numericB)];
      return [parseFloat(numericA)];
    }
    return triggerValues;
  }

  function isFormValid(): boolean {
    if (!isEditing && addMode === 'select' && !selectedChildId) return false;
    if (!isEditing && addMode === 'create' && !newFieldLabel.trim()) return false;
    if (selectedOp.numeric) {
      if (!numericA || isNaN(parseFloat(numericA))) return false;
      if (isBetween && (!numericB || isNaN(parseFloat(numericB)))) return false;
    } else {
      if (triggerValues.length === 0) return false;
    }
    return true;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const tv = buildTriggerValues();

      if (isEditing && editingRule) {
        // Update existing rule
        if ('itemTypeSlug' in editingRule) {
          await updateItemTypeFieldDependency(editingRule.id, { operator, triggerValues: tv });
        } else {
          await updateItemFieldDependencyOverride(editingRule.id, { operator, triggerValues: tv });
        }
        toast({ title: 'Condition updated' });
        onSuccess();
        onOpenChange(false);
        return;
      }

      // Resolve child field definition ID
      let childId = selectedChildId;
      if (addMode === 'create') {
        const label = newFieldLabel.trim();
        const fieldKey = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const created = await createOrApproveFieldDefinition({
          fieldKey,
          fieldLabel: label,
          valueType: 'string',
        });
        childId = created.id;
      }

      if ('itemTypeSlug' in dataSource) {
        await addItemTypeFieldDependency({
          itemTypeSlug: dataSource.itemTypeSlug,
          parentFieldDefinitionId: parentField.id,
          childFieldDefinitionId: childId,
          operator,
          triggerValues: tv,
        });
      } else {
        await addItemFieldDependencyOverride({
          canonicalCode: dataSource.canonicalCode,
          parentFieldDefinitionId: parentField.id,
          childFieldDefinitionId: childId,
          operator,
          triggerValues: tv,
          isAddedLocally: true,
        });
      }
      toast({ title: 'Sub-field added' });
      onSuccess();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to save sub-field',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  function addToMultiSelect(value: string) {
    const trimmed = value.trim();
    if (!trimmed || triggerValues.includes(trimmed)) return;
    setTriggerValues((prev) => [...prev, trimmed]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit condition' : 'Add conditional sub-field'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* ── Child field picker (only when adding) ─────────────────────── */}
          {!isEditing && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Sub-field
              </p>
              <Tabs
                value={addMode}
                onValueChange={(v) => {
                  setAddMode(v as 'select' | 'create');
                  setSelectedChildId('');
                  setNewFieldLabel('');
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="select" className="flex-1">
                    Select existing
                  </TabsTrigger>
                  <TabsTrigger value="create" className="flex-1">
                    Create new
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="select" className="mt-2">
                  {fieldDefsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading fields…
                    </div>
                  ) : (
                    <Select value={selectedChildId} onValueChange={setSelectedChildId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a field…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableChildren.map((fd) => (
                          <SelectItem key={fd.id} value={fd.id}>
                            <span>{fd.fieldLabel}</span>
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              ({fd.fieldKey})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TabsContent>

                <TabsContent value="create" className="mt-2">
                  <Input
                    placeholder="Sub-field label (e.g. Window Width)"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    autoFocus
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* ── Condition ─────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Show when <span className="text-foreground">{parentField.fieldLabel}</span>…
            </p>

            <Select value={operator} onValueChange={(v) => setOperator(v as DependencyOperator)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableOperators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Trigger value editor */}
            {isSingleNumeric && (
              <Input
                type="number"
                placeholder="Value"
                value={numericA}
                onChange={(e) => setNumericA(e.target.value)}
              />
            )}

            {isBetween && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={numericA}
                  onChange={(e) => setNumericA(e.target.value)}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-sm">and</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={numericB}
                  onChange={(e) => setNumericB(e.target.value)}
                  className="flex-1"
                />
              </div>
            )}

            {isSingleString && (
              <div className="space-y-1.5">
                {parentOptionsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading options…
                  </div>
                ) : parentOptions.length > 0 ? (
                  <Select
                    value={triggerValues[0] ?? ''}
                    onValueChange={(v) => setTriggerValues([v])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a value…" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentOptions.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Value to match"
                    value={triggerValues[0] ?? ''}
                    onChange={(e) => setTriggerValues([e.target.value])}
                  />
                )}
              </div>
            )}

            {isMultiSelect && (
              <div className="space-y-2">
                {/* Selected values as badges */}
                {triggerValues.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {triggerValues.map((v) => (
                      <Badge
                        key={v}
                        variant="secondary"
                        className="gap-1 pr-1 text-xs"
                      >
                        {v}
                        <button
                          onClick={() =>
                            setTriggerValues((prev) => prev.filter((x) => x !== v))
                          }
                          className="hover:text-destructive"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Add from known options or freetext */}
                {parentOptionsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading options…
                  </div>
                ) : parentOptions.length > 0 ? (
                  <Select
                    value=""
                    onValueChange={(v) => addToMultiSelect(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Add a value…" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentOptions
                        .filter((o) => !triggerValues.includes(o))
                        .map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Type a value and press Enter"
                      value={multiSelectDraft}
                      onChange={(e) => setMultiSelectDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addToMultiSelect(multiSelectDraft);
                          setMultiSelectDraft('');
                        }
                      }}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        addToMultiSelect(multiSelectDraft);
                        setMultiSelectDraft('');
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !isFormValid()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditing ? 'Save' : 'Add sub-field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
