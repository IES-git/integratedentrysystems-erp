import { FileText, Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Estimate } from '@/types';

interface BatchProgressProps {
  estimates: Estimate[];
  currentIndex: number;
  onSelectEstimate: (index: number) => void;
  completedIndices: Set<number>;
}

export function BatchProgress({
  estimates,
  currentIndex,
  onSelectEstimate,
  completedIndices,
}: BatchProgressProps) {
  if (estimates.length <= 1) return null;

  return (
    <div className="mb-6 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Processing {estimates.length} Files
        </h3>
        <span className="text-sm font-medium">
          {currentIndex + 1} of {estimates.length}
        </span>
      </div>

      <ScrollArea className="max-h-32">
        <div className="space-y-1">
          {estimates.map((estimate, index) => {
            const isCompleted = completedIndices.has(index);
            const isCurrent = index === currentIndex;

            return (
              <button
                key={estimate.id}
                onClick={() => onSelectEstimate(index)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isCurrent && 'bg-primary/10 text-primary',
                  !isCurrent && isCompleted && 'text-muted-foreground',
                  !isCurrent && !isCompleted && 'text-foreground hover:bg-muted'
                )}
              >
                <div className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full shrink-0',
                  isCompleted && 'bg-success text-success-foreground',
                  isCurrent && !isCompleted && 'border-2 border-primary',
                  !isCurrent && !isCompleted && 'border border-muted-foreground/30'
                )}>
                  {isCompleted ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span className="text-xs">{index + 1}</span>
                  )}
                </div>
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{estimate.originalPdfName}</span>
                {isCurrent && (
                  <span className="text-xs bg-primary/20 px-2 py-0.5 rounded">Current</span>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="mt-3 flex gap-2">
        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((completedIndices.size) / estimates.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {completedIndices.size}/{estimates.length} complete
        </span>
      </div>
    </div>
  );
}
