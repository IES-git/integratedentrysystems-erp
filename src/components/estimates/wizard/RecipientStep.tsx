import { useState, useMemo } from 'react';
import { Search, User, Building2, CheckCircle2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Customer, Manufacturer } from '@/types';

interface RecipientStepProps {
  currentCustomer: Customer | undefined;
  customers: Customer[];
  manufacturers: Manufacturer[];
  useCurrentRecipients: boolean;
  selectedCustomerId: string | null;
  selectedManufacturerId: string | null;
  onUseCurrentChange: (value: boolean) => void;
  onCustomerChange: (id: string | null) => void;
  onManufacturerChange: (id: string | null) => void;
  onNext: () => void;
}

export function RecipientStep({
  currentCustomer,
  customers,
  manufacturers,
  useCurrentRecipients,
  selectedCustomerId,
  selectedManufacturerId,
  onUseCurrentChange,
  onCustomerChange,
  onManufacturerChange,
  onNext,
}: RecipientStepProps) {
  const [customerSearch, setCustomerSearch] = useState('');
  const [manufacturerSearch, setManufacturerSearch] = useState('');

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const query = customerSearch.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.primaryContactName.toLowerCase().includes(query)
    );
  }, [customers, customerSearch]);

  const filteredManufacturers = useMemo(() => {
    if (!manufacturerSearch.trim()) return manufacturers;
    const query = manufacturerSearch.toLowerCase();
    return manufacturers.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.primaryContactName.toLowerCase().includes(query)
    );
  }, [manufacturers, manufacturerSearch]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const selectedManufacturer = manufacturers.find((m) => m.id === selectedManufacturerId);

  const canProceed = selectedCustomerId || selectedManufacturerId;

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select the customer and/or manufacturer for this quote.
      </p>

      {/* Use Current Customer Option */}
      {currentCustomer && (
        <div
          onClick={() => {
            onUseCurrentChange(true);
            onCustomerChange(currentCustomer.id);
          }}
          className={cn(
            'rounded-lg border-2 p-4 cursor-pointer transition-all',
            useCurrentRecipients && selectedCustomerId === currentCustomer.id
              ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
              : 'border-border hover:border-muted-foreground/50'
          )}
        >
          <div className="flex items-center gap-4">
            <SelectionIndicator
              selected={useCurrentRecipients && selectedCustomerId === currentCustomer.id}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Use Estimate Customer</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground pl-6">
                {currentCustomer.name} – {currentCustomer.primaryContactName}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Select Different Customer */}
      <div
        onClick={() => onUseCurrentChange(false)}
        className={cn(
          'rounded-lg border-2 p-4 cursor-pointer transition-all',
          !useCurrentRecipients
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={!useCurrentRecipients} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Select Different Recipients</span>
            </div>

            {!useCurrentRecipients && (
              <div
                className="mt-4 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Customer Selection */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Customer
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search customers..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  <ScrollArea className="h-32 rounded-md border bg-background">
                    <div className="p-1">
                      <button
                        onClick={() => onCustomerChange(null)}
                        className={cn(
                          'w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors',
                          selectedCustomerId === null
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted text-muted-foreground italic'
                        )}
                      >
                        No customer
                      </button>
                      {filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => onCustomerChange(customer.id)}
                          className={cn(
                            'w-full flex items-center gap-2 rounded px-3 py-2 text-left transition-colors',
                            selectedCustomerId === customer.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          <span className="truncate text-sm font-medium">
                            {customer.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                  {selectedCustomer && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-success" />
                      {selectedCustomer.name}
                    </p>
                  )}
                </div>

                {/* Manufacturer Selection */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Manufacturer (Optional)
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search manufacturers..."
                      value={manufacturerSearch}
                      onChange={(e) => setManufacturerSearch(e.target.value)}
                      className="pl-8 h-9"
                    />
                  </div>
                  <ScrollArea className="h-32 rounded-md border bg-background">
                    <div className="p-1">
                      <button
                        onClick={() => onManufacturerChange(null)}
                        className={cn(
                          'w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors',
                          selectedManufacturerId === null
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-muted text-muted-foreground italic'
                        )}
                      >
                        No manufacturer
                      </button>
                      {filteredManufacturers.map((manufacturer) => (
                        <button
                          key={manufacturer.id}
                          onClick={() => onManufacturerChange(manufacturer.id)}
                          className={cn(
                            'w-full flex items-center gap-2 rounded px-3 py-2 text-left transition-colors',
                            selectedManufacturerId === manufacturer.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          <span className="truncate text-sm font-medium">
                            {manufacturer.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                  {selectedManufacturer && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-success" />
                      {selectedManufacturer.name}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button onClick={onNext} disabled={!canProceed}>
          Continue
        </Button>
      </div>
    </div>
  );
}
