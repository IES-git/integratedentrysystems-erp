import { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp, AlertCircle, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { getFieldDefinitionsForItemType, getFieldValueOptions, recordFieldValueUsage, createOrApproveFieldDefinition } from '@/lib/estimates-api';
import type { EstimateItem, ItemField, FieldDefinition, FieldValueOption } from '@/types';

interface LineItemWithFields extends EstimateItem {
  fields: ItemField[];
}

type AddFieldMode = 'select' | 'create';

interface LineItemsStepProps {
  lineItems: LineItemWithFields[];
  totalPrice: number | null;
  onUpdateItem: (itemId: string, updates: Partial<EstimateItem>) => void;
  onUpdateField: (fieldId: string, updates: Partial<ItemField>) => void;
  onAddField: (itemId: string, field: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onDeleteField: (fieldId: string) => void;
  onBack: () => void;
  onFinish: () => void;
  finishLabel?: string;
  onAddItem?: () => void;
  onDeleteItem?: (itemId: string) => void;
  fieldDefinitions?: FieldDefinition[];
}

export function LineItemsStep({
  lineItems,
  totalPrice,
  onUpdateItem,
  onUpdateField,
  onAddField,
  onDeleteField,
  onBack,
  onFinish,
  finishLabel = 'Save as Draft',
  onAddItem,
  onDeleteItem,
  fieldDefinitions,
}: LineItemsStepProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    new Set(lineItems.map((item) => item.id))
  );

  // Field editing state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingFieldObj, setEditingFieldObj] = useState<ItemField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [fieldValueOptions, setFieldValueOptions] = useState<FieldValueOption[]>([]);
  const [fieldValuePopoverOpen, setFieldValuePopoverOpen] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Add field state
  const [addingFieldTo, setAddingFieldTo] = useState<string | null>(null);
  const [addFieldMode, setAddFieldMode] = useState<AddFieldMode>('select');
  const [selectedFieldDef, setSelectedFieldDef] = useState<FieldDefinition | null>(null);
  const [fieldDefPopoverOpen, setFieldDefPopoverOpen] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  // Smart suggestions state
  const [suggestedFieldDefs, setSuggestedFieldDefs] = useState<FieldDefinition[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Add-field value options (combobox for value input when field def is selected)
  const [addFieldValueOptions, setAddFieldValueOptions] = useState<FieldValueOption[]>([]);
  const [addFieldValuePopoverOpen, setAddFieldValuePopoverOpen] = useState(false);

  const hasFieldDefs = fieldDefinitions && fieldDefinitions.length > 0;

  // Field defs not in the suggested set (used for the "All Fields" group)
  const otherFieldDefs = useMemo(() => {
    const suggestedIds = new Set(suggestedFieldDefs.map((fd) => fd.id));
    return (fieldDefinitions ?? []).filter((fd) => !suggestedIds.has(fd.id));
  }, [fieldDefinitions, suggestedFieldDefs]);

  // Fetch item-scoped suggestions when the Add Field form opens for an item
  useEffect(() => {
    if (!addingFieldTo) {
      setSuggestedFieldDefs([]);
      return;
    }
    const item = lineItems.find((i) => i.id === addingFieldTo);
    if (!item) return;

    setLoadingSuggestions(true);
    getFieldDefinitionsForItemType(item.itemLabel, item.canonicalCode)
      .then(setSuggestedFieldDefs)
      .catch(console.error)
      .finally(() => setLoadingSuggestions(false));
  }, [addingFieldTo, lineItems]);

  // Fetch value history when a field def is selected in add-field mode
  useEffect(() => {
    if (!selectedFieldDef?.id) {
      setAddFieldValueOptions([]);
      return;
    }
    getFieldValueOptions(selectedFieldDef.id)
      .then(setAddFieldValueOptions)
      .catch(console.error);
  }, [selectedFieldDef]);

  // Fetch value history when entering edit mode for a field with a definition
  useEffect(() => {
    if (!editingFieldObj?.fieldDefinitionId) {
      setFieldValueOptions([]);
      return;
    }
    getFieldValueOptions(editingFieldObj.fieldDefinitionId)
      .then(setFieldValueOptions)
      .catch(console.error);
  }, [editingFieldObj]);

  const toggleItem = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const startEditField = (field: ItemField) => {
    setEditingField(field.id);
    setEditingFieldObj(field);
    setEditValue(field.fieldValue);
    setFieldValuePopoverOpen(false);
  };

  const saveFieldEdit = (fieldId: string) => {
    onUpdateField(fieldId, { fieldValue: editValue });
    if (editingFieldObj?.fieldDefinitionId && editValue.trim()) {
      recordFieldValueUsage(editingFieldObj.fieldDefinitionId, editValue.trim()).catch(console.error);
    }
    setEditingField(null);
    setEditingFieldObj(null);
    setEditValue('');
    setFieldValueOptions([]);
    setFieldValuePopoverOpen(false);
  };

  const cancelFieldEdit = () => {
    setEditingField(null);
    setEditingFieldObj(null);
    setEditValue('');
    setFieldValueOptions([]);
    setFieldValuePopoverOpen(false);
  };

  const resetAddFieldForm = () => {
    setAddingFieldTo(null);
    setAddFieldMode('select');
    setSelectedFieldDef(null);
    setFieldDefPopoverOpen(false);
    setNewFieldKey('');
    setNewFieldLabel('');
    setNewFieldValue('');
    setAddFieldValueOptions([]);
    setAddFieldValuePopoverOpen(false);
  };

  const handleAddField = (itemId: string) => {
    if (addFieldMode === 'select' && selectedFieldDef) {
      onAddField(itemId, {
        estimateItemId: itemId,
        fieldKey: selectedFieldDef.fieldKey,
        fieldLabel: selectedFieldDef.fieldLabel,
        fieldValue: newFieldValue,
        valueType: selectedFieldDef.valueType,
        fieldDefinitionId: selectedFieldDef.id,
        sourceConfidence: null,
      });
      if (selectedFieldDef.id && newFieldValue.trim()) {
        recordFieldValueUsage(selectedFieldDef.id, newFieldValue.trim()).catch(console.error);
      }
      resetAddFieldForm();
      return;
    }

    if (addFieldMode === 'create') {
      if (!newFieldKey.trim() || !newFieldLabel.trim()) return;
      const fieldKey = newFieldKey.toLowerCase().replace(/\s+/g, '_');
      onAddField(itemId, {
        estimateItemId: itemId,
        fieldKey,
        fieldLabel: newFieldLabel,
        fieldValue: newFieldValue,
        valueType: 'string',
        sourceConfidence: null,
      });
      createOrApproveFieldDefinition({ fieldKey, fieldLabel: newFieldLabel }).catch(console.error);
      resetAddFieldForm();
    }
  };

  const isAddFieldDisabled = (itemId: string) => {
    if (addingFieldTo !== itemId) return false;
    if (addFieldMode === 'select') return !selectedFieldDef;
    return !newFieldKey.trim() || !newFieldLabel.trim();
  };

  // Memoised set of field keys already used per item
  const usedFieldKeys = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of lineItems) {
      map.set(item.id, new Set(item.fields.map((f) => f.fieldKey)));
    }
    return map;
  }, [lineItems]);

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'text-muted-foreground';
    if (confidence >= 0.9) return 'text-success';
    if (confidence >= 0.7) return 'text-warning';
    return 'text-destructive';
  };

  // Filtered value options for the inline field edit
  const filteredFieldValueOptions = useMemo(() => {
    if (!editValue.trim()) return fieldValueOptions;
    return fieldValueOptions.filter((o) =>
      o.value.toLowerCase().includes(editValue.toLowerCase())
    );
  }, [fieldValueOptions, editValue]);

  // Filtered value options for the add-field value input
  const filteredAddFieldValueOptions = useMemo(() => {
    if (!newFieldValue.trim()) return addFieldValueOptions;
    return addFieldValueOptions.filter((o) =>
      o.value.toLowerCase().includes(newFieldValue.toLowerCase())
    );
  }, [addFieldValueOptions, newFieldValue]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">
            {onAddItem ? 'Add Line Items' : 'Verify Line Items'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {onAddItem
              ? 'Add items and their fields to the estimate'
              : 'Review and correct the extracted information for each line item'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onAddItem && (
            <Button size="sm" variant="outline" onClick={onAddItem}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Line Item
            </Button>
          )}
          <Badge variant="secondary" className="text-sm">
            {lineItems.length} item{lineItems.length !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Total Price Banner */}
      {totalPrice !== null && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Estimate Total</p>
                <p className="text-xs text-muted-foreground">Extracted from document</p>
              </div>
              <div className="text-3xl font-bold text-primary">
                ${totalPrice.toFixed(2)}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {lineItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {onAddItem ? 'No line items yet — click "Add Line Item" to start' : 'No line items found in the estimate'}
            </p>
            {onAddItem && (
              <Button size="sm" variant="outline" className="mt-4" onClick={onAddItem}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Line Item
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {lineItems.map((item, index) => (
            <Collapsible
              key={item.id}
              open={expandedItems.has(item.id)}
              onOpenChange={() => toggleItem(item.id)}
            >
              <Card className="overflow-hidden">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Package className="h-4 w-4" />
                            {item.itemLabel}
                          </CardTitle>
                          <CardDescription className="font-mono text-xs">
                            {item.canonicalCode} × {item.quantity}
                            {item.unitPrice !== null && (
                              <span className="ml-2 text-primary font-semibold">
                                ${item.unitPrice.toFixed(2)}
                              </span>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {item.fields.length} fields
                        </Badge>
                        {onDeleteItem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteItem(item.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {expandedItems.has(item.id) ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 border-t">
                    {/* Item Details */}
                    <div className="grid grid-cols-4 gap-4 py-4 border-b">
                      <div>
                        <Label className="text-xs text-muted-foreground">Item Label</Label>
                        <Input
                          value={item.itemLabel}
                          onChange={(e) => onUpdateItem(item.id, { itemLabel: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Item Code</Label>
                        <Input
                          value={item.canonicalCode}
                          onChange={(e) => onUpdateItem(item.id, { canonicalCode: e.target.value })}
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Quantity</Label>
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => onUpdateItem(item.id, { quantity: parseInt(e.target.value) || 1 })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Unit Price</Label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            $
                          </span>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.unitPrice ?? ''}
                            onChange={(e) => onUpdateItem(item.id, { unitPrice: e.target.value ? parseFloat(e.target.value) : null })}
                            className="h-8 pl-6 text-sm"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Fields */}
                    <div className="py-4 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Fields
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setSelectedFieldDef(null);
                            setNewFieldKey('');
                            setNewFieldLabel('');
                            setNewFieldValue('');
                            setAddFieldMode(hasFieldDefs ? 'select' : 'create');
                            setAddingFieldTo(item.id);
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Field
                        </Button>
                      </div>

                      <div className="rounded-lg border divide-y">
                        {item.fields.map((field) => (
                          <div
                            key={field.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                          >
                            <div className="w-32 shrink-0">
                              <p className="text-xs font-medium text-muted-foreground">
                                {field.fieldLabel}
                              </p>
                              <p className="text-[10px] font-mono text-muted-foreground/70">
                                {field.fieldKey}
                              </p>
                            </div>

                            <div className="flex-1">
                              {editingField === field.id ? (
                                <div className="flex items-center gap-2">
                                  {/* Combobox for fields with value history */}
                                  {fieldValueOptions.length > 0 ? (
                                    <Popover open={fieldValuePopoverOpen} onOpenChange={setFieldValuePopoverOpen}>
                                      <PopoverTrigger asChild>
                                        <div className="relative flex-1">
                                          <Input
                                            ref={editInputRef}
                                            value={editValue}
                                            onChange={(e) => {
                                              setEditValue(e.target.value);
                                              setFieldValuePopoverOpen(true);
                                            }}
                                            className="h-7 text-sm pr-7"
                                            autoFocus
                                            onFocus={() => setFieldValuePopoverOpen(true)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                saveFieldEdit(field.id);
                                                setFieldValuePopoverOpen(false);
                                              }
                                              if (e.key === 'Escape') {
                                                if (fieldValuePopoverOpen) {
                                                  setFieldValuePopoverOpen(false);
                                                } else {
                                                  cancelFieldEdit();
                                                }
                                              }
                                            }}
                                          />
                                          <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                        </div>
                                      </PopoverTrigger>
                                      <PopoverContent
                                        className="w-48 p-1"
                                        align="start"
                                        onOpenAutoFocus={(e) => e.preventDefault()}
                                      >
                                        {filteredFieldValueOptions.length === 0 ? (
                                          <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching values</p>
                                        ) : (
                                          filteredFieldValueOptions.map((opt) => (
                                            <button
                                              key={opt.id}
                                              className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded flex items-center justify-between gap-2"
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                setEditValue(opt.value);
                                                setFieldValuePopoverOpen(false);
                                                editInputRef.current?.focus();
                                              }}
                                            >
                                              <span className="truncate">{opt.value}</span>
                                              <span className="text-[10px] text-muted-foreground shrink-0">{opt.usageCount}×</span>
                                            </button>
                                          ))
                                        )}
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <Input
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="h-7 text-sm"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveFieldEdit(field.id);
                                        if (e.key === 'Escape') cancelFieldEdit();
                                      }}
                                    />
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={() => saveFieldEdit(field.id)}
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={cancelFieldEdit}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div
                                  className="flex items-center gap-2 cursor-pointer group"
                                  onClick={() => startEditField(field)}
                                >
                                  <span className="text-sm">{field.fieldValue || '—'}</span>
                                  <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {field.sourceConfidence !== null && (
                                <span
                                  className={cn(
                                    'text-[10px] font-mono',
                                    getConfidenceColor(field.sourceConfidence)
                                  )}
                                >
                                  {Math.round(field.sourceConfidence * 100)}%
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => onDeleteField(field.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}

                        {item.fields.length === 0 && (
                          <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                            No fields extracted
                          </p>
                        )}
                      </div>

                      {/* Add Field Form */}
                      {addingFieldTo === item.id && (
                        <div className="mt-3 p-3 rounded-lg border border-dashed bg-muted/30 space-y-3">
                          {/* Mode tabs — only shown when field definitions exist */}
                          {hasFieldDefs && (
                            <div className="flex gap-1 p-0.5 rounded-md bg-muted w-fit">
                              <button
                                type="button"
                                className={cn(
                                  'px-3 py-1 rounded text-xs font-medium transition-colors',
                                  addFieldMode === 'select'
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                )}
                                onClick={() => {
                                  setAddFieldMode('select');
                                  setNewFieldKey('');
                                  setNewFieldLabel('');
                                }}
                              >
                                Select existing field
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  'px-3 py-1 rounded text-xs font-medium transition-colors',
                                  addFieldMode === 'create'
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                )}
                                onClick={() => {
                                  setAddFieldMode('create');
                                  setSelectedFieldDef(null);
                                }}
                              >
                                Create new field
                              </button>
                            </div>
                          )}

                          {/* Select existing field mode — grouped combobox */}
                          {addFieldMode === 'select' && hasFieldDefs && (
                            <div className="grid grid-cols-[1fr_1fr] gap-2">
                              <div className="col-span-2 sm:col-span-1">
                                <Label className="text-xs">Field Definition</Label>
                                <Popover open={fieldDefPopoverOpen} onOpenChange={setFieldDefPopoverOpen}>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      className="w-full h-8 text-sm justify-between font-normal"
                                    >
                                      <span className="truncate">
                                        {selectedFieldDef ? selectedFieldDef.fieldLabel : 'Search fields…'}
                                      </span>
                                      {loadingSuggestions ? (
                                        <Loader2 className="ml-2 h-3 w-3 shrink-0 animate-spin opacity-50" />
                                      ) : (
                                        <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                      )}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72 p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Search field definitions…" className="h-8 text-sm" />
                                      <CommandList>
                                        <CommandEmpty>No matching fields.</CommandEmpty>

                                        {/* Suggested fields for this item type */}
                                        {suggestedFieldDefs.filter((fd) => !usedFieldKeys.get(item.id)?.has(fd.fieldKey)).length > 0 && (
                                          <CommandGroup heading={`Suggested for "${item.itemLabel}"`}>
                                            {suggestedFieldDefs
                                              .filter((fd) => !usedFieldKeys.get(item.id)?.has(fd.fieldKey))
                                              .map((fd) => (
                                                <CommandItem
                                                  key={fd.id}
                                                  value={`suggested ${fd.fieldLabel} ${fd.fieldKey}`}
                                                  onSelect={() => {
                                                    setSelectedFieldDef(fd);
                                                    setFieldDefPopoverOpen(false);
                                                  }}
                                                >
                                                  <div className="flex flex-col">
                                                    <span className="text-sm">{fd.fieldLabel}</span>
                                                    <span className="text-[10px] font-mono text-muted-foreground">{fd.fieldKey}</span>
                                                  </div>
                                                </CommandItem>
                                              ))}
                                          </CommandGroup>
                                        )}

                                        {/* All other approved fields */}
                                        {otherFieldDefs.filter((fd) => !usedFieldKeys.get(item.id)?.has(fd.fieldKey)).length > 0 && (
                                          <>
                                            {suggestedFieldDefs.length > 0 && <CommandSeparator />}
                                            <CommandGroup heading="All Fields">
                                              {otherFieldDefs
                                                .filter((fd) => !usedFieldKeys.get(item.id)?.has(fd.fieldKey))
                                                .map((fd) => (
                                                  <CommandItem
                                                    key={fd.id}
                                                    value={`${fd.fieldLabel} ${fd.fieldKey}`}
                                                    onSelect={() => {
                                                      setSelectedFieldDef(fd);
                                                      setFieldDefPopoverOpen(false);
                                                    }}
                                                  >
                                                    <div className="flex flex-col">
                                                      <span className="text-sm">{fd.fieldLabel}</span>
                                                      <span className="text-[10px] font-mono text-muted-foreground">{fd.fieldKey}</span>
                                                    </div>
                                                  </CommandItem>
                                                ))}
                                            </CommandGroup>
                                          </>
                                        )}

                                        <CommandSeparator />
                                        <CommandGroup>
                                          <CommandItem
                                            value="__create_new_field__"
                                            onSelect={() => {
                                              setAddFieldMode('create');
                                              setSelectedFieldDef(null);
                                              setFieldDefPopoverOpen(false);
                                            }}
                                          >
                                            <Plus className="mr-2 h-3.5 w-3.5 text-primary" />
                                            <span className="text-primary">Create New Field</span>
                                          </CommandItem>
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>

                              {/* Value input — combobox when history exists */}
                              <div className="col-span-2 sm:col-span-1">
                                <Label className="text-xs">Value</Label>
                                {addFieldValueOptions.length > 0 ? (
                                  <Popover open={addFieldValuePopoverOpen} onOpenChange={setAddFieldValuePopoverOpen}>
                                    <PopoverTrigger asChild>
                                      <div className="relative">
                                        <Input
                                          placeholder={selectedFieldDef ? `e.g. ${selectedFieldDef.fieldKey}` : '—'}
                                          value={newFieldValue}
                                          onChange={(e) => {
                                            setNewFieldValue(e.target.value);
                                            setAddFieldValuePopoverOpen(true);
                                          }}
                                          className="h-8 text-sm pr-7"
                                          disabled={!selectedFieldDef}
                                          onFocus={() => setAddFieldValuePopoverOpen(true)}
                                        />
                                        <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                      </div>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      className="w-48 p-1"
                                      align="start"
                                      onOpenAutoFocus={(e) => e.preventDefault()}
                                    >
                                      {filteredAddFieldValueOptions.map((opt) => (
                                        <button
                                          key={opt.id}
                                          className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded flex items-center justify-between gap-2"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            setNewFieldValue(opt.value);
                                            setAddFieldValuePopoverOpen(false);
                                          }}
                                        >
                                          <span className="truncate">{opt.value}</span>
                                          <span className="text-[10px] text-muted-foreground shrink-0">{opt.usageCount}×</span>
                                        </button>
                                      ))}
                                    </PopoverContent>
                                  </Popover>
                                ) : (
                                  <Input
                                    placeholder={selectedFieldDef ? `e.g. ${selectedFieldDef.fieldKey}` : '—'}
                                    value={newFieldValue}
                                    onChange={(e) => setNewFieldValue(e.target.value)}
                                    className="h-8 text-sm"
                                    disabled={!selectedFieldDef}
                                  />
                                )}
                              </div>
                            </div>
                          )}

                          {/* Create new field mode */}
                          {addFieldMode === 'create' && (
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <Label className="text-xs">Field Key</Label>
                                <Input
                                  placeholder="e.g. gauge"
                                  value={newFieldKey}
                                  onChange={(e) => setNewFieldKey(e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Display Label</Label>
                                <Input
                                  placeholder="e.g. Gauge"
                                  value={newFieldLabel}
                                  onChange={(e) => setNewFieldLabel(e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Value</Label>
                                <Input
                                  placeholder="e.g. 16 GA"
                                  value={newFieldValue}
                                  onChange={(e) => setNewFieldValue(e.target.value)}
                                  className="h-8 text-sm"
                                />
                              </div>
                            </div>
                          )}

                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={resetAddFieldForm}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleAddField(item.id)}
                              disabled={isAddFieldDisabled(item.id)}
                            >
                              Add Field
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}

      {/* Total Price Summary */}
      {totalPrice !== null && (
        <div className="flex justify-end items-center gap-4 pt-4 border-t">
          <span className="text-sm text-muted-foreground">Estimate Total:</span>
          <span className="text-2xl font-bold text-primary">
            ${totalPrice.toFixed(2)}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          Back to Customer
        </Button>
        <Button onClick={onFinish} size="lg">
          {finishLabel}
        </Button>
      </div>
    </div>
  );
}
