import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck, Search, MoreHorizontal, Plus, Send, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SelectEstimateModal } from '@/components/quotes/SelectEstimateModal';
import { listQuotesWithItems } from '@/lib/quotes-api';
import { supabase } from '@/lib/supabase';
import type { QuoteWithItems, QuoteStatus, Company } from '@/types';

export default function QuotesPage() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<QuoteWithItems[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      listQuotesWithItems(),
      supabase.from('companies').select('id, name').order('name'),
    ])
      .then(([loadedQuotes, { data: companiesData }]) => {
        setQuotes(loadedQuotes);
        setCompanies(
          (companiesData ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            companyType: 'customer' as const,
            billingAddress: null,
            billingCity: null,
            billingState: null,
            billingZip: null,
            shippingAddress: null,
            shippingCity: null,
            shippingState: null,
            shippingZip: null,
            notes: null,
            active: true,
            settings: { costMultiplier: 1.0, paymentTerms: null, defaultTemplateId: null },
            createdAt: '',
            updatedAt: '',
          }))
        );
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return '';
    return companies.find((c) => c.id === companyId)?.name ?? '';
  };

  const filteredQuotes = quotes.filter((quote) => {
    const query = searchQuery.toLowerCase();
    if (!query) return true;
    const companyName = getCompanyName(quote.companyId);
    const dateStr = new Date(quote.createdAt).toLocaleDateString();
    const itemCodes = quote.items.map((i) => i.canonicalCode).filter(Boolean);
    return (
      quote.id.toLowerCase().includes(query) ||
      companyName.toLowerCase().includes(query) ||
      dateStr.toLowerCase().includes(query) ||
      itemCodes.some((code) => code.toLowerCase().includes(query))
    );
  });

  const getStatusBadge = (status: QuoteStatus) => {
    const config: Record<QuoteStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      draft: { variant: 'secondary', label: 'Draft' },
      sent: { variant: 'default', label: 'Sent' },
      approved: { variant: 'outline', label: 'Approved' },
      rejected: { variant: 'destructive', label: 'Rejected' },
      converted: { variant: 'outline', label: 'Converted' },
    };
    return (
      <Badge variant={config[status].variant}>
        {config[status].label}
      </Badge>
    );
  };

  const getQuoteTypeBadge = (quoteType: Quote['quoteType']) => {
    const config = {
      customer: { label: 'Customer', className: 'bg-blue-100 text-blue-700 border-blue-200' },
      manufacturer: { label: 'Manufacturer', className: 'bg-purple-100 text-purple-700 border-purple-200' },
      both: { label: 'Both', className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    };
    const c = config[quoteType];
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${c.className}`}>
        {c.label}
      </span>
    );
  };

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const handleSelectEstimate = (estimateId: string) => {
    navigate(`/app/quotes/wizard?estimateId=${estimateId}`);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">Quotes</h1>
          <p className="mt-1 text-muted-foreground">
            Manage customer and manufacturer quotes
          </p>
        </div>
        <Button onClick={() => setIsSelectModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Quote
        </Button>
      </div>

      <SelectEstimateModal
        open={isSelectModalOpen}
        onOpenChange={setIsSelectModalOpen}
        onSelect={handleSelectEstimate}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Draft</p>
                <p className="text-2xl font-semibold">
                  {quotes.filter((q) => q.status === 'draft').length}
                </p>
              </div>
              <div className="rounded-full bg-secondary p-2">
                <FileCheck className="h-4 w-4 text-secondary-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sent</p>
                <p className="text-2xl font-semibold">
                  {quotes.filter((q) => q.status === 'sent').length}
                </p>
              </div>
              <div className="rounded-full bg-primary/10 p-2">
                <Send className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-semibold">
                  {quotes.filter((q) => q.status === 'approved').length}
                </p>
              </div>
              <div className="rounded-full bg-success/10 p-2">
                <CheckCircle className="h-4 w-4 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-semibold">
                  {quotes.filter((q) => q.status === 'rejected').length}
                </p>
              </div>
              <div className="rounded-full bg-destructive/10 p-2">
                <XCircle className="h-4 w-4 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Quotes</CardTitle>
              <CardDescription>{quotes.length} total quotes</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search quotes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileCheck className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No quotes match your search' : 'No quotes yet'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a quote from a processed estimate
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Created</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredQuotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell>
                        <span className="font-mono text-sm">
                          Q-{quote.id.slice(-8).toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        {getQuoteTypeBadge(quote.quoteType)}
                      </TableCell>
                      <TableCell>{getStatusBadge(quote.status)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(quote.total, quote.currency)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {new Date(quote.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <a href={`/app/quotes/${quote.id}`}>View Details</a>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>Clone Quote</DropdownMenuItem>
                            {quote.status === 'approved' && (
                              <DropdownMenuItem>Convert to Order</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
