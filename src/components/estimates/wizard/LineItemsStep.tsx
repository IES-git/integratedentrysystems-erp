import { useState, useMemo } from 'react';
import { Package, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp, AlertCircle, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { EstimateItem, ItemField, FieldDefinition } from '@/types';

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
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingFieldTo, setAddingFieldTo] = useState<string | null>(null);
  const [addFieldMode, setAddFieldMode] = useState<AddFieldMode>('select');
  const [selectedFieldDef, setSelectedFieldDef] = useState<FieldDefinition | null>(null);
  const [fieldDefPopoverOpen, setFieldDefPopoverOpen] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  const hasFieldDefs = fieldDefinitions && fieldDefinitions.length > 0;

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
    setEditValue(field.fieldValue);
  };

  const saveFieldEdit = (fieldId: string) => {
    onUpdateField(fieldId, { fieldValue: editValue });
    setEditingField(null);
    setEditValue('');
  };

  const cancelFieldEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const resetAddFieldForm = () => {
    setAddingFieldTo(null);
    setAddFieldMode('select');
    setSelectedFieldDef(null);
    setFieldDefPopoverOpen(false);
    setNewFieldKey('');
    setNewFieldLabel('');
    setNewFieldValue('');
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
      resetAddFieldForm();
      return;
    }

    if (addFieldMode === 'create') {
      if (!newFieldKey.trim() || !newFieldLabel.trim()) return;
      onAddField(itemId, {
        estimateItemId: itemId,
        fieldKey: newFieldKey.toLowerCase().replace(/\s+/g, '_'),
        fieldLabel: newFieldLabel,
        fieldValue: newFieldValue,
        valueType: 'string',
        sourceConfidence: null,
      });
      resetAddFieldForm();
    }
  };

  const isAddFieldDisabled = (itemId: string) => {
    if (addingFieldTo !== itemId) return false;
    if (addFieldMode === 'select') return !selectedFieldDef;
    return !newFieldKey.trim() || !newFieldLabel.trim();
  };

  // Memoised list of field definition ids already used on a given item
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
                        <Label className="text-xs text-muted-foreground">Code</Label>
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
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.unitPrice ?? ''}
                          onChange={(e) => onUpdateItem(item.id, { unitPrice: e.target.value ? parseFloat(e.target.value) : null })}
                          className="h-8 text-sm"
                          placeholder="0.00"
                        />
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
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => saveFieldEdit(field.id)}
                                  >
                                    <Check className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
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

                          {/* Select existing field mode */}
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
                                      <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Search field definitions…" className="h-8 text-sm" />
                                      <CommandList>
                                        <CommandEmpty>No matching fields.</CommandEmpty>
                                        <CommandGroup>
                                          {(fieldDefinitions ?? [])
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
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>
                              <div className="col-span-2 sm:col-span-1">
                                <Label className="text-xs">Value</Label>
                                <Input
                                  placeholder={selectedFieldDef ? `e.g. ${selectedFieldDef.fieldKey}` : '—'}
                                  value={newFieldValue}
                                  onChange={(e) => setNewFieldValue(e.target.value)}
                                  className="h-8 text-sm"
                                  disabled={!selectedFieldDef}
                                />
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
