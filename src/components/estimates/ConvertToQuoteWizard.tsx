import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { quoteStorage, customerStorage, manufacturerStorage, templateStorage } from '@/lib/storage';
import type { Estimate, Quote, Customer, Manufacturer, Template } from '@/types';
import { ExistingQuotesStep } from './wizard/ExistingQuotesStep';
import { RecipientStep } from './wizard/RecipientStep';
import { QuoteTypeStep } from './wizard/QuoteTypeStep';
import { TemplateSelectionStep } from './wizard/TemplateSelectionStep';

type WizardStep = 'existing' | 'recipient' | 'type' | 'template';

interface ConvertToQuoteWizardProps {
  estimate: Estimate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConvertToQuoteWizard({
  estimate,
  open,
  onOpenChange,
}: ConvertToQuoteWizardProps) {
  const navigate = useNavigate();

  // Data
  const customers = useMemo(() => customerStorage.getAll(), []);
  const manufacturers = useMemo(() => manufacturerStorage.getAll(), []);
  const templates = useMemo(() => templateStorage.getAll(), []);
  const existingQuotes = useMemo(
    () => quoteStorage.getAll().filter((q) => q.estimateId === estimate.id),
    [estimate.id]
  );

  const currentCustomer = customers.find((c) => c.id === estimate.customerId);

  // Wizard state
  const [step, setStep] = useState<WizardStep>('existing');
  const [selectedExistingQuote, setSelectedExistingQuote] = useState<Quote | null>(null);
  const [useCurrentRecipients, setUseCurrentRecipients] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    estimate.customerId
  );
  const [selectedManufacturerId, setSelectedManufacturerId] = useState<string | null>(null);
  const [quoteType, setQuoteType] = useState<'customer' | 'manufacturer' | 'both'>('customer');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const resetWizard = useCallback(() => {
    setStep('existing');
    setSelectedExistingQuote(null);
    setUseCurrentRecipients(true);
    setSelectedCustomerId(estimate.customerId);
    setSelectedManufacturerId(null);
    setQuoteType('customer');
    setSelectedTemplateId(null);
  }, [estimate.customerId]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetWizard();
    }
    onOpenChange(open);
  };

  const handleBack = () => {
    switch (step) {
      case 'recipient':
        setStep('existing');
        break;
      case 'type':
        setStep('recipient');
        break;
      case 'template':
        setStep('type');
        break;
    }
  };

  const handleSelectExistingQuote = (quote: Quote | null) => {
    setSelectedExistingQuote(quote);
    if (quote) {
      setSelectedCustomerId(quote.customerId);
    }
    setStep('recipient');
  };

  const handleSkipExisting = () => {
    setSelectedExistingQuote(null);
    setStep('recipient');
  };

  const handleRecipientNext = () => {
    setStep('type');
  };

  const handleQuoteTypeNext = () => {
    setStep('template');
  };

  const handleComplete = () => {
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
    handleOpenChange(false);
  };

  const getStepTitle = () => {
    switch (step) {
      case 'existing':
        return 'Previous Quotes';
      case 'recipient':
        return 'Select Recipients';
      case 'type':
        return 'Quote Type';
      case 'template':
        return 'Select Template';
    }
  };

  const getStepNumber = () => {
    switch (step) {
      case 'existing':
        return 1;
      case 'recipient':
        return 2;
      case 'type':
        return 3;
      case 'template':
        return 4;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {step !== 'existing' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">
                Step {getStepNumber()} of 4
              </p>
              <DialogTitle className="font-display text-xl">
                {getStepTitle()}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-2">
          {step === 'existing' && (
            <ExistingQuotesStep
              existingQuotes={existingQuotes}
              customers={customers}
              onSelectQuote={handleSelectExistingQuote}
              onSkip={handleSkipExisting}
            />
          )}

          {step === 'recipient' && (
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
              onNext={handleRecipientNext}
            />
          )}

          {step === 'type' && (
            <QuoteTypeStep
              quoteType={quoteType}
              hasCustomer={!!selectedCustomerId}
              hasManufacturer={!!selectedManufacturerId}
              onQuoteTypeChange={setQuoteType}
              onNext={handleQuoteTypeNext}
            />
          )}

          {step === 'template' && (
            <TemplateSelectionStep
              templates={templates}
              quoteType={quoteType}
              selectedTemplateId={selectedTemplateId}
              onTemplateChange={setSelectedTemplateId}
              onComplete={handleComplete}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
