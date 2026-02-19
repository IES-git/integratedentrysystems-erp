import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep, type ExtractedCustomerData } from '@/components/estimates/wizard/CustomerStep';
import { LineItemsStep } from '@/components/estimates/wizard/LineItemsStep';
import { BatchProgress } from '@/components/estimates/wizard/BatchProgress';
import { FilePreview } from '@/components/estimates/wizard/PdfPreview';
import { useToast } from '@/hooks/use-toast';
import {
  getEstimateWithItems,
  getEstimateFileUrl,
  updateEstimate as apiUpdateEstimate,
  updateEstimateItem as apiUpdateEstimateItem,
  updateItemField as apiUpdateItemField,
  addItemField as apiAddItemField,
  deleteItemField as apiDeleteItemField,
} from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { Estimate, EstimateItem, ItemField, Company } from '@/types';
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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentEstimateIndex, setCurrentEstimateIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [estimateDataMap, setEstimateDataMap] = useState<Map<string, EstimateData>>(new Map());
  const [fileUrls, setFileUrls] = useState<Map<string, string>>(new Map());
  const [completedEstimates, setCompletedEstimates] = useState<Set<number>>(new Set());
  const [extractedCustomer, setExtractedCustomer] = useState<ExtractedCustomerData | null>(null);
  const [showPreview, setShowPreview] = useState(true);

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

        // Load companies from Supabase
        try {
          const { data: companiesData } = await supabase
            .from('companies')
            .select('*')
            .eq('active', true)
            .order('name');

          if (companiesData && companiesData.length > 0) {
            setCompanies(companiesData.map(mapCompanyRow));
          }
        } catch {
          console.warn('Could not load companies from Supabase');
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

  return (
    <div className="flex h-full overflow-hidden">
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
