import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PenLine, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep } from '@/components/estimates/wizard/CustomerStep';
import { LineItemsStep } from '@/components/estimates/wizard/LineItemsStep';
import { useToast } from '@/hooks/use-toast';
import {
  createManualEstimate,
  updateEstimate as apiUpdateEstimate,
  updateEstimateItem as apiUpdateEstimateItem,
  updateItemField as apiUpdateItemField,
  addItemField as apiAddItemField,
  deleteItemField as apiDeleteItemField,
  addEstimateItem as apiAddEstimateItem,
  deleteEstimateItem as apiDeleteEstimateItem,
  getFieldDefinitions,
} from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { EstimateItem, ItemField, FieldDefinition, Company } from '@/types';

interface LineItemWithFields extends EstimateItem {
  fields: ItemField[];
}

const WIZARD_STEPS: WizardStep[] = [
  { id: 'customer', title: 'Customer', description: 'Assign a customer' },
  { id: 'line-items', title: 'Line Items', description: 'Add line items and fields' },
];

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

export default function ManualEstimateWizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [lineItems, setLineItems] = useState<LineItemWithFields[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          navigate('/login');
          return;
        }

        const [{ estimateId: id }, companiesResult, fieldDefsResult] = await Promise.all([
          createManualEstimate(user.id),
          supabase.from('companies').select('*').eq('active', true).order('name'),
          getFieldDefinitions('approved'),
        ]);

        setEstimateId(id);

        if (companiesResult.data) {
          setCompanies(companiesResult.data.map(mapCompanyRow));
        }

        setFieldDefinitions(fieldDefsResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initialise estimate';
        setLoadError(message);
        toast({ title: 'Error', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectCustomer = useCallback((customerId: string | null, isNoCustomer: boolean) => {
    setSelectedCustomerId(customerId);
    setNoCustomer(isNoCustomer);
  }, []);

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
    apiUpdateEstimateItem(itemId, updates).catch(() => {
      toast({ title: 'Error', description: 'Failed to save item changes.', variant: 'destructive' });
    });
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    setLineItems((prev) =>
      prev.map((item) => ({
        ...item,
        fields: item.fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)),
      }))
    );
    apiUpdateItemField(fieldId, updates).catch(() => {
      toast({ title: 'Error', description: 'Failed to save field changes.', variant: 'destructive' });
    });
  };

  const handleAddField = async (
    itemId: string,
    fieldData: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    try {
      const newField = await apiAddItemField(itemId, {
        fieldKey: fieldData.fieldKey,
        fieldLabel: fieldData.fieldLabel,
        fieldValue: fieldData.fieldValue,
        valueType: fieldData.valueType,
        fieldDefinitionId: fieldData.fieldDefinitionId || undefined,
      });
      setLineItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, fields: [...item.fields, newField] } : item
        )
      );
    } catch {
      toast({ title: 'Error', description: 'Failed to add field.', variant: 'destructive' });
    }
  };

  const handleDeleteField = (fieldId: string) => {
    setLineItems((prev) =>
      prev.map((item) => ({
        ...item,
        fields: item.fields.filter((f) => f.id !== fieldId),
      }))
    );
    apiDeleteItemField(fieldId).catch(() => {
      toast({ title: 'Error', description: 'Failed to delete field.', variant: 'destructive' });
    });
  };

  const handleAddItem = async () => {
    if (!estimateId) return;
    try {
      const newItem = await apiAddEstimateItem(estimateId, {
        itemLabel: 'New Item',
        quantity: 1,
        sortOrder: lineItems.length,
      });
      setLineItems((prev) => [...prev, { ...newItem, fields: [] }]);
    } catch {
      toast({ title: 'Error', description: 'Failed to add line item.', variant: 'destructive' });
    }
  };

  const handleDeleteItem = (itemId: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== itemId));
    apiDeleteEstimateItem(itemId).catch(() => {
      toast({ title: 'Error', description: 'Failed to delete line item.', variant: 'destructive' });
    });
  };

  const handleFinish = async () => {
    if (!estimateId) return;
    setSaving(true);
    try {
      await apiUpdateEstimate(estimateId, {
        companyId: noCustomer ? null : selectedCustomerId,
      });
      toast({ title: 'Estimate saved', description: 'Your estimate has been saved as a draft.' });
      navigate('/app/estimates');
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save estimate.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Creating estimate…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">Failed to create estimate</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/app/estimates')}>
            Back to Estimates
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/app/estimates')}
              className="mb-4 -ml-2"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Estimates
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10">
                <PenLine className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl tracking-wide">
                  Create Estimate
                </h1>
                <p className="text-sm text-muted-foreground">Enter line items manually</p>
              </div>
            </div>
          </div>

          {/* Steps Indicator */}
          <WizardSteps steps={WIZARD_STEPS} currentStepIndex={currentStepIndex} />

          {/* Step Content */}
          {currentStepIndex === 0 && (
            <CustomerStep
              extractedCustomer={null}
              companies={companies}
              selectedCustomerId={selectedCustomerId}
              noCustomer={noCustomer}
              onSelectCustomer={handleSelectCustomer}
              onNext={handleNextStep}
            />
          )}

          {currentStepIndex === 1 && (
            <LineItemsStep
              lineItems={lineItems}
              totalPrice={null}
              onUpdateItem={handleUpdateItem}
              onUpdateField={handleUpdateField}
              onAddField={handleAddField}
              onDeleteField={handleDeleteField}
              onBack={handlePrevStep}
              onFinish={handleFinish}
              finishLabel={saving ? 'Saving…' : 'Save as Draft'}
              onAddItem={handleAddItem}
              onDeleteItem={handleDeleteItem}
              fieldDefinitions={fieldDefinitions}
            />
          )}
        </div>
      </div>
    </div>
  );
}
