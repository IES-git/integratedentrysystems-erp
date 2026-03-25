import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PenLine, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep } from '@/components/estimates/wizard/CustomerStep';
import { OpeningsStep } from '@/components/estimates/wizard/OpeningsStep';
import { useToast } from '@/hooks/use-toast';
import {
  createManualEstimate,
  updateEstimate as apiUpdateEstimate,
} from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { Company } from '@/types';

const WIZARD_STEPS: WizardStep[] = [
  { id: 'customer', title: 'Customer', description: 'Assign a customer' },
  { id: 'openings', title: 'Openings', description: 'Build door and frame openings' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCompanyRow(row: any): Company {
  return {
    id: row.id,
    name: row.name,
    companyType: row.company_type ?? 'customer',
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
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // When ?id is present we are editing an existing estimate's openings
  const existingId = searchParams.get('id');
  const startStepParam = parseInt(searchParams.get('step') ?? '0', 10);
  const initialStep = Number.isFinite(startStepParam) && startStepParam > 0 ? startStepParam : 0;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStep);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
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

        if (existingId) {
          // Load the existing estimate to pre-populate customer selection
          const [estimateResult, companiesResult] = await Promise.all([
            supabase
              .from('estimates')
              .select('id, company_id')
              .eq('id', existingId)
              .single(),
            supabase.from('companies').select('*').eq('active', true).order('name'),
          ]);

          if (estimateResult.error || !estimateResult.data) {
            throw new Error('Estimate not found');
          }

          setEstimateId(existingId);
          setSelectedCustomerId(estimateResult.data.company_id ?? null);
          setNoCustomer(!estimateResult.data.company_id);

          if (companiesResult.data) {
            setCompanies(companiesResult.data.map(mapCompanyRow));
          }
        } else {
          // Create a brand-new manual estimate
          const [{ estimateId: id }, companiesResult] = await Promise.all([
            createManualEstimate(user.id),
            supabase.from('companies').select('*').eq('active', true).order('name'),
          ]);

          setEstimateId(id);

          if (companiesResult.data) {
            setCompanies(companiesResult.data.map(mapCompanyRow));
          }
        }
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
  }, [existingId]);

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

  const handleFinish = async () => {
    if (!estimateId) return;
    setSaving(true);
    try {
      await apiUpdateEstimate(estimateId, {
        companyId: noCustomer ? null : selectedCustomerId,
      });
      toast({ title: 'Estimate saved', description: 'Your estimate has been saved as a draft.' });

      if (existingId) {
        // Came here from the estimates list to manage openings — return there
        navigate('/app/estimates');
      } else {
        // Brand-new estimate — open the full review wizard on the Line Items step
        navigate(`/app/estimates/wizard?id=${estimateId}&step=1`);
      }
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
          <p className="text-sm">{existingId ? 'Loading estimate…' : 'Creating estimate…'}</p>
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
                  {existingId ? 'Manage Openings' : 'Create Estimate'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {existingId ? 'Add or edit openings for this estimate' : 'Enter line items manually'}
                </p>
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

          {currentStepIndex === 1 && estimateId && (
            <OpeningsStep
              estimateId={estimateId}
              onBack={existingId ? () => navigate('/app/estimates') : handlePrevStep}
              backLabel={existingId ? 'Back to Estimates' : 'Back to Customer'}
              onFinish={handleFinish}
              finishLabel={saving ? 'Saving…' : existingId ? 'Done' : 'Save as Draft'}
              finishLoading={saving}
            />
          )}
        </div>
      </div>
    </div>
  );
}
