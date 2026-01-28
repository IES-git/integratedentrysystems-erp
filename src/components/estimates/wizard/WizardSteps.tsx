import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
}

interface WizardStepsProps {
  steps: WizardStep[];
  currentStepIndex: number;
}

export function WizardSteps({ steps, currentStepIndex }: WizardStepsProps) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isUpcoming = index > currentStepIndex;

          return (
            <li
              key={step.id}
              className={cn(
                'relative flex-1',
                index !== steps.length - 1 && 'pr-8 sm:pr-16'
              )}
            >
              {/* Connector line */}
              {index !== steps.length - 1 && (
                <div
                  className="absolute left-0 top-4 -right-4 sm:-right-8 h-0.5"
                  aria-hidden="true"
                >
                  <div
                    className={cn(
                      'h-full ml-8 sm:ml-10',
                      isCompleted ? 'bg-primary' : 'bg-border'
                    )}
                  />
                </div>
              )}

              <div className="group relative flex items-start">
                {/* Step indicator */}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors">
                  {isCompleted ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </span>
                  ) : isCurrent ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-background">
                      <span className="text-sm font-semibold text-primary">
                        {index + 1}
                      </span>
                    </span>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-border bg-background">
                      <span className="text-sm font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                    </span>
                  )}
                </span>

                {/* Step text */}
                <span className="ml-3 flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isCurrent && 'text-primary',
                      isCompleted && 'text-foreground',
                      isUpcoming && 'text-muted-foreground'
                    )}
                  >
                    {step.title}
                  </span>
                  {step.description && (
                    <span className="text-xs text-muted-foreground">
                      {step.description}
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
