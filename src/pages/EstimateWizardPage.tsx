import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep, type ExtractedCustomerData } from '@/components/estimates/wizard/CustomerStep';
import { LineItemsStep } from '@/components/estimates/wizard/LineItemsStep';
import { BatchProgress } from '@/components/estimates/wizard/BatchProgress';
import { PdfPreview } from '@/components/estimates/wizard/PdfPreview';
import { useToast } from '@/hooks/use-toast';
import {
  estimateStorage,
  estimateItemStorage,
  itemFieldStorage,
  customerStorage,
} from '@/lib/storage';
import type { Estimate, EstimateItem, ItemField, Customer } from '@/types';
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

  const [currentEstimateIndex, setCurrentEstimateIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [estimateDataMap, setEstimateDataMap] = useState<Map<string, EstimateData>>(new Map());
  const [completedEstimates, setCompletedEstimates] = useState<Set<number>>(new Set());
  const [extractedCustomer, setExtractedCustomer] = useState<ExtractedCustomerData | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(true);

  const currentEstimate = estimates[currentEstimateIndex];
  const currentData = currentEstimate ? estimateDataMap.get(currentEstimate.id) : null;

  // Load all estimates on mount
  useEffect(() => {
    if (estimateIds.length === 0) {
      navigate('/app/estimates');
      return;
    }

    const loadedEstimates: Estimate[] = [];
    const dataMap = new Map<string, EstimateData>();

    for (const id of estimateIds) {
      const est = estimateStorage.getById(id);
      if (est) {
        loadedEstimates.push(est);
        
        const items = estimateItemStorage.getByEstimateId(id);
        const itemsWithFields: LineItemWithFields[] = items.map((item) => ({
          ...item,
          fields: itemFieldStorage.getByEstimateItemId(item.id),
        }));

        dataMap.set(id, {
          estimate: est,
          lineItems: itemsWithFields,
          selectedCustomerId: est.customerId,
          noCustomer: !est.customerId,
        });
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
    setCustomers(customerStorage.getAll());

    // Simulate extracted customer from OCR for first estimate
    if (Math.random() > 0.3) {
      setExtractedCustomer({
        name: 'ABC Construction',
        contactName: 'Robert Wilson',
        email: 'rwilson@abcconstruction.com',
        phone: '(555) 123-4567',
        confidence: 0.87,
      });
    }
  }, [estimateIds.join(','), navigate, toast]);

  const handleSelectCustomer = useCallback((customerId: string | null, isNoCustomer: boolean) => {
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
  }, [currentEstimate]);

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
    estimateItemStorage.update(itemId, updates);
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    if (!currentEstimate) return;

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
    itemFieldStorage.update(fieldId, updates);
  };

  const handleAddField = (
    itemId: string,
    fieldData: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (!currentEstimate) return;

    const newField = itemFieldStorage.create(fieldData);
    setEstimateDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(currentEstimate.id);
      if (data) {
        next.set(currentEstimate.id, {
          ...data,
          lineItems: data.lineItems.map((item) =>
            item.id === itemId ? { ...item, fields: [...item.fields, newField] } : item
          ),
        });
      }
      return next;
    });
  };

  const handleDeleteField = (fieldId: string) => {
    if (!currentEstimate) return;

    itemFieldStorage.delete(fieldId);
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
  };

  const handleFinishCurrentEstimate = () => {
    if (!currentEstimate || !currentData) return;

    // Save current estimate
    estimateStorage.update(currentEstimate.id, {
      customerId: currentData.noCustomer ? null : currentData.selectedCustomerId,
    });

    // Mark as completed
    setCompletedEstimates((prev) => new Set(prev).add(currentEstimateIndex));

    // Move to next estimate or finish
    if (currentEstimateIndex < estimates.length - 1) {
      setCurrentEstimateIndex((prev) => prev + 1);
      setCurrentStepIndex(0);
      // No toast for intermediate saves - just move to next file
    } else {
      // All done
      toast({
        title: 'All estimates saved',
        description: `${estimates.length} estimate${estimates.length > 1 ? 's' : ''} saved as drafts.`,
      });
      navigate('/app/estimates');
    }
  };

  const handleSelectEstimate = (index: number) => {
    setCurrentEstimateIndex(index);
    setCurrentStepIndex(0);
  };

  const handleCancel = () => {
    navigate('/app/estimates');
  };

  if (!currentEstimate || !currentData) {
    return null;
  }

  const isLastEstimate = currentEstimateIndex === estimates.length - 1;
  const allCompleted = completedEstimates.size === estimates.length - 1 && currentStepIndex === WIZARD_STEPS.length - 1;

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className={cn(
        'flex-1 overflow-auto transition-all duration-300',
        showPdfPreview && currentStepIndex === 1 ? 'lg:pr-0' : ''
      )}>
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="mb-4 -ml-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Estimates
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-3xl tracking-wide">Review Estimate</h1>
                <p className="text-sm text-muted-foreground truncate">
                  {currentEstimate.originalPdfName}
                </p>
              </div>
              {/* PDF Preview Toggle (step 2 only) */}
              {currentStepIndex === 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPdfPreview(!showPdfPreview)}
                  className="hidden lg:flex"
                >
                  {showPdfPreview ? (
                    <>
                      <PanelLeftClose className="mr-2 h-4 w-4" />
                      Hide PDF
                    </>
                  ) : (
                    <>
                      <PanelLeft className="mr-2 h-4 w-4" />
                      Show PDF
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
              customers={customers}
              selectedCustomerId={currentData.selectedCustomerId}
              noCustomer={currentData.noCustomer}
              onSelectCustomer={handleSelectCustomer}
              onNext={handleNextStep}
            />
          )}

          {currentStepIndex === 1 && (
            <>
              {/* Mobile PDF Preview */}
              <div className="lg:hidden mb-6">
                <PdfPreview
                  pdfUrl={currentEstimate.originalPdfUrl}
                  fileName={currentEstimate.originalPdfName}
                  className="h-64"
                />
              </div>

              <LineItemsStep
                lineItems={currentData.lineItems}
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

      {/* PDF Preview Panel (desktop, step 2 only) */}
      {currentStepIndex === 1 && showPdfPreview && (
        <div className="hidden lg:flex w-[45%] border-l bg-muted/30 p-4">
          <PdfPreview
            pdfUrl={currentEstimate.originalPdfUrl}
            fileName={currentEstimate.originalPdfName}
            className="flex-1"
            onClose={() => setShowPdfPreview(false)}
          />
        </div>
      )}
    </div>
  );
}
