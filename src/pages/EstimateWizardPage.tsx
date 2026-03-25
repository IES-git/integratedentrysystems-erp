import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, PanelLeftClose, PanelLeft, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep, type ExtractedCustomerData } from '@/components/estimates/wizard/CustomerStep';
import { LineItemsStep } from '@/components/estimates/wizard/LineItemsStep';
import { BatchProgress } from '@/components/estimates/wizard/BatchProgress';
import { FilePreview } from '@/components/estimates/wizard/PdfPreview';
import { useToast } from '@/hooks/use-toast';
import {
  getEstimateWithItems,
  getEstimateFileUrl,
  getEstimateOpenings,
  updateEstimate as apiUpdateEstimate,
  updateEstimateItem as apiUpdateEstimateItem,
  updateItemField as apiUpdateItemField,
  addItemField as apiAddItemField,
  deleteItemField as apiDeleteItemField,
  addEstimateItem as apiAddEstimateItem,
  deleteEstimateItem as apiDeleteEstimateItem,
  getFieldDefinitions,
  getItemTypes,
} from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { Estimate, EstimateItem, ItemField, Company, FieldDefinition, ItemType, EstimateOpeningWithItems } from '@/types';
import { cn } from '@/lib/utils';

interface LineItemWithFields extends EstimateItem {
  fields: ItemField[];
}

interface EstimateData {
  estimate: Estimate;
  lineItems: LineItemWithFields[];
  selectedCustomerId: string | null;
  noCustomer: boolean;
}

const WIZARD_STEPS: WizardStep[] = [
  { id: 'customer', title: 'Customer', description: 'Confirm customer assignment' },
  { id: 'line-items', title: 'Line Items', description: 'Verify extracted data' },
];

// Map Supabase companies row to our Company type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCompanyRow(row: any): Company {
  return {
    id: row.id,
    name: row.name,
    billingAddress: row.billing_address ?? null,
    billingCity: row.billing_city ?? null,
    billingState: row.billing_state ?? null,
    billingZip: row.billing_zip ?? null,
    shippingAddress: row.shipping_address ?? null,
    shippingCity: row.shipping_city ?? null,
    shippingState: row.shipping_state ?? null,
    shippingZip: row.shipping_zip ?? null,
    notes: row.notes ?? null,
    active: row.active,
    settings: row.settings ?? { costMultiplier: 1.0, paymentTerms: null, defaultTemplateId: null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function EstimateWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Parse estimate IDs from URL (supports both single 'id' and multiple 'ids')
  const estimateIds = (() => {
    const singleId = searchParams.get('id');
    const multipleIds = searchParams.get('ids');
    if (multipleIds) return multipleIds.split(',').filter(Boolean);
    if (singleId) return [singleId];
    return [];
  })();

  // Support ?step=1 to open directly on a specific wizard step (e.g. Line Items)
  const startStepParam = parseInt(searchParams.get('step') ?? '0', 10);
  const initialStep = Number.isFinite(startStepParam) && startStepParam > 0 ? startStepParam : 0;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentEstimateIndex, setCurrentEstimateIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStep);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [estimateDataMap, setEstimateDataMap] = useState<Map<string, EstimateData>>(new Map());
  const [fileUrls, setFileUrls] = useState<Map<string, string>>(new Map());
  const [completedEstimates, setCompletedEstimates] = useState<Set<number>>(new Set());
  const [extractedCustomer, setExtractedCustomer] = useState<ExtractedCustomerData | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([]);
  const [openingsByEstimate, setOpeningsByEstimate] = useState<Map<string, EstimateOpeningWithItems[]>>(new Map());

  // Add Item dialog state
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [addItemMode, setAddItemMode] = useState<'existing' | 'new'>('existing');
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(false);
  const [selectedItemType, setSelectedItemType] = useState<ItemType | null>(null);
  const [itemTypePopoverOpen, setItemTypePopoverOpen] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState(1);
  const [addingItem, setAddingItem] = useState(false);

  const currentEstimate = estimates[currentEstimateIndex];
  const currentData = currentEstimate ? estimateDataMap.get(currentEstimate.id) : null;
  const currentFileUrl = currentEstimate ? fileUrls.get(currentEstimate.id) : undefined;

  // Load all estimates from Supabase on mount
  useEffect(() => {
    if (estimateIds.length === 0) {
      navigate('/app/estimates');
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const loadedEstimates: Estimate[] = [];
        const dataMap = new Map<string, EstimateData>();
        const urlMap = new Map<string, string>();

        // Load all estimates with their items and fields
        for (const id of estimateIds) {
          const result = await getEstimateWithItems(id);
          if (result) {
            loadedEstimates.push(result.estimate);

            dataMap.set(id, {
              estimate: result.estimate,
              lineItems: result.items,
              selectedCustomerId: result.estimate.companyId,
              noCustomer: !result.estimate.companyId,
            });

            // Get signed URL for file preview
            try {
              const signedUrl = await getEstimateFileUrl(result.estimate.originalFileUrl);
              urlMap.set(id, signedUrl);
            } catch {
              // File URL generation failed – the preview will show an error state
              console.warn(`Failed to generate file URL for estimate ${id}`);
            }
          }
        }

        if (loadedEstimates.length === 0) {
          toast({
            title: 'Estimates not found',
            description: 'The requested estimates could not be found.',
            variant: 'destructive',
          });
          navigate('/app/estimates');
          return;
        }

        setEstimates(loadedEstimates);
        setEstimateDataMap(dataMap);
        setFileUrls(urlMap);

        // Load openings for all estimates
        try {
          const openingsMap = new Map<string, EstimateOpeningWithItems[]>();
          await Promise.all(
            loadedEstimates.map(async (est) => {
              const estimateOpenings = await getEstimateOpenings(est.id);
              if (estimateOpenings.length > 0) {
                openingsMap.set(est.id, estimateOpenings);
              }
            })
          );
          setOpeningsByEstimate(openingsMap);
        } catch {
          console.warn('Could not load openings');
        }

        // Load companies and field definitions in parallel
        try {
          const [companiesResult, fieldDefsResult] = await Promise.all([
            supabase.from('companies').select('*').eq('active', true).order('name'),
            getFieldDefinitions('approved'),
          ]);

          if (companiesResult.data && companiesResult.data.length > 0) {
            setCompanies(companiesResult.data.map(mapCompanyRow));
          }

          setFieldDefinitions(fieldDefsResult);
        } catch {
          console.warn('Could not load companies or field definitions from Supabase');
        }

        // Build extracted customer data from the first estimate's OCR results
        const firstEstimate = loadedEstimates[0];
        if (firstEstimate.extractedCustomerName) {
          setExtractedCustomer({
            name: firstEstimate.extractedCustomerName,
            contactName: firstEstimate.extractedCustomerContact || undefined,
            email: firstEstimate.extractedCustomerEmail || undefined,
            phone: firstEstimate.extractedCustomerPhone || undefined,
            confidence: firstEstimate.customerConfidence ?? 0,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load estimates';
        setLoadError(message);
        toast({
          title: 'Error loading estimates',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateIds.join(',')]);

  // When switching estimates, update extracted customer from that estimate
  useEffect(() => {
    if (!currentEstimate) return;

    if (currentEstimate.extractedCustomerName) {
      setExtractedCustomer({
        name: currentEstimate.extractedCustomerName,
        contactName: currentEstimate.extractedCustomerContact || undefined,
        email: currentEstimate.extractedCustomerEmail || undefined,
        phone: currentEstimate.extractedCustomerPhone || undefined,
        confidence: currentEstimate.customerConfidence ?? 0,
      });
    } else {
      setExtractedCustomer(null);
    }
  }, [currentEstimate]);

  const handleSelectCustomer = useCallback(
    (customerId: string | null, isNoCustomer: boolean) => {
      if (!currentEstimate) return;

      setEstimateDataMap((prev) => {
        const next = new Map(prev);
        const data = next.get(currentEstimate.id);
        if (data) {
          next.set(currentEstimate.id, {
            ...data,
            selectedCustomerId: customerId,
            noCustomer: isNoCustomer,
          });
        }
        return next;
      });
    },
    [currentEstimate]
  );

  const handleNextStep = () => {
    if (currentStepIndex < WIZARD_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleUpdateItem = (itemId: string, updates: Partial<EstimateItem>) => {
    if (!currentEstimate) return;

    // Optimistic local update
    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.map((item) =>
            item.id === itemId ? { ...item, ...updates } : item
          ),
        });
      }
      return next;
    });

    // Persist to Supabase
    apiUpdateEstimateItem(itemId, updates).catch(() => {
      toast({
        title: 'Error',
        description: 'Failed to save item changes.',
        variant: 'destructive',
      });
    });
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    if (!currentEstimate) return;

    // Optimistic local update
    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.map((item) => ({
            ...item,
            fields: item.fields.map((field) =>
              field.id === fieldId ? { ...field, ...updates } : field
            ),
          })),
        });
      }
      return next;
    });

    // Persist to Supabase
    apiUpdateItemField(fieldId, updates).catch(() => {
      toast({
        title: 'Error',
        description: 'Failed to save field changes.',
        variant: 'destructive',
      });
    });
  };

  const handleAddField = async (
    itemId: string,
    fieldData: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (!currentEstimate) return;

    try {
      // Create the field in Supabase and get the real record back
      const newField = await apiAddItemField(itemId, {
        fieldKey: fieldData.fieldKey,
        fieldLabel: fieldData.fieldLabel,
        fieldValue: fieldData.fieldValue,
        valueType: fieldData.valueType,
        fieldDefinitionId: fieldData.fieldDefinitionId || undefined,
      });

      setEstimateDataMap((prev) => {
        const next = new Map(prev);
        const data = next.get(currentEstimate.id);
        if (data) {
          next.set(currentEstimate.id, {
            ...data,
            lineItems: data.lineItems.map((item) =>
              item.id === itemId
                ? { ...item, fields: [...item.fields, newField] }
                : item
            ),
          });
        }
        return next;
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to add field.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteField = (fieldId: string) => {
    if (!currentEstimate) return;

    // Optimistic local remove
    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.map((item) => ({
            ...item,
            fields: item.fields.filter((f) => f.id !== fieldId),
          })),
        });
      }
      return next;
    });

    // Persist to Supabase
    apiDeleteItemField(fieldId).catch(() => {
      toast({
        title: 'Error',
        description: 'Failed to delete field.',
        variant: 'destructive',
      });
    });
  };

  const resetAddItemDialog = () => {
    setAddItemMode('existing');
    setSelectedItemType(null);
    setItemTypePopoverOpen(false);
    setNewItemLabel('');
    setNewItemCode('');
    setNewItemQuantity(1);
  };

  const handleAddItem = async () => {
    setAddItemDialogOpen(true);
    setItemTypesLoading(true);
    try {
      const types = await getItemTypes();
      setItemTypes(types);
    } catch {
      // Non-fatal — fall back to empty list so user can still create manually
    } finally {
      setItemTypesLoading(false);
    }
  };

  const handleConfirmAddItem = async () => {
    if (!currentEstimate) return;
    setAddingItem(true);
    try {
      let itemLabel: string;
      let canonicalCode: string | undefined;
      let quantity: number;

      if (addItemMode === 'existing' && selectedItemType) {
        itemLabel = selectedItemType.itemLabel;
        canonicalCode = selectedItemType.canonicalCode;
        quantity = 1;
      } else {
        if (!newItemLabel.trim()) return;
        itemLabel = newItemLabel.trim();
        canonicalCode = newItemCode.trim() || undefined;
        quantity = newItemQuantity || 1;
      }

      const currentItems = estimateDataMap.get(currentEstimate.id)?.lineItems ?? [];
      const newItem = await apiAddEstimateItem(currentEstimate.id, {
        itemLabel,
        canonicalCode,
        quantity,
        sortOrder: currentItems.length,
      });

      setEstimateDataMap((prev) => {
        const next = new Map(prev);
        const data = next.get(currentEstimate.id);
        if (data) {
          next.set(currentEstimate.id, {
            ...data,
            lineItems: [...data.lineItems, { ...newItem, fields: [] }],
          });
        }
        return next;
      });

      setAddItemDialogOpen(false);
      resetAddItemDialog();
    } catch {
      toast({ title: 'Error', description: 'Failed to add line item.', variant: 'destructive' });
    } finally {
      setAddingItem(false);
    }
  };

  const handleDeleteItem = (itemId: string) => {
    if (!currentEstimate) return;

    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.filter((item) => item.id !== itemId),
        });
      }
      return next;
    });

    apiDeleteEstimateItem(itemId).catch(() => {
      toast({ title: 'Error', description: 'Failed to delete line item.', variant: 'destructive' });
    });
  };

  const handleMoveToOpening = (itemId: string, openingId: string | null) => {
    if (!currentEstimate) return;

    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.map((item) =>
            item.id === itemId ? { ...item, openingId } : item
          ),
        });
      }
      return next;
    });

    apiUpdateEstimateItem(itemId, { openingId }).catch(() => {
      toast({ title: 'Error', description: 'Failed to move item to opening.', variant: 'destructive' });
    });
  };

  const handleFinishCurrentEstimate = async () => {
    if (!currentEstimate || !currentData) return;

    try {
      let finalCustomerId = currentData.selectedCustomerId;

      // If no company selected but we have extracted customer data, create a new company
      if (!currentData.noCustomer && !finalCustomerId && currentEstimate.extractedCustomerName) {
        const { data: newCompany, error: companyError } = await supabase
          .from('companies')
          .insert({
            name: currentEstimate.extractedCustomerName,
            notes: [
              currentEstimate.extractedCustomerContact ? `Contact: ${currentEstimate.extractedCustomerContact}` : null,
              currentEstimate.extractedCustomerEmail ? `Email: ${currentEstimate.extractedCustomerEmail}` : null,
              currentEstimate.extractedCustomerPhone ? `Phone: ${currentEstimate.extractedCustomerPhone}` : null,
            ].filter(Boolean).join('\n') || null,
          })
          .select('id')
          .single();

        if (companyError) {
          throw new Error(`Failed to create company: ${companyError.message}`);
        }

        if (newCompany) {
          finalCustomerId = newCompany.id;
          toast({
            title: 'Company created',
            description: `${currentEstimate.extractedCustomerName} has been added to your customer database.`,
          });
        }
      }

      // Save company assignment to Supabase
      await apiUpdateEstimate(currentEstimate.id, {
        companyId: currentData.noCustomer ? null : finalCustomerId,
      });

      // Mark as completed
      setCompletedEstimates((prev) => new Set(prev).add(currentEstimateIndex));

      // Move to next estimate or finish
      if (currentEstimateIndex < estimates.length - 1) {
        setCurrentEstimateIndex((prev) => prev + 1);
        setCurrentStepIndex(0);
      } else {
        // All done
        toast({
          title: 'All estimates saved',
          description: `${estimates.length} estimate${estimates.length > 1 ? 's' : ''} saved as drafts.`,
        });
        navigate('/app/estimates');
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save estimate. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSelectEstimate = (index: number) => {
    setCurrentEstimateIndex(index);
    setCurrentStepIndex(0);
  };

  const handleCancel = () => {
    navigate('/app/estimates');
  };

  const handleManageOpenings = () => {
    if (!currentEstimate) return;
    navigate(`/app/estimates/create?id=${currentEstimate.id}&step=1`);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading estimate data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">Failed to load estimates</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/app/estimates')}>
            Back to Estimates
          </Button>
        </div>
      </div>
    );
  }

  if (!currentEstimate || !currentData) {
    return null;
  }

  const isLastEstimate = currentEstimateIndex === estimates.length - 1;
  const previewLabel = currentEstimate.fileType === 'image' ? 'Image' : 'PDF';

  const isConfirmDisabled =
    addingItem ||
    (addItemMode === 'existing' && !selectedItemType) ||
    (addItemMode === 'new' && !newItemLabel.trim());

  return (
    <div className="flex h-full overflow-hidden">
      {/* Add Line Item Dialog */}
      <Dialog
        open={addItemDialogOpen}
        onOpenChange={(open) => {
          setAddItemDialogOpen(open);
          if (!open) resetAddItemDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Add Line Item</DialogTitle>
            <DialogDescription>
              Select an existing item from your catalog or create a new one from scratch.
            </DialogDescription>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 rounded-md bg-muted w-fit mt-1">
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                addItemMode === 'existing'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setAddItemMode('existing')}
            >
              Select existing
            </button>
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                addItemMode === 'new'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setAddItemMode('new')}
            >
              Create new
            </button>
          </div>

          {/* Existing item picker */}
          {addItemMode === 'existing' && (
            <div className="space-y-3 mt-2">
              <div className="space-y-1.5">
                <Label>Item</Label>
                <Popover open={itemTypePopoverOpen} onOpenChange={setItemTypePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                      disabled={itemTypesLoading}
                    >
                      <span className="truncate">
                        {itemTypesLoading
                          ? 'Loading items…'
                          : selectedItemType
                          ? selectedItemType.itemLabel
                          : 'Search items…'}
                      </span>
                      {itemTypesLoading ? (
                        <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
                      ) : (
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search items…" className="h-9" />
                      <CommandList>
                        <CommandEmpty>No items found.</CommandEmpty>
                        <CommandGroup>
                          {itemTypes.map((it) => (
                            <CommandItem
                              key={it.canonicalCode}
                              value={`${it.itemLabel} ${it.canonicalCode}`}
                              onSelect={() => {
                                setSelectedItemType(it);
                                setItemTypePopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  selectedItemType?.canonicalCode === it.canonicalCode
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                              <div className="flex flex-col">
                                <span className="text-sm">{it.itemLabel}</span>
                                <span className="text-[11px] font-mono text-muted-foreground">
                                  {it.canonicalCode}
                                  <span className="ml-2 non-mono font-sans">
                                    · {it.usageCount} {it.usageCount === 1 ? 'use' : 'uses'}
                                  </span>
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {selectedItemType && (
                <div className="rounded-md bg-muted/50 border px-3 py-2.5 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Code</span>
                    <span className="font-mono text-xs">{selectedItemType.canonicalCode}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Usage</span>
                    <span>{selectedItemType.usageCount} {selectedItemType.usageCount === 1 ? 'time' : 'times'}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* New item form */}
          {addItemMode === 'new' && (
            <div className="space-y-3 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="review-new-item-label">Item Label <span className="text-destructive">*</span></Label>
                <Input
                  id="review-new-item-label"
                  placeholder="e.g. Hollow Metal Door"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="review-new-item-code">Canonical Code</Label>
                  <Input
                    id="review-new-item-code"
                    placeholder="e.g. HMD-3070"
                    value={newItemCode}
                    onChange={(e) => setNewItemCode(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="review-new-item-qty">Quantity</Label>
                  <Input
                    id="review-new-item-qty"
                    type="number"
                    min={1}
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setAddItemDialogOpen(false);
                resetAddItemDialog();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmAddItem} disabled={isConfirmDisabled}>
              {addingItem && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content — independently scrollable left panel */}
      <div
        className={cn(
          'flex-1 min-w-0 overflow-y-auto transition-all duration-300',
        )}
      >
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="mb-4 -ml-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Estimates
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl tracking-wide">Review Estimate</h1>
                <p className="text-sm text-muted-foreground truncate">
                  {currentEstimate.originalFileName}
                </p>
              </div>
              {/* Preview Toggle (step 2 only) */}
              {currentStepIndex === 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="hidden lg:flex"
                >
                  {showPreview ? (
                    <>
                      <PanelLeftClose className="mr-2 h-4 w-4" />
                      Hide {previewLabel}
                    </>
                  ) : (
                    <>
                      <PanelLeft className="mr-2 h-4 w-4" />
                      Show {previewLabel}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Batch Progress (if multiple files) */}
          <BatchProgress
            estimates={estimates}
            currentIndex={currentEstimateIndex}
            onSelectEstimate={handleSelectEstimate}
            completedIndices={completedEstimates}
          />

          {/* Steps Indicator */}
          <WizardSteps steps={WIZARD_STEPS} currentStepIndex={currentStepIndex} />

          {/* Step Content */}
          {currentStepIndex === 0 && (
            <CustomerStep
              extractedCustomer={extractedCustomer}
              companies={companies}
              selectedCustomerId={currentData.selectedCustomerId}
              noCustomer={currentData.noCustomer}
              onSelectCustomer={handleSelectCustomer}
              onNext={handleNextStep}
            />
          )}

          {currentStepIndex === 1 && (
            <>
              {/* Mobile File Preview */}
              {currentFileUrl && (
                <div className="lg:hidden mb-6">
                  <FilePreview
                    fileUrl={currentFileUrl}
                    fileName={currentEstimate.originalFileName}
                    fileType={currentEstimate.fileType === 'image' ? 'image' : 'pdf'}
                    className="h-64"
                  />
                </div>
              )}

              <LineItemsStep
                lineItems={currentData.lineItems}
                totalPrice={currentData.estimate.totalPrice}
                onUpdateItem={handleUpdateItem}
                onUpdateField={handleUpdateField}
                onAddField={handleAddField}
                onDeleteField={handleDeleteField}
                onBack={handlePrevStep}
                onFinish={handleFinishCurrentEstimate}
                finishLabel={
                  isLastEstimate
                    ? `Save ${estimates.length > 1 ? 'All ' : ''}as Draft${estimates.length > 1 ? 's' : ''}`
                    : `Save & Next (${currentEstimateIndex + 2}/${estimates.length})`
                }
                onAddItem={handleAddItem}
                onDeleteItem={handleDeleteItem}
                fieldDefinitions={fieldDefinitions}
                openings={currentEstimate ? openingsByEstimate.get(currentEstimate.id) : undefined}
                onMoveToOpening={handleMoveToOpening}
                onManageOpenings={handleManageOpenings}
              />
            </>
          )}
        </div>
      </div>

      {/* File Preview Panel (desktop, step 2 only) — independently scrollable right panel */}
      {currentStepIndex === 1 && showPreview && currentFileUrl && (
        <div className="hidden lg:flex lg:flex-col w-[45%] shrink-0 border-l bg-muted/30 h-full overflow-hidden">
          <FilePreview
            fileUrl={currentFileUrl}
            fileName={currentEstimate.originalFileName}
            fileType={currentEstimate.fileType === 'image' ? 'image' : 'pdf'}
            className="flex-1 min-h-0"
            onClose={() => setShowPreview(false)}
          />
        </div>
      )}
    </div>
  );
}
