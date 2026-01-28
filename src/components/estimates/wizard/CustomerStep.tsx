import { useState, useMemo } from 'react';
import { Search, User, UserX, Building2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Customer } from '@/types';

export interface ExtractedCustomerData {
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  confidence: number;
}

interface CustomerStepProps {
  extractedCustomer: ExtractedCustomerData | null;
  customers: Customer[];
  selectedCustomerId: string | null;
  noCustomer: boolean;
  onSelectCustomer: (customerId: string | null, noCustomer: boolean) => void;
  onNext: () => void;
}

export function CustomerStep({
  extractedCustomer,
  customers,
  selectedCustomerId,
  noCustomer,
  onSelectCustomer,
  onNext,
}: CustomerStepProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const query = searchQuery.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.primaryContactName.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query)
    );
  }, [customers, searchQuery]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const canProceed = selectedCustomerId || noCustomer;

  const handleSelectOcrCustomer = () => {
    // Try to match extracted customer with existing customers
    if (extractedCustomer?.name) {
      const match = customers.find(
        (c) => c.name.toLowerCase() === extractedCustomer.name?.toLowerCase()
      );
      if (match) {
        onSelectCustomer(match.id, false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* OCR Extracted Customer */}
      <Card className={cn(
        'border-2 transition-colors',
        extractedCustomer ? 'border-primary/50' : 'border-border'
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Extracted from PDF</CardTitle>
            </div>
            {extractedCustomer ? (
              <Badge variant="default" className="bg-success">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Customer Found
              </Badge>
            ) : (
              <Badge variant="secondary">
                <AlertCircle className="mr-1 h-3 w-3" />
                No Customer Detected
              </Badge>
            )}
          </div>
          <CardDescription>
            {extractedCustomer
              ? 'We detected customer information from the uploaded PDF. You can accept this or choose a different customer.'
              : 'No customer information was found in the PDF. Please select a customer or proceed without one.'}
          </CardDescription>
        </CardHeader>
        {extractedCustomer && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{extractedCustomer.name || 'Unknown'}</p>
                  {extractedCustomer.contactName && (
                    <p className="text-sm text-muted-foreground">
                      Contact: {extractedCustomer.contactName}
                    </p>
                  )}
                  {extractedCustomer.email && (
                    <p className="text-sm text-muted-foreground">
                      {extractedCustomer.email}
                    </p>
                  )}
                  {extractedCustomer.phone && (
                    <p className="text-sm text-muted-foreground">
                      {extractedCustomer.phone}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Confidence</p>
                  <p className="text-sm font-mono font-medium">
                    {Math.round(extractedCustomer.confidence * 100)}%
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={handleSelectOcrCustomer}
              >
                Use Extracted Customer
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Customer Selection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Select Customer</CardTitle>
          </div>
          <CardDescription>
            Choose an existing customer from your database
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <ScrollArea className="h-48 rounded-md border">
            <div className="p-2 space-y-1">
              {filteredCustomers.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {searchQuery ? 'No customers match your search' : 'No customers available'}
                </p>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => onSelectCustomer(customer.id, false)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                      selectedCustomerId === customer.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{customer.name}</p>
                      <p className={cn(
                        'truncate text-xs',
                        selectedCustomerId === customer.id
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground'
                      )}>
                        {customer.primaryContactName} • {customer.email}
                      </p>
                    </div>
                    {selectedCustomerId === customer.id && (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {selectedCustomer && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
              <Label className="text-xs text-muted-foreground">Selected Customer</Label>
              <p className="font-medium">{selectedCustomer.name}</p>
              <p className="text-sm text-muted-foreground">
                {selectedCustomer.primaryContactName} • {selectedCustomer.email}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* No Customer Option */}
      <Card
        className={cn(
          'cursor-pointer border-2 transition-colors',
          noCustomer ? 'border-warning bg-warning/5' : 'border-border hover:border-muted-foreground/50'
        )}
        onClick={() => onSelectCustomer(null, true)}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            noCustomer ? 'bg-warning text-warning-foreground' : 'bg-muted'
          )}>
            <UserX className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-medium">No Customer</p>
            <p className="text-sm text-muted-foreground">
              Proceed without assigning a customer. You can assign one later.
            </p>
          </div>
          {noCustomer && <CheckCircle2 className="h-5 w-5 text-warning" />}
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex justify-end pt-4 border-t">
        <Button onClick={onNext} disabled={!canProceed} size="lg">
          Continue to Line Items
        </Button>
      </div>
    </div>
  );
}
