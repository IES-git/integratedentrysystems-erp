import { useState } from 'react';
import { FileText, Search, Eye, MoreHorizontal, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { estimateStorage, customerStorage } from '@/lib/storage';
import type { Estimate, OcrStatus } from '@/types';

export default function EstimatesListPage() {
  const [estimates] = useState<Estimate[]>(estimateStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');

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

  const getStatusIcon = (status: OcrStatus) => {
    switch (status) {
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-warning animate-pulse" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: OcrStatus) => {
    const variants: Record<OcrStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      done: 'outline',
      processing: 'default',
      pending: 'secondary',
      error: 'destructive',
    };
    return (
      <Badge variant={variants[status]} className="capitalize">
        {status}
      </Badge>
    );
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Estimates</h1>
          <p className="mt-1 text-muted-foreground">
            View and manage parsed PDF estimates
          </p>
        </div>
        <Button asChild>
          <a href="/app/estimates/new">
            <FileText className="mr-2 h-4 w-4" />
            Upload New
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Estimates</CardTitle>
              <CardDescription>{estimates.length} total estimates</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search estimates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredEstimates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No estimates match your search' : 'No estimates yet'}
              </p>
              {!searchQuery && (
                <Button asChild className="mt-4">
                  <a href="/app/estimates/new">Upload Your First Estimate</a>
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEstimates.map((estimate) => (
                    <TableRow key={estimate.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 shrink-0 text-primary" />
                          <div>
                            <p className="font-medium">{estimate.originalPdfName}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              ID: {estimate.id.slice(-8)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            estimate.customerId
                              ? 'text-foreground'
                              : 'text-muted-foreground italic'
                          }
                        >
                          {getCustomerName(estimate.customerId)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(estimate.ocrStatus)}
                          {getStatusBadge(estimate.ocrStatus)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {new Date(estimate.createdAt).toLocaleDateString()}
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
                              <a href={`/app/estimates/${estimate.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </a>
                            </DropdownMenuItem>
                            {estimate.ocrStatus === 'done' && (
                              <DropdownMenuItem asChild>
                                <a href={`/app/estimates/${estimate.id}/review`}>
                                  Review Fields
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild>
                              <a href={`/app/quotes/new?estimateId=${estimate.id}`}>
                                Create Quote
                              </a>
                            </DropdownMenuItem>
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
