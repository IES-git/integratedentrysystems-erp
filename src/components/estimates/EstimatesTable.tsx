import { useState, useMemo } from 'react';
import { FileText, Eye, MoreHorizontal, ArrowUpDown, ArrowUp, ArrowDown, FileOutput, User, Factory, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { ConvertToQuoteWizard } from './ConvertToQuoteWizard';
import type { Estimate, Customer } from '@/types';

type SortKey = 'originalPdfName' | 'customerId' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface EstimatesTableProps {
  estimates: Estimate[];
  customers: Customer[];
}

export function EstimatesTable({ estimates, customers }: EstimatesTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [wizardEstimate, setWizardEstimate] = useState<Estimate | null>(null);

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return 'Unassigned';
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || 'Unknown';
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const sortedEstimates = useMemo(() => {
    return [...estimates].sort((a, b) => {
      let comparison = 0;
      
      switch (sortKey) {
        case 'originalPdfName':
          comparison = a.originalPdfName.localeCompare(b.originalPdfName);
          break;
        case 'customerId':
          comparison = getCustomerName(a.customerId).localeCompare(getCustomerName(b.customerId));
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [estimates, sortKey, sortDirection, customers]);

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };


  if (estimates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">No estimates yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 px-2 text-xs font-medium"
                  onClick={() => handleSort('originalPdfName')}
                >
                  File Name
                  <SortIcon columnKey="originalPdfName" />
                </Button>
              </TableHead>
              <TableHead className="h-8">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 px-2 text-xs font-medium"
                  onClick={() => handleSort('customerId')}
                >
                  Customer
                  <SortIcon columnKey="customerId" />
                </Button>
              </TableHead>
              <TableHead className="h-8">
                <span className="text-xs font-medium">Convert To</span>
              </TableHead>
              <TableHead className="hidden h-8 md:table-cell">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 px-2 text-xs font-medium"
                  onClick={() => handleSort('createdAt')}
                >
                  Uploaded
                  <SortIcon columnKey="createdAt" />
                </Button>
              </TableHead>
              <TableHead className="h-8 w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEstimates.map((estimate) => (
              <TableRow key={estimate.id} className="h-10">
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{estimate.originalPdfName}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {estimate.id.slice(-8)}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-1.5">
                  <span
                    className={`text-sm ${
                      estimate.customerId ? 'text-foreground' : 'text-muted-foreground italic'
                    }`}
                  >
                    {getCustomerName(estimate.customerId)}
                  </span>
                </TableCell>
                <TableCell className="py-1.5">
                  {estimate.ocrStatus === 'done' ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                          <FileOutput className="h-3.5 w-3.5" />
                          Quote
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setWizardEstimate(estimate)}>
                          <User className="mr-2 h-4 w-4" />
                          Customer Quote
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setWizardEstimate(estimate)}>
                          <Factory className="mr-2 h-4 w-4" />
                          Manufacturer Quote
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setWizardEstimate(estimate)}>
                          <Users className="mr-2 h-4 w-4" />
                          Both
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Badge variant="secondary" className="h-6 text-xs">
                      {estimate.ocrStatus === 'processing' ? 'Processing...' : estimate.ocrStatus}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden py-1.5 text-sm md:table-cell">
                  {new Date(estimate.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="py-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {wizardEstimate && (
        <ConvertToQuoteWizard
          estimate={wizardEstimate}
          open={!!wizardEstimate}
          onOpenChange={(open) => !open && setWizardEstimate(null)}
        />
      )}
    </>
  );
}
