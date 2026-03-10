import { useState, useMemo } from 'react';
import { Search, User, Building2, CheckCircle2, Users, ArrowLeft, UserPlus, Plus, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { createCompany } from '@/lib/companies-api';
import type { Company } from '@/types';

interface RecipientStepProps {
  currentCustomer: Company | undefined;
  companies: Company[];
  useCurrentRecipients: boolean;
  selectedCustomerId: string | null;
  selectedManufacturerId: string | null;
  onUseCurrentChange: (value: boolean) => void;
  onCustomerChange: (id: string | null) => void;
  onManufacturerChange: (id: string | null) => void;
  onBack: () => void;
  onNext: () => void;
}

export function RecipientStep({
  currentCustomer,
  companies,
  useCurrentRecipients,
  selectedCustomerId,
  selectedManufacturerId,
  onUseCurrentChange,
  onCustomerChange,
  onManufacturerChange,
  onBack,
  onNext,
}: RecipientStepProps) {
  const [customerSearch, setCustomerSearch] = useState('');
  const [manufacturerSearch, setManufacturerSearch] = useState('');

  // Inline create state — shared local list
  const [localCompanies, setLocalCompanies] = useState<Company[]>([]);

  // Customer inline create
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);

  // Manufacturer inline create
  const [showCreateManufacturer, setShowCreateManufacturer] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [isCreatingManufacturer, setIsCreatingManufacturer] = useState(false);
  const [createManufacturerError, setCreateManufacturerError] = useState<string | null>(null);

  const allCompanies = useMemo(() => [...companies, ...localCompanies], [companies, localCompanies]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return allCompanies;
    const query = customerSearch.toLowerCase();
    return allCompanies.filter((c) => c.name.toLowerCase().includes(query));
  }, [allCompanies, customerSearch]);

  const filteredManufacturers = useMemo(() => {
    if (!manufacturerSearch.trim()) return allCompanies;
    const query = manufacturerSearch.toLowerCase();
    return allCompanies.filter((m) => m.name.toLowerCase().includes(query));
  }, [allCompanies, manufacturerSearch]);

  const selectedCustomer = allCompanies.find((c) => c.id === selectedCustomerId);
  const selectedManufacturer = allCompanies.find((m) => m.id === selectedManufacturerId);

  const canProceed = selectedCustomerId || selectedManufacturerId;

  const handleCreateCustomer = async () => {
    const name = newCustomerName.trim();
    if (!name) return;
    setIsCreatingCustomer(true);
    setCreateCustomerError(null);
    try {
      const newCompany = await createCompany({ name, companyType: 'customer' });
      setLocalCompanies((prev) => [...prev, newCompany]);
      onCustomerChange(newCompany.id);
      setShowCreateCustomer(false);
      setNewCustomerName('');
    } catch (err) {
      setCreateCustomerError(err instanceof Error ? err.message : 'Failed to create customer');
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const handleCreateManufacturer = async () => {
    const name = newManufacturerName.trim();
    if (!name) return;
    setIsCreatingManufacturer(true);
    setCreateManufacturerError(null);
    try {
      const newCompany = await createCompany({ name, companyType: 'manufacturer' });
      setLocalCompanies((prev) => [...prev, newCompany]);
      onManufacturerChange(newCompany.id);
      setShowCreateManufacturer(false);
      setNewManufacturerName('');
    } catch (err) {
      setCreateManufacturerError(err instanceof Error ? err.message : 'Failed to create manufacturer');
    } finally {
      setIsCreatingManufacturer(false);
    }
  };

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
      <div
        onClick={() => {
          if (currentCustomer) {
            onUseCurrentChange(true);
            onCustomerChange(currentCustomer.id);
          }
        }}
        className={cn(
          'rounded-lg border-2 p-4 transition-all',
          currentCustomer ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
          currentCustomer && useCurrentRecipients && selectedCustomerId === currentCustomer.id
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-center gap-4">
          <SelectionIndicator
            selected={!!currentCustomer && useCurrentRecipients && selectedCustomerId === currentCustomer.id}
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {currentCustomer ? 'Use Estimate Customer' : 'No Estimate Customer Available'}
              </span>
            </div>
            {currentCustomer ? (
              <p className="mt-1 text-sm text-muted-foreground pl-6">
                {currentCustomer.name}
                {currentCustomer.billingCity ? ` · ${currentCustomer.billingCity}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground pl-6 italic">
                This estimate has no assigned customer
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Select Different Recipients */}
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

                  {/* Create New Customer inline form */}
                  {showCreateCustomer ? (
                    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
                      <Label className="text-xs">New Customer Name <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="e.g. Acme Corp"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCustomer(); if (e.key === 'Escape') setShowCreateCustomer(false); }}
                      />
                      {createCustomerError && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {createCustomerError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleCreateCustomer} disabled={!newCustomerName.trim() || isCreatingCustomer} className="flex-1">
                          {isCreatingCustomer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create & Select'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowCreateCustomer(false); setNewCustomerName(''); setCreateCustomerError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCreateCustomer(true)}
                      className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm text-primary hover:bg-primary/5 transition-colors border border-dashed border-primary/30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create New Customer
                    </button>
                  )}

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

                  {/* Create New Manufacturer inline form */}
                  {showCreateManufacturer ? (
                    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
                      <Label className="text-xs">New Manufacturer Name <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="e.g. Steelcraft"
                        value={newManufacturerName}
                        onChange={(e) => setNewManufacturerName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateManufacturer(); if (e.key === 'Escape') setShowCreateManufacturer(false); }}
                      />
                      {createManufacturerError && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {createManufacturerError}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleCreateManufacturer} disabled={!newManufacturerName.trim() || isCreatingManufacturer} className="flex-1">
                          {isCreatingManufacturer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create & Select'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowCreateManufacturer(false); setNewManufacturerName(''); setCreateManufacturerError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCreateManufacturer(true)}
                      className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-sm text-primary hover:bg-primary/5 transition-colors border border-dashed border-primary/30"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Create New Manufacturer
                    </button>
                  )}

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

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Continue
        </Button>
      </div>
    </div>
  );
}
