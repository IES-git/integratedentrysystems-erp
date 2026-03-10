import { useState, useMemo, useEffect } from 'react';
import { Search, User, UserX, Building2, CheckCircle2, AlertCircle, Circle, UserPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { createCompany } from '@/lib/companies-api';
import type { Company } from '@/types';

export interface ExtractedCustomerData {
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  confidence: number;
}

type SelectionMode = 'ocr' | 'existing' | 'none' | 'create';

interface CustomerStepProps {
  extractedCustomer: ExtractedCustomerData | null;
  companies: Company[];
  selectedCustomerId: string | null;
  noCustomer: boolean;
  onSelectCustomer: (customerId: string | null, noCustomer: boolean) => void;
  onNext: () => void;
}

export function CustomerStep({
  extractedCustomer,
  companies,
  selectedCustomerId,
  noCustomer,
  onSelectCustomer,
  onNext,
}: CustomerStepProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>(() => {
    if (noCustomer) return 'none';
    if (selectedCustomerId) return 'existing';
    return null;
  });
  const [selectedInList, setSelectedInList] = useState<string | null>(selectedCustomerId);

  // Inline create form state
  const [localCompanies, setLocalCompanies] = useState<Company[]>([]);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const allCompanies = useMemo(() => [...companies, ...localCompanies], [companies, localCompanies]);

  // Find OCR matched company (exact or fuzzy match)
  const ocrMatchedCustomer = useMemo(() => {
    if (!extractedCustomer?.name) return null;
    const extractedLower = extractedCustomer.name.toLowerCase().trim();
    const exact = allCompanies.find(
      (c) => c.name.toLowerCase().trim() === extractedLower
    );
    if (exact) return exact;
    return allCompanies.find(
      (c) =>
        c.name.toLowerCase().includes(extractedLower) ||
        extractedLower.includes(c.name.toLowerCase())
    ) || null;
  }, [extractedCustomer, allCompanies]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return allCompanies;
    const query = searchQuery.toLowerCase();
    return allCompanies.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.notes ?? '').toLowerCase().includes(query)
    );
  }, [allCompanies, searchQuery]);

  const selectedCustomer = allCompanies.find((c) => c.id === selectedInList);

  const canProceed = useMemo(() => {
    if (selectionMode === 'none') return true;
    if (selectionMode === 'ocr' && extractedCustomer?.name) return true;
    if (selectionMode === 'existing' && selectedInList) return true;
    return false;
  }, [selectionMode, extractedCustomer, selectedInList]);

  useEffect(() => {
    if (selectionMode === 'none') {
      onSelectCustomer(null, true);
    } else if (selectionMode === 'ocr') {
      onSelectCustomer(ocrMatchedCustomer?.id ?? null, false);
    } else if (selectionMode === 'existing' && selectedInList) {
      onSelectCustomer(selectedInList, false);
    } else {
      onSelectCustomer(null, false);
    }
  }, [selectionMode, selectedInList, ocrMatchedCustomer, onSelectCustomer]);

  const handleSelectOcrOption = () => {
    if (!extractedCustomer) return;
    setSelectionMode('ocr');
  };

  const handleSelectExistingOption = () => {
    setSelectionMode('existing');
  };

  const handleSelectNoCustomer = () => {
    setSelectionMode('none');
    setSelectedInList(null);
  };

  const handleSelectCustomerFromList = (customerId: string) => {
    setSelectedInList(customerId);
    setSelectionMode('existing');
  };

  const handleCreateCustomer = async () => {
    const trimmedName = createName.trim();
    if (!trimmedName) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const newCompany = await createCompany({ name: trimmedName, companyType: 'customer' });
      setLocalCompanies((prev) => [...prev, newCompany]);
      setSelectedInList(newCompany.id);
      setSelectionMode('existing');
      setCreateName('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create customer');
    } finally {
      setIsCreating(false);
    }
  };

  const SelectionIndicator = ({ selected }: { selected: boolean }) => (
    <div className={cn(
      'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors shrink-0',
      selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
    )}>
      {selected && (
        <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-6">
        Choose how to assign a customer to this estimate. Select one of the options below.
      </p>

      {/* Option 1: OCR Extracted Customer */}
      <div
        onClick={extractedCustomer ? handleSelectOcrOption : undefined}
        className={cn(
          'rounded-lg border-2 p-4 transition-all',
          extractedCustomer ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
          selectionMode === 'ocr'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={selectionMode === 'ocr'} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Use Extracted Customer</span>
              {extractedCustomer ? (
                <Badge variant="outline" className="text-success border-success/30 bg-success/10">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Found
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <AlertCircle className="mr-1 h-3 w-3" />
                  Not Detected
                </Badge>
              )}
            </div>
            {extractedCustomer ? (
              <div className="mt-2 pl-6 text-sm">
                <p className="font-medium text-foreground">{extractedCustomer.name}</p>
                {extractedCustomer.contactName && (
                  <p className="text-muted-foreground">{extractedCustomer.contactName}</p>
                )}
                {extractedCustomer.email && (
                  <p className="text-muted-foreground">{extractedCustomer.email}</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xs text-muted-foreground">
                    Confidence: {Math.round(extractedCustomer.confidence * 100)}%
                  </p>
                  {ocrMatchedCustomer ? (
                    <Badge variant="outline" className="text-xs text-success border-success/30 bg-success/10">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Matched to {ocrMatchedCustomer.name}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-blue-600 border-blue-600/30 bg-blue-600/10">
                      <AlertCircle className="mr-1 h-3 w-3" />
                      Will be added to customer database
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground pl-6">
                No customer information was detected in the PDF.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Option 2: Select Existing Customer */}
      <div
        onClick={handleSelectExistingOption}
        className={cn(
          'rounded-lg border-2 p-4 transition-all cursor-pointer',
          selectionMode === 'existing'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={selectionMode === 'existing'} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Select Existing Customer</span>
            </div>
            <p className="text-sm text-muted-foreground pl-6 mb-3">
              Choose from your customer database.
            </p>

            {selectionMode === 'existing' && (
              <div className="pl-6 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search customers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>

                <ScrollArea className="h-40 rounded-md border bg-background">
                  <div className="p-1">
                    {filteredCustomers.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {searchQuery ? 'No customers match your search' : 'No customers available'}
                      </p>
                    ) : (
                      filteredCustomers.map((customer) => (
                        <button
                          key={customer.id}
                          onClick={() => handleSelectCustomerFromList(customer.id)}
                          className={cn(
                            'w-full flex items-center gap-3 rounded px-3 py-2 text-left transition-colors',
                            selectedInList === customer.id
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          <Circle className={cn(
                            'h-3 w-3 shrink-0',
                            selectedInList === customer.id
                              ? 'fill-current'
                              : 'text-muted-foreground/50'
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{customer.name}</p>
                            <p className={cn(
                              'truncate text-xs',
                              selectedInList === customer.id
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground'
                            )}>
                              {[customer.billingCity, customer.billingState].filter(Boolean).join(', ') || 'No location'}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>

                {selectedCustomer && (
                  <div className="rounded bg-muted/50 p-2 text-sm">
                    <span className="text-muted-foreground">Selected:</span>{' '}
                    <span className="font-medium">{selectedCustomer.name}</span>
                  </div>
                )}

                {!selectedInList && (
                  <p className="text-xs text-warning flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Please select a customer to continue
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Option 3: Create New Customer */}
      <div
        onClick={() => setSelectionMode('create')}
        className={cn(
          'rounded-lg border-2 p-4 transition-all cursor-pointer',
          selectionMode === 'create'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={selectionMode === 'create'} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Create New Customer</span>
            </div>
            <p className="text-sm text-muted-foreground pl-6">
              Add a new company to your customer database and select them.
            </p>

            {selectionMode === 'create' && (
              <div className="pl-6 mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                <div>
                  <Label className="text-xs">Company Name <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. Acme Corp"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="h-8 text-sm mt-1"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCustomer(); }}
                    autoFocus
                  />
                </div>

                {createError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {createError}
                  </p>
                )}

                <Button
                  size="sm"
                  onClick={handleCreateCustomer}
                  disabled={!createName.trim() || isCreating}
                  className="w-full"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-3.5 w-3.5" />
                      Create & Select
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Option 4: No Customer */}
      <div
        onClick={handleSelectNoCustomer}
        className={cn(
          'rounded-lg border-2 p-4 cursor-pointer transition-all',
          selectionMode === 'none'
            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <div className="flex items-start gap-4">
          <SelectionIndicator selected={selectionMode === 'none'} />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <UserX className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">No Customer</span>
            </div>
            <p className="text-sm text-muted-foreground pl-6">
              Proceed without assigning a customer. You can assign one later.
            </p>
          </div>
        </div>
      </div>

      {/* Action */}
      <div className="flex justify-end pt-6 border-t mt-6">
        <Button onClick={onNext} disabled={!canProceed} size="lg">
          Continue to Line Items
        </Button>
      </div>
    </div>
  );
}
