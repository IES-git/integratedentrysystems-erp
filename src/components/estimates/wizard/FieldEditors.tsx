/**
 * Shared field-editing components used by both AddItemModal and
 * BuildOpeningDialog (previously duplicated in each file).
 */

import { useState, useEffect } from 'react';
import { Trash2, ChevronsUpDown, Plus, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { getItemFieldValueOptionsForWizard } from '@/lib/estimates-api';
import { evaluateDependency } from '@/lib/field-dependencies';
import type { FieldValueOption, DependencyOperator } from '@/types';

// ---------------------------------------------------------------------------
// Types (re-exported so consumers don't need to import from AddItemModal)
// ---------------------------------------------------------------------------

export interface LocalField {
  localId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: import('@/types').FieldValueType;
  fieldDefinitionId?: string;
  isRequired: boolean;
  conditionalParentDefId?: string;
  conditionOperator?: DependencyOperator;
  conditionTriggerValues?: (string | number)[];
  isLocked?: boolean;
}

// ---------------------------------------------------------------------------
// FieldRow
// ---------------------------------------------------------------------------

interface FieldRowProps {
  field: LocalField;
  canonicalCode: string;
  onUpdate: (value: string) => void;
  onDelete: () => void;
  /**
   * When provided, options NOT in this set are shown with reduced opacity so
   * the user can see which values are actually priced by at least one
   * manufacturer. Does not hide unavailable values — only dims them.
   */
  availableValues?: Set<string>;
}

export function FieldRow({ field, canonicalCode, onUpdate, onDelete, availableValues }: FieldRowProps) {
  const [options, setOptions] = useState<FieldValueOption[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!field.fieldDefinitionId) return;
    getItemFieldValueOptionsForWizard(canonicalCode, field.fieldDefinitionId)
      .then(setOptions)
      .catch(console.error);
  }, [canonicalCode, field.fieldDefinitionId]);

  const handleOpenChange = (open: boolean) => {
    setPopoverOpen(open);
    if (open) setSearchQuery('');
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <div className="w-28 shrink-0">
        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-0.5">
          {field.fieldLabel}
          {field.isRequired && (
            <span className="text-destructive font-bold" title="Required">
              *
            </span>
          )}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/60">
          {field.fieldKey}
        </p>
      </div>

      {field.isLocked ? (
        <div className="h-7 flex-1 flex items-center gap-1.5 rounded border bg-muted/30 px-2">
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">
            {field.fieldValue || '—'}
          </span>
        </div>
      ) : options.length > 0 ? (
        <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={popoverOpen}
              className="h-7 flex-1 justify-between text-xs font-normal"
            >
              {field.fieldValue ? (
                <span>{field.fieldValue}</span>
              ) : (
                <span className="text-muted-foreground/60 text-[10px]">Select an option</span>
              )}
              <ChevronsUpDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0" align="start" onWheel={(e) => e.stopPropagation()}>
            <Command>
              <CommandInput
                placeholder="Search or type…"
                className="h-8 text-xs"
                value={searchQuery}
                onValueChange={(val) => {
                  setSearchQuery(val);
                  onUpdate(val);
                }}
              />
              <CommandList>
                <CommandEmpty className="py-1.5 text-center text-xs text-muted-foreground">
                  Press Enter to use this value
                </CommandEmpty>
                <CommandGroup>
                  {options.map((o) => {
                    const isAvailable = !availableValues || availableValues.has(o.value);
                    return (
                      <CommandItem
                        key={o.id}
                        value={o.value}
                        onSelect={(val) => {
                          onUpdate(val);
                          setPopoverOpen(false);
                        }}
                        className={isAvailable ? undefined : 'opacity-50'}
                      >
                        <span className="flex-1">{o.value}</span>
                        {availableValues && (
                          <span className="ml-2 text-[10px] text-muted-foreground" title={isAvailable ? 'Priced by at least one manufacturer' : 'No pricing table found for this value'}>
                            {isAvailable ? '✓' : '–'}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <Input
          value={field.fieldValue}
          onChange={(e) => onUpdate(e.target.value)}
          className="h-7 text-xs flex-1"
          placeholder={field.isRequired ? 'Required' : '—'}
        />
      )}

      {!field.isRequired && !field.isLocked && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldsList
// ---------------------------------------------------------------------------

interface FieldsListProps {
  fields: LocalField[];
  canonicalCode: string;
  onUpdateField: (localId: string, value: string) => void;
  onDeleteField: (localId: string) => void;
  /** Optional map of fieldKey → set of priced values for availability indicators. */
  pricedValuesByKey?: Map<string, Set<string>>;
}

export function FieldsList({ fields, canonicalCode, onUpdateField, onDeleteField, pricedValuesByKey }: FieldsListProps) {
  if (fields.length === 0) return null;

  const parentFields = fields.filter((f) => !f.conditionalParentDefId);
  const childrenByParentDefId = new Map<string, LocalField[]>();
  for (const f of fields) {
    if (!f.conditionalParentDefId) continue;
    const list = childrenByParentDefId.get(f.conditionalParentDefId) ?? [];
    list.push(f);
    childrenByParentDefId.set(f.conditionalParentDefId, list);
  }

  const rows: React.ReactElement[] = [];
  for (const field of parentFields) {
    rows.push(
      <FieldRow
        key={field.localId}
        field={field}
        canonicalCode={canonicalCode}
        onUpdate={(val) => onUpdateField(field.localId, val)}
        onDelete={() => onDeleteField(field.localId)}
        availableValues={pricedValuesByKey?.get(field.fieldKey)}
      />
    );
    if (!field.fieldDefinitionId) continue;
    const children = childrenByParentDefId.get(field.fieldDefinitionId) ?? [];
    for (const child of children) {
      if (
        child.conditionOperator === undefined ||
        child.conditionTriggerValues === undefined
      )
        continue;
      if (
        !evaluateDependency(
          field.fieldValue || null,
          child.conditionOperator,
          child.conditionTriggerValues
        )
      )
        continue;
      rows.push(
        <div
          key={child.localId}
          className="pl-4 ml-1 border-l-2 border-primary/20 bg-muted/20"
        >
          <FieldRow
            field={child}
            canonicalCode={canonicalCode}
            onUpdate={(val) => onUpdateField(child.localId, val)}
            onDelete={() => onDeleteField(child.localId)}
            availableValues={pricedValuesByKey?.get(child.fieldKey)}
          />
        </div>
      );
    }
  }

  return (
    <div className="rounded-md border divide-y">
      {rows}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddFieldForm
// ---------------------------------------------------------------------------

interface AddFieldFormProps {
  onAdd: (field: Omit<LocalField, 'localId'>) => void;
  onCancel: () => void;
}

export function AddFieldForm({ onAdd, onCancel }: AddFieldFormProps) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    if (!key.trim() || !label.trim()) return;
    onAdd({
      fieldKey: key.toLowerCase().replace(/\s+/g, '_'),
      fieldLabel: label,
      fieldValue: value,
      valueType: 'string',
      isRequired: false,
    });
  };

  return (
    <div className="mt-2 rounded-md border border-dashed bg-muted/20 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        Add Custom Field
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">Key</Label>
          <Input
            placeholder="e.g. gauge"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Label</Label>
          <Input
            placeholder="e.g. Gauge"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Value</Label>
          <Input
            placeholder="e.g. 16 GA"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSubmit}
          disabled={!key.trim() || !label.trim()}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
