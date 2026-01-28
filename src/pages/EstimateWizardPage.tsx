import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep, type ExtractedCustomerData } from '@/components/estimates/wizard/CustomerStep';
import { LineItemsStep } from '@/components/estimates/wizard/LineItemsStep';
import { useToast } from '@/hooks/use-toast';
import {
  estimateStorage,
  estimateItemStorage,
  itemFieldStorage,
  customerStorage,
} from '@/lib/storage';
import type { Estimate, EstimateItem, ItemField, Customer } from '@/types';

interface LineItemWithFields extends EstimateItem {
  fields: ItemField[];
}

const WIZARD_STEPS: WizardStep[] = [
  { id: 'customer', title: 'Customer', description: 'Confirm customer assignment' },
  { id: 'line-items', title: 'Line Items', description: 'Verify extracted data' },
];

export default function EstimateWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const estimateId = searchParams.get('id');

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lineItems, setLineItems] = useState<LineItemWithFields[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [extractedCustomer, setExtractedCustomer] = useState<ExtractedCustomerData | null>(null);

  // Load data on mount
  useEffect(() => {
    if (!estimateId) {
      navigate('/app/estimates');
      return;
    }

    const est = estimateStorage.getById(estimateId);
    if (!est) {
      toast({
        title: 'Estimate not found',
        description: 'The requested estimate could not be found.',
        variant: 'destructive',
      });
      navigate('/app/estimates');
      return;
    }

    setEstimate(est);
    setSelectedCustomerId(est.customerId);
    setNoCustomer(!est.customerId);

    // Load customers
    setCustomers(customerStorage.getAll());

    // Load line items with fields
    const items = estimateItemStorage.getByEstimateId(estimateId);
    const itemsWithFields: LineItemWithFields[] = items.map((item) => ({
      ...item,
      fields: itemFieldStorage.getByEstimateItemId(item.id),
    }));
    setLineItems(itemsWithFields);

    // Simulate extracted customer from OCR (in real implementation, this would come from OCR)
    // For demo, randomly decide if customer was found
    if (Math.random() > 0.3) {
      setExtractedCustomer({
        name: 'ABC Construction',
        contactName: 'Robert Wilson',
        email: 'rwilson@abcconstruction.com',
        phone: '(555) 123-4567',
        confidence: 0.87,
      });
    }
  }, [estimateId, navigate, toast]);

  const handleSelectCustomer = (customerId: string | null, isNoCustomer: boolean) => {
    setSelectedCustomerId(customerId);
    setNoCustomer(isNoCustomer);
  };

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
    setLineItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...updates } : item))
    );
    estimateItemStorage.update(itemId, updates);
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    setLineItems((prev) =>
      prev.map((item) => ({
        ...item,
        fields: item.fields.map((field) =>
          field.id === fieldId ? { ...field, ...updates } : field
        ),
      }))
    );
    itemFieldStorage.update(fieldId, updates);
  };

  const handleAddField = (
    itemId: string,
    fieldData: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    const newField = itemFieldStorage.create(fieldData);
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, fields: [...item.fields, newField] } : item
      )
    );
  };

  const handleDeleteField = (fieldId: string) => {
    itemFieldStorage.delete(fieldId);
    setLineItems((prev) =>
      prev.map((item) => ({
        ...item,
        fields: item.fields.filter((f) => f.id !== fieldId),
      }))
    );
  };

  const handleFinish = () => {
    if (!estimate) return;

    // Update estimate with customer selection
    estimateStorage.update(estimate.id, {
      customerId: noCustomer ? null : selectedCustomerId,
    });

    toast({
      title: 'Estimate saved',
      description: 'The estimate has been saved as a draft.',
    });

    navigate('/app/estimates');
  };

  const handleCancel = () => {
    navigate('/app/estimates');
  };

  if (!estimate) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
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
          <div>
            <h1 className="font-display text-3xl tracking-wide">Review Estimate</h1>
            <p className="text-sm text-muted-foreground">{estimate.originalPdfName}</p>
          </div>
        </div>
      </div>

      {/* Steps Indicator */}
      <WizardSteps steps={WIZARD_STEPS} currentStepIndex={currentStepIndex} />

      {/* Step Content */}
      {currentStepIndex === 0 && (
        <CustomerStep
          extractedCustomer={extractedCustomer}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          noCustomer={noCustomer}
          onSelectCustomer={handleSelectCustomer}
          onNext={handleNextStep}
        />
      )}

      {currentStepIndex === 1 && (
        <LineItemsStep
          lineItems={lineItems}
          onUpdateItem={handleUpdateItem}
          onUpdateField={handleUpdateField}
          onAddField={handleAddField}
          onDeleteField={handleDeleteField}
          onBack={handlePrevStep}
          onFinish={handleFinish}
        />
      )}
    </div>
  );
}
