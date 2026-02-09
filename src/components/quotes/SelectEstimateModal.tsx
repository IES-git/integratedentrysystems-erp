import { useState, useMemo, useEffect } from 'react';
import { Search, FileText, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { listEstimates } from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { Estimate, Customer, User } from '@/types';

interface SelectEstimateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (estimateId: string) => void;
}

// Map Supabase customers row to our Customer type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomerRow(row: any): Customer {
  return {
    id: row.id,
    name: row.name,
    primaryContactName: row.contact_person || '',
    email: row.email || '',
    phone: row.phone || '',
    billingAddress: [row.address, row.city, row.state, row.zip]
      .filter(Boolean)
      .join(', '),
    shippingAddress: '',
    notes: row.notes || '',
    createdAt: row.created_at,
  };
}

// Map Supabase users row to our User type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUserRow(row: any): User {
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    jobTitle: row.job_title,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
  };
}

export function SelectEstimateModal({ open, onOpenChange, onSelect }: SelectEstimateModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [salesRepFilter, setSalesRepFilter] = useState<string>('all');
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Load data when modal opens
  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setIsLoading(true);
      try {
        // Load estimates from Supabase
        const loadedEstimates = await listEstimates();
        setEstimates(loadedEstimates);

        // Load customers from Supabase
        const { data: customersData } = await supabase
          .from('customers')
          .select('*')
          .order('name');
        if (customersData) {
          setCustomers(customersData.map(mapCustomerRow));
        }

        // Load users from Supabase
        const { data: usersData } = await supabase
          .from('users')
          .select('*')
          .order('first_name');
        if (usersData) {
          setUsers(usersData.map(mapUserRow));
        }
      } catch (err) {
        console.error('Error loading data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [open]);

  // Only show estimates that are "done" (processed)
  const processedEstimates = useMemo(() => {
    return estimates.filter((e) => e.ocrStatus === 'done');
  }, [estimates]);

  const getCustomerName = (customerId: string | null): string => {
    if (!customerId) return 'Unassigned';
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const getUserName = (userId: string): string => {
    const user = users.find((u) => u.id === userId);
    return user?.name || 'Unknown';
  };

  const filteredEstimates = useMemo(() => {
    return processedEstimates.filter((estimate) => {
      // Search filter
      const customerName = getCustomerName(estimate.customerId).toLowerCase();
      const fileName = estimate.originalFileName.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        customerName.includes(searchQuery.toLowerCase()) ||
        fileName.includes(searchQuery.toLowerCase());

      // Customer filter
      const matchesCustomer =
        customerFilter === 'all' ||
        (customerFilter === 'unassigned' && !estimate.customerId) ||
        estimate.customerId === customerFilter;

      // Sales rep filter
      const matchesSalesRep =
        salesRepFilter === 'all' || estimate.uploadedByUserId === salesRepFilter;

      return matchesSearch && matchesCustomer && matchesSalesRep;
    });
  }, [processedEstimates, searchQuery, customerFilter, salesRepFilter, customers]);

  const handleConfirm = () => {
    if (selectedEstimateId) {
      onSelect(selectedEstimateId);
      onOpenChange(false);
      setSelectedEstimateId(null);
      setSearchQuery('');
      setCustomerFilter('all');
      setSalesRepFilter('all');
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    setSelectedEstimateId(null);
    setSearchQuery('');
    setCustomerFilter('all');
    setSalesRepFilter('all');
  };

  // Get unique customers from estimates for filter
  const customersInEstimates = useMemo(() => {
    const customerIds = new Set(processedEstimates.map((e) => e.customerId).filter(Boolean));
    return customers.filter((c) => customerIds.has(c.id));
  }, [processedEstimates, customers]);

  // Get unique sales reps from estimates for filter
  const salesRepsInEstimates = useMemo(() => {
    const userIds = new Set(processedEstimates.map((e) => e.uploadedByUserId));
    return users.filter((u) => userIds.has(u.id));
  }, [processedEstimates, users]);

  const hasUnassigned = processedEstimates.some((e) => !e.customerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Select Estimate</DialogTitle>
          <DialogDescription>
            Choose a processed estimate to create a quote from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by file name or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filters */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Filter by Customer
              </label>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Customers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  {hasUnassigned && <SelectItem value="unassigned">Unassigned</SelectItem>}
                  {customersInEstimates.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Filter by Sales Rep
              </label>
              <Select value={salesRepFilter} onValueChange={setSalesRepFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Sales Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sales Reps</SelectItem>
                  {salesRepsInEstimates.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Estimates List */}
          <ScrollArea className="h-64 rounded-md border">
            <div className="p-2">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="mb-2 h-8 w-8 animate-spin text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Loading estimates...</p>
                </div>
              ) : filteredEstimates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {processedEstimates.length === 0
                      ? 'No processed estimates available'
                      : 'No estimates match your filters'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredEstimates.map((estimate) => (
                    <button
                      key={estimate.id}
                      onClick={() => setSelectedEstimateId(estimate.id)}
                      className={cn(
                        'w-full flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                        selectedEstimateId === estimate.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      <FileText
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          selectedEstimateId === estimate.id
                            ? 'text-primary-foreground'
                            : 'text-primary'
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {estimate.originalFileName}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs">
                          <span
                            className={cn(
                              selectedEstimateId === estimate.id
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground'
                            )}
                          >
                            {getCustomerName(estimate.customerId)}
                          </span>
                          <span
                            className={cn(
                              'hidden sm:inline',
                              selectedEstimateId === estimate.id
                                ? 'text-primary-foreground/50'
                                : 'text-muted-foreground/50'
                            )}
                          >
                            •
                          </span>
                          <span
                            className={cn(
                              'hidden sm:inline',
                              selectedEstimateId === estimate.id
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground'
                            )}
                          >
                            {new Date(estimate.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-xs',
                          selectedEstimateId === estimate.id
                            ? 'border-primary-foreground/30 text-primary-foreground'
                            : 'border-success/30 text-success'
                        )}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Ready
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Selected count */}
          {selectedEstimateId && (
            <p className="text-sm text-muted-foreground">
              1 estimate selected
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedEstimateId}>
            Create Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
