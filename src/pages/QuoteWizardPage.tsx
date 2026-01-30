import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileOutput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WizardSteps, type WizardStep } from '@/components/estimates/wizard/WizardSteps';
import { ExistingQuotesStep } from '@/components/quotes/wizard/ExistingQuotesStep';
import { RecipientStep } from '@/components/quotes/wizard/RecipientStep';
import { TemplateSelectionStep } from '@/components/quotes/wizard/TemplateSelectionStep';
import { useToast } from '@/hooks/use-toast';
import {
  estimateStorage,
  quoteStorage,
  customerStorage,
  manufacturerStorage,
  templateStorage,
} from '@/lib/storage';
import type { Estimate, Quote, Customer, Manufacturer, Template } from '@/types';

const WIZARD_STEPS: WizardStep[] = [
  { id: 'existing', title: 'Previous Quotes', description: 'Use details from a previous quote' },
  { id: 'recipient', title: 'Recipients', description: 'Select customer & manufacturer' },
  { id: 'template', title: 'Templates', description: 'Choose output format' },
];

export default function QuoteWizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const estimateId = searchParams.get('estimateId');
  const initialQuoteType = searchParams.get('quoteType') as 'customer' | 'manufacturer' | 'both' | null;

  // Data
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [existingQuotes, setExistingQuotes] = useState<Quote[]>([]);

  // Wizard state
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedExistingQuote, setSelectedExistingQuote] = useState<Quote | null>(null);
  const [useCurrentRecipients, setUseCurrentRecipients] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string | null>(null);
  const [quoteType, setQuoteType] = useState<'customer' | 'manufacturer' | 'both'>(initialQuoteType || 'customer');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const currentCustomer = useMemo(
    () => customers.find((c) => c.id === estimate?.customerId),
    [customers, estimate?.customerId]
  );

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

    if (est.ocrStatus !== 'done') {
      toast({
        title: 'Estimate not ready',
        description: 'This estimate is still being processed.',
        variant: 'destructive',
      });
      navigate('/app/estimates');
      return;
    }

    setEstimate(est);
    setSelectedCustomerId(est.customerId);
    // If no customer on estimate, pre-select "Select Different Recipients" mode
    if (!est.customerId) {
      setUseCurrentRecipients(false);
    }
    setCustomers(customerStorage.getAll());
    setManufacturers(manufacturerStorage.getAll());
    setTemplates(templateStorage.getAll());
    setExistingQuotes(quoteStorage.getAll().filter((q) => q.estimateId === estimateId));
  }, [estimateId, navigate, toast]);

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleSelectExistingQuote = useCallback((quote: Quote | null) => {
    setSelectedExistingQuote(quote);
    if (quote) {
      setSelectedCustomerId(quote.customerId);
    }
    setCurrentStepIndex(1);
  }, []);

  const handleSkipExisting = useCallback(() => {
    setSelectedExistingQuote(null);
    setCurrentStepIndex(1);
  }, []);

  const handleRecipientNext = useCallback(() => {
    setCurrentStepIndex(2);
  }, []);

  const handleComplete = useCallback(() => {
    if (!estimate) return;

    // Navigate to quote builder with all selections
    const params = new URLSearchParams({
      estimateId: estimate.id,
    });
    if (selectedCustomerId) params.set('customerId', selectedCustomerId);
    if (selectedManufacturerId) params.set('manufacturerId', selectedManufacturerId);
    params.set('quoteType', quoteType);
    if (selectedTemplateId) params.set('templateId', selectedTemplateId);
    if (selectedExistingQuote) params.set('baseQuoteId', selectedExistingQuote.id);

    navigate(`/app/quotes/new?${params.toString()}`);
  }, [estimate, selectedCustomerId, selectedManufacturerId, quoteType, selectedTemplateId, selectedExistingQuote, navigate]);

  const handleCancel = () => {
    navigate('/app/estimates');
  };

  if (!estimate) {
    return null;
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <Button variant="ghost" size="sm" onClick={handleCancel} className="mb-4 -ml-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Estimates
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileOutput className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-3xl tracking-wide">Create Quote</h1>
                <p className="text-sm text-muted-foreground truncate">
                  From: {estimate.originalPdfName}
                </p>
              </div>
            </div>
          </div>

          {/* Steps Indicator */}
          <WizardSteps steps={WIZARD_STEPS} currentStepIndex={currentStepIndex} />

          {/* Step Content */}
          {currentStepIndex === 0 && (
            <ExistingQuotesStep
              existingQuotes={existingQuotes}
              customers={customers}
              onSelectQuote={handleSelectExistingQuote}
              onSkip={handleSkipExisting}
            />
          )}

          {currentStepIndex === 1 && (
            <RecipientStep
              currentCustomer={currentCustomer}
              customers={customers}
              manufacturers={manufacturers}
              useCurrentRecipients={useCurrentRecipients}
              selectedCustomerId={selectedCustomerId}
              selectedManufacturerId={selectedManufacturerId}
              onUseCurrentChange={setUseCurrentRecipients}
              onCustomerChange={setSelectedCustomerId}
              onManufacturerChange={setSelectedManufacturerId}
              onBack={handleBack}
              onNext={handleRecipientNext}
            />
          )}

          {currentStepIndex === 2 && (
            <TemplateSelectionStep
              templates={templates}
              quoteType={quoteType}
              selectedTemplateId={selectedTemplateId}
              onTemplateChange={setSelectedTemplateId}
              onBack={handleBack}
              onComplete={handleComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}
