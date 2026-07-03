import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PenLine, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { CustomerStep } from '@/components/estimates/wizard/CustomerStep';
import { JobSetupStep } from '@/components/estimates/wizard/JobSetupStep';
import { OpeningsStep } from '@/components/estimates/wizard/OpeningsStep';
import { ReviewStep } from '@/components/estimates/wizard/ReviewStep';
import { useToast } from '@/hooks/use-toast';
import {
  createManualEstimate,
  getEstimate,
  updateEstimate as apiUpdateEstimate,
  getEstimateOpenings,
} from '@/lib/estimates-api';
import {
  loadEstimateLinesByOpening,
} from '@/lib/cpq/estimate-lines-api';
import { estimateGrandTotal } from '@/lib/cpq/opening-totals';
import type { BuilderStepTarget } from '@/lib/cpq/completeness';
import { supabase } from '@/lib/supabase';
import type { Company, Estimate, EstimateJobInfo } from '@/types';

const WIZARD_STEPS: WizardStep[] = [
  { id: 'customer', title: 'Customer', description: 'Assign a customer' },
  { id: 'job', title: 'Job Setup', description: 'Project details' },
  { id: 'openings', title: 'Openings', description: 'Build door and frame openings' },
  { id: 'review', title: 'Review', description: 'Review pricing and totals' },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyJobInfo(): EstimateJobInfo {
  return {
    jobName: null,
    jobLocation: null,
    jobNumber: null,
    customerPo: null,
    quoteDate: todayIsoDate(),
    shippingMethod: null,
    terms: null,
    delivery: null,
    shipToSource: 'customer_shipping',
    shipToAddress: null,
    shipToCity: null,
    shipToState: null,
    shipToZip: null,
    customerContactId: null,
    customerRepName: null,
    customerRepPhone: null,
    customerRepEmail: null,
    internalNotes: null,
  };
}

function jobInfoFromEstimate(estimate: Estimate): EstimateJobInfo {
  return {
    jobName: estimate.jobName,
    jobLocation: estimate.jobLocation,
    jobNumber: estimate.jobNumber,
    customerPo: estimate.customerPo,
    quoteDate: estimate.quoteDate ?? todayIsoDate(),
    shippingMethod: estimate.shippingMethod,
    terms: estimate.terms,
    delivery: estimate.delivery,
    shipToSource: estimate.shipToSource ?? 'customer_shipping',
    shipToAddress: estimate.shipToAddress,
    shipToCity: estimate.shipToCity,
    shipToState: estimate.shipToState,
    shipToZip: estimate.shipToZip,
    customerContactId: estimate.customerContactId,
    customerRepName: estimate.customerRepName,
    customerRepPhone: estimate.customerRepPhone,
    customerRepEmail: estimate.customerRepEmail,
    internalNotes: estimate.internalNotes,
  };
}

function cleanJobInfo(jobInfo: EstimateJobInfo): EstimateJobInfo {
  const cleanText = (value: string | null) => {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  };
  return {
    jobName: cleanText(jobInfo.jobName),
    jobLocation: cleanText(jobInfo.jobLocation),
    jobNumber: cleanText(jobInfo.jobNumber),
    customerPo: cleanText(jobInfo.customerPo),
    quoteDate: cleanText(jobInfo.quoteDate),
    shippingMethod: cleanText(jobInfo.shippingMethod),
    terms: cleanText(jobInfo.terms),
    delivery: cleanText(jobInfo.delivery),
    shipToSource: jobInfo.shipToSource ?? 'customer_shipping',
    shipToAddress: cleanText(jobInfo.shipToAddress),
    shipToCity: cleanText(jobInfo.shipToCity),
    shipToState: cleanText(jobInfo.shipToState),
    shipToZip: cleanText(jobInfo.shipToZip),
    customerContactId: cleanText(jobInfo.customerContactId),
    customerRepName: cleanText(jobInfo.customerRepName),
    customerRepPhone: cleanText(jobInfo.customerRepPhone),
    customerRepEmail: cleanText(jobInfo.customerRepEmail),
    internalNotes: cleanText(jobInfo.internalNotes),
  };
}

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
  const location = useLocation();
  const { estimateId: routeEstimateId } = useParams<{ estimateId?: string }>();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // When ?id is present we are editing an existing estimate's openings
  const existingId = searchParams.get('id') ?? routeEstimateId ?? null;
  const explicitStepParam = searchParams.get('step');
  const parsedStepParam = explicitStepParam !== null ? parseInt(explicitStepParam, 10) : NaN;
  const inferredStep = existingId
    ? location.pathname.endsWith('/review')
      ? 3
      : 2
    : 0;
  const initialStep =
    Number.isFinite(parsedStepParam) && parsedStepParam >= 0
      ? Math.min(parsedStepParam, WIZARD_STEPS.length - 1)
      : inferredStep;
  const isEditingEstimate = Boolean(existingId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStep);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [noCustomer, setNoCustomer] = useState(false);
  const [jobInfo, setJobInfo] = useState<EstimateJobInfo>(() => emptyJobInfo());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [saving, setSaving] = useState(false);
  // When the user clicks "Edit configuration" on the Review step, we store the
  // target opening here, step back to Openings, and OpeningsStep auto-opens it.
  const [pendingEditOpening, setPendingEditOpening] = useState<import('@/types').EstimateOpeningWithItems | null>(null);
  // Optional builder step to deep-link to when a Review "Fix" button is clicked.
  const [pendingEditStep, setPendingEditStep] = useState<BuilderStepTarget | null>(null);

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
          const [estimate, companiesResult] = await Promise.all([
            getEstimate(existingId),
            supabase
              .from('companies')
              .select('*')
              .eq('active', true)
              .in('company_type', ['customer', 'both'])
              .order('name'),
          ]);

          if (!estimate) {
            throw new Error('Estimate not found');
          }

          setEstimateId(existingId);
          setSelectedCustomerId(estimate.companyId ?? null);
          setNoCustomer(!estimate.companyId);
          setJobInfo(jobInfoFromEstimate(estimate));

          if (companiesResult.data) {
            setCompanies(companiesResult.data.map(mapCompanyRow));
          }
        } else {
          // New estimate — just load companies. The estimate record is created
          // after Job Setup so abandoning Customer selection does not leave an orphan.
          const companiesResult = await supabase
            .from('companies')
            .select('*')
            .eq('active', true)
            .in('company_type', ['customer', 'both'])
            .order('name');

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

  const saveEstimateShell = useCallback(async (): Promise<string> => {
    const cleanedJobInfo = cleanJobInfo(jobInfo);
    if (!cleanedJobInfo.jobName) {
      throw new Error('Job name is required.');
    }

    let finalId = estimateId ?? existingId ?? null;
    if (!finalId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        throw new Error('Not authenticated');
      }
      const created = await createManualEstimate(user.id);
      finalId = created.estimateId;
      setEstimateId(finalId);
    }

    await apiUpdateEstimate(finalId, {
      companyId: noCustomer ? null : selectedCustomerId,
      ...cleanedJobInfo,
    });
    setJobInfo(cleanedJobInfo);
    return finalId;
  }, [estimateId, existingId, jobInfo, navigate, noCustomer, selectedCustomerId]);

  const handleNextStep = async () => {
    if (currentStepIndex === 1) {
      setSaving(true);
      try {
        await saveEstimateShell();
      } catch (err) {
        toast({
          title: 'Job setup required',
          description: err instanceof Error ? err.message : 'Please complete the job setup fields.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepIndex < WIZARD_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  // Passed to OpeningsStep so it can lazily create the estimate the first time
  // the user actually opens an add-opening dialog. Cached via useCallback so
  // OpeningsStep's useEffect deps stay stable.
  const createEstimate = useCallback(async (): Promise<string> => {
    if (estimateId) return estimateId;
    return saveEstimateShell();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId, saveEstimateShell]);

  // Called from OpeningsStep — advances to Review step
  const handleAdvanceToReview = async () => {
    const finalId = estimateId ?? existingId ?? null;
    if (!finalId) {
      toast({
        title: 'No openings added',
        description: 'Add and save at least one opening before continuing.',
        variant: 'destructive',
      });
      return;
    }
    if (!cleanJobInfo(jobInfo).jobName) {
      toast({
        title: 'Job setup required',
        description: 'Add a job name before reviewing pricing.',
        variant: 'destructive',
      });
      setCurrentStepIndex(1);
      return;
    }

    // Save customer/job assignment on the way through
    setSaving(true);
    try {
      await apiUpdateEstimate(finalId, {
        companyId: noCustomer ? null : selectedCustomerId,
        ...cleanJobInfo(jobInfo),
      });
      // Store the ID so ReviewStep can use it
      if (!estimateId && finalId) setEstimateId(finalId);
      setCurrentStepIndex(3);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Called from ReviewStep — final save and navigate away
  const handleFinish = async () => {
    const finalId = estimateId ?? existingId ?? null;
    if (!finalId) return;

    setSaving(true);
    try {
      // Compute the authoritative grand total from engine lines so it's stored
      // on estimates.total_price (used in the list view and quote creation).
      let totalPrice: number | null = null;
      try {
        const [openings, linesByOpening] = await Promise.all([
          getEstimateOpenings(finalId),
          loadEstimateLinesByOpening(finalId),
        ]);
        // Fetch the current adjustment pct so we include it in the total.
        const { data: adjRow } = await supabase
          .from('estimates')
          .select('sell_adjustment_pct')
          .eq('id', finalId)
          .single();
        const adjustmentPct = adjRow?.sell_adjustment_pct as number | null | undefined;
        totalPrice = estimateGrandTotal(openings, linesByOpening, adjustmentPct ?? null);
      } catch {
        // Non-fatal: if we can't compute the total, just save without it.
      }

      await apiUpdateEstimate(finalId, {
        companyId: noCustomer ? null : selectedCustomerId,
        ...cleanJobInfo(jobInfo),
        totalPrice,
      });
      toast({
        title: isEditingEstimate ? 'Estimate updated' : 'Estimate saved',
        description: isEditingEstimate
          ? 'Your estimate changes have been saved.'
          : 'Your estimate has been saved.',
      });
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
          <p className="text-sm">{isEditingEstimate ? 'Loading estimate...' : 'Loading...'}</p>
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
                  {isEditingEstimate ? 'Edit Estimate' : 'Create Estimate'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isEditingEstimate
                    ? 'Update customer, openings, pricing, and review before saving.'
                    : 'Enter line items manually'}
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

          {currentStepIndex === 1 && (
            <JobSetupStep
              value={jobInfo}
              selectedCompany={companies.find((company) => company.id === selectedCustomerId) ?? null}
              onChange={setJobInfo}
              onBack={handlePrevStep}
              onNext={handleNextStep}
              saving={saving}
            />
          )}

          {currentStepIndex === 2 && (
            <OpeningsStep
              estimateId={estimateId ?? existingId}
              createEstimate={!existingId ? createEstimate : undefined}
              onBack={handlePrevStep}
              backLabel="Back to Job Setup"
              onFinish={handleAdvanceToReview}
              finishLabel={saving ? 'Saving...' : 'Review & Pricing'}
              finishLoading={saving}
              autoEditOpening={pendingEditOpening}
              autoEditStep={pendingEditStep}
              onAutoEditDone={() => { setPendingEditOpening(null); setPendingEditStep(null); }}
            />
          )}

          {currentStepIndex === 3 && (
            <ReviewStep
              estimateId={(estimateId ?? existingId)!}
              onBack={() => setCurrentStepIndex(2)}
              onFinish={handleFinish}
              finishLoading={saving}
              finishLabel={
                isEditingEstimate
                  ? saving
                    ? 'Updating...'
                    : 'Update Estimate'
                  : saving
                    ? 'Saving...'
                    : 'Save & Finish'
              }
              onEditOpening={(opening, target) => {
                setPendingEditOpening(opening);
                setPendingEditStep(target ?? null);
                setCurrentStepIndex(2);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
