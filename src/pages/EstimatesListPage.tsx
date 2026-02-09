import { useState, useEffect } from 'react';
import { FileText, Search, Upload, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadEstimateModal } from '@/components/estimates/UploadEstimateModal';
import { EstimatesTable } from '@/components/estimates/EstimatesTable';
import { listEstimates } from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';
import type { Estimate, Customer } from '@/types';

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

export default function EstimatesListPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadEstimates = async () => {
    try {
      console.log('EstimatesListPage: Loading data from Supabase...');
      setIsLoading(true);
      setError(null);

      // Load estimates from Supabase
      const loadedEstimates = await listEstimates();
      console.log('EstimatesListPage: Loaded', loadedEstimates.length, 'estimates');

      // Load customers from Supabase
      const { data: customersData } = await supabase
        .from('customers')
        .select('*')
        .order('name');

      const loadedCustomers = customersData ? customersData.map(mapCustomerRow) : [];
      console.log('EstimatesListPage: Loaded', loadedCustomers.length, 'customers');

      setEstimates(loadedEstimates);
      setCustomers(loadedCustomers);
      setIsLoading(false);
    } catch (err) {
      console.error('EstimatesListPage: Error loading data', err);
      setError(err instanceof Error ? err.message : 'Failed to load estimates');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEstimates();
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading estimates...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Error Loading Estimates</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </div>
      </div>
    );
  }

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return 'Unassigned';
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const filteredEstimates = estimates.filter(
    (estimate) => {
      const fileName = estimate?.originalFileName || '';
      const customerName = getCustomerName(estimate?.customerId || null) || '';
      const query = searchQuery.toLowerCase();
      
      return fileName.toLowerCase().includes(query) || 
             customerName.toLowerCase().includes(query);
    }
  );

  const handleUploadComplete = () => {
    // Reload estimates from Supabase after upload
    loadEstimates();
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">Estimates</h1>
          <p className="mt-1 text-muted-foreground">
            View and manage parsed PDF estimates
          </p>
        </div>
        <Button onClick={() => setUploadModalOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload New
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Estimates</CardTitle>
              <CardDescription>{estimates.length} total estimates</CardDescription>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredEstimates.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No estimates match your search</p>
            </div>
          ) : (
            <EstimatesTable 
              estimates={filteredEstimates} 
              customers={customers}
              onEstimateDeleted={loadEstimates}
            />
          )}
        </CardContent>
      </Card>

      <UploadEstimateModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onUploadComplete={handleUploadComplete}
      />
    </div>
  );
}
