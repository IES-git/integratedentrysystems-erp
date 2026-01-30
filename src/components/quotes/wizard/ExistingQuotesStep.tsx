import { useState, useMemo } from 'react';
import { Search, FileText, Calendar, User, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Quote, Customer } from '@/types';

interface ExistingQuotesStepProps {
  existingQuotes: Quote[];
  customers: Customer[];
  onSelectQuote: (quote: Quote) => void;
  onSkip: () => void;
}

export function ExistingQuotesStep({
  existingQuotes,
  customers,
  onSelectQuote,
  onSkip,
}: ExistingQuotesStepProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);

  const getCustomerName = (customerId: string) => {
    return customers.find((c) => c.id === customerId)?.name || 'Unknown';
  };

  const sortedQuotes = useMemo(() => {
    return [...existingQuotes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [existingQuotes]);

  const filteredQuotes = useMemo(() => {
    if (!searchQuery.trim()) return sortedQuotes;
    const query = searchQuery.toLowerCase();
    return sortedQuotes.filter((q) => {
      const customerName = getCustomerName(q.customerId).toLowerCase();
      return (
        customerName.includes(query) ||
        q.id.toLowerCase().includes(query)
      );
    });
  }, [sortedQuotes, searchQuery, customers]);

  const selectedQuote = existingQuotes.find((q) => q.id === selectedQuoteId);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-success/10 text-success border-success/20';
      case 'sent':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'rejected':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  if (existingQuotes.length === 0) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          No previous quotes have been created from this estimate.
        </p>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground">
            No previous quotes from this estimate
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start fresh by creating a new quote
          </p>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={onSkip}>
            Start New Quote
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select a previous quote to use as a template, or start fresh.
      </p>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by customer name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      <ScrollArea className="h-72 rounded-md border bg-muted/30">
        <div className="p-2 space-y-2">
          {filteredQuotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No quotes match your search
            </p>
          ) : (
            filteredQuotes.map((quote) => (
              <button
                key={quote.id}
                onClick={() => setSelectedQuoteId(quote.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-all',
                  selectedQuoteId === quote.id
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border bg-background hover:border-muted-foreground/50'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">
                        {getCustomerName(quote.customerId)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(quote.createdAt).toLocaleDateString()}
                      </span>
                      <span className="font-mono">#{quote.id.slice(-6)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge
                      variant="outline"
                      className={cn('text-xs capitalize', getStatusColor(quote.status))}
                    >
                      {quote.status}
                    </Badge>
                    <p className="mt-1 text-sm font-medium">
                      {formatCurrency(quote.totalPrice)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={onSkip}>
          Start Fresh
        </Button>
        <Button
          onClick={() => selectedQuote && onSelectQuote(selectedQuote)}
          disabled={!selectedQuote}
        >
          Use as Template
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
