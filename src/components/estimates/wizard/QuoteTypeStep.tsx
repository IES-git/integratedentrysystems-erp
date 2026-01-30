import { User, Factory, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QuoteTypeStepProps {
  quoteType: 'customer' | 'manufacturer' | 'both';
  hasCustomer: boolean;
  hasManufacturer: boolean;
  onQuoteTypeChange: (type: 'customer' | 'manufacturer' | 'both') => void;
  onNext: () => void;
}

export function QuoteTypeStep({
  quoteType,
  hasCustomer,
  hasManufacturer,
  onQuoteTypeChange,
  onNext,
}: QuoteTypeStepProps) {
  const SelectionIndicator = ({ selected }: { selected: boolean }) => (
    <div
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors shrink-0',
        selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
      )}
    >
      {selected && (
        <svg
          className="h-3 w-3 text-primary-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );

  const options = [
    {
      value: 'customer' as const,
      label: 'Customer Quote',
      description: 'Generate a quote document for the customer',
      icon: User,
      disabled: !hasCustomer,
    },
    {
      value: 'manufacturer' as const,
      label: 'Manufacturer Quote',
      description: 'Generate a quote document for the manufacturer',
      icon: Factory,
      disabled: !hasManufacturer,
    },
    {
      value: 'both' as const,
      label: 'Both',
      description: 'Generate quotes for both customer and manufacturer',
      icon: Users,
      disabled: !hasCustomer && !hasManufacturer,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What type of quote document do you want to generate?
      </p>

      <div className="space-y-3">
        {options.map((option) => (
          <div
            key={option.value}
            onClick={() => !option.disabled && onQuoteTypeChange(option.value)}
            className={cn(
              'rounded-lg border-2 p-4 transition-all',
              option.disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer',
              quoteType === option.value && !option.disabled
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-border hover:border-muted-foreground/50'
            )}
          >
            <div className="flex items-center gap-4">
              <SelectionIndicator selected={quoteType === option.value} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <option.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{option.label}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground pl-6">
                  {option.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}
