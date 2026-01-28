import { useState } from 'react';
import { FileCheck, Search, MoreHorizontal, Plus, Send, CheckCircle, XCircle } from 'lucide-react';
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
import { quoteStorage, customerStorage } from '@/lib/storage';
import type { Quote, QuoteStatus } from '@/types';

export default function QuotesPage() {
  const [quotes] = useState<Quote[]>(quoteStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');

  const customers = customerStorage.getAll();

  const getCustomerName = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const filteredQuotes = quotes.filter((quote) =>
    getCustomerName(quote.customerId).toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Quotes</h1>
          <p className="mt-1 text-muted-foreground">
            Manage customer and manufacturer quotes
          </p>
        </div>
        <Button asChild>
          <a href="/app/estimates">
            <Plus className="mr-2 h-4 w-4" />
            New Quote
          </a>
        </Button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
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
          {filteredQuotes.length === 0 ? (
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
                    <TableHead>Customer</TableHead>
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
                          Q-{quote.id.slice(-6).toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {getCustomerName(quote.customerId)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(quote.status)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(quote.totalPrice, quote.currency)}
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
                            <DropdownMenuItem asChild>
                              <a href={`/app/quotes/${quote.id}/builder`}>
                                Edit Quote
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/app/quotes/${quote.id}/documents`}>
                                View Documents
                              </a>
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
