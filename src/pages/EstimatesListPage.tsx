import { useState } from 'react';
import { FileText, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadEstimateModal } from '@/components/estimates/UploadEstimateModal';
import { EstimatesTable } from '@/components/estimates/EstimatesTable';
import { estimateStorage, customerStorage } from '@/lib/storage';
import type { Estimate } from '@/types';

export default function EstimatesListPage() {
  const [estimates, setEstimates] = useState<Estimate[]>(estimateStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const customers = customerStorage.getAll();

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return 'Unassigned';
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const filteredEstimates = estimates.filter(
    (estimate) =>
      estimate.originalPdfName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      getCustomerName(estimate.customerId).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUploadComplete = () => {
    setEstimates(estimateStorage.getAll());
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Estimates</h1>
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
            <EstimatesTable estimates={filteredEstimates} customers={customers} />
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
