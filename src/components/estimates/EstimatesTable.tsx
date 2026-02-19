import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Eye, MoreHorizontal, ArrowUpDown, ArrowUp, ArrowDown, FileOutput, User, Factory, Users, Pencil, Trash2, Copy, Loader2 } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { deleteEstimate, duplicateEstimate } from '@/lib/estimates-api';
import { useAuth } from '@/contexts/AuthContext';
import type { Estimate, Company } from '@/types';

type SortKey = 'originalFileName' | 'companyId' | 'totalPrice' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface EstimatesTableProps {
  estimates: Estimate[];
  companies: Company[];
  onEstimateDeleted?: () => void;
  onEstimateDuplicated?: () => void;
}

export function EstimatesTable({ estimates, companies, onEstimateDeleted, onEstimateDuplicated }: EstimatesTableProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<Estimate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicatingId, setIsDuplicatingId] = useState<string | null>(null);

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return 'Unassigned';
    const company = companies.find((c) => c.id === companyId);
    return company?.name || 'Unknown';
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleConvertToQuote = (estimateId: string, quoteType: 'customer' | 'manufacturer' | 'both') => {
    navigate(`/app/quotes/wizard?estimateId=${estimateId}&quoteType=${quoteType}`);
  };

  const handleEditEstimate = (estimateId: string) => {
    navigate(`/app/estimates/wizard?id=${estimateId}`);
  };

  const handleDuplicate = async (estimate: Estimate) => {
    if (!user) return;
    setIsDuplicatingId(estimate.id);
    try {
      const { estimateId } = await duplicateEstimate(estimate.id, user.id);
      toast({
        title: 'Estimate remixed',
        description: 'Opening wizard to review your remix…',
      });
      onEstimateDuplicated?.();
      navigate(`/app/estimates/wizard?id=${estimateId}`);
    } catch (err) {
      toast({
        title: 'Remix failed',
        description: err instanceof Error ? err.message : 'Failed to duplicate estimate',
        variant: 'destructive',
      });
    } finally {
      setIsDuplicatingId(null);
    }
  };

  const confirmDelete = (estimate: Estimate) => {
    setEstimateToDelete(estimate);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!estimateToDelete) return;

    setIsDeleting(true);
    try {
      await deleteEstimate(estimateToDelete.id);
      toast({
        title: 'Estimate deleted',
        description: `${estimateToDelete.originalFileName} has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setEstimateToDelete(null);
      onEstimateDeleted?.();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete estimate',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const sortedEstimates = useMemo(() => {
    return [...estimates].sort((a, b) => {
      let comparison = 0;
      
      switch (sortKey) {
        case 'originalFileName':
          comparison = a.originalFileName.localeCompare(b.originalFileName);
          break;
        case 'companyId':
          comparison = getCompanyName(a.companyId).localeCompare(getCompanyName(b.companyId));
          break;
        case 'totalPrice':
          comparison = (a.totalPrice ?? 0) - (b.totalPrice ?? 0);
          break;
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [estimates, sortKey, sortDirection, companies]);

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
                onClick={() => handleSort('originalFileName')}
              >
                File Name
                <SortIcon columnKey="originalFileName" />
              </Button>
            </TableHead>
            <TableHead className="h-8">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-7 px-2 text-xs font-medium"
                onClick={() => handleSort('companyId')}
              >
                Customer
                <SortIcon columnKey="companyId" />
              </Button>
            </TableHead>
            <TableHead className="h-8">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-7 px-2 text-xs font-medium"
                onClick={() => handleSort('totalPrice')}
              >
                Total
                <SortIcon columnKey="totalPrice" />
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
                    <p className="truncate text-sm font-medium">{estimate.originalFileName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {estimate.id.slice(-8)}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                <span
                  className={`text-sm ${
                    estimate.companyId ? 'text-foreground' : 'text-muted-foreground italic'
                  }`}
                >
                  {getCompanyName(estimate.companyId)}
                </span>
              </TableCell>
              <TableCell className="py-1.5">
                <span className="text-sm font-medium">
                  {estimate.totalPrice !== null ? `$${estimate.totalPrice.toFixed(2)}` : '--'}
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
                      <DropdownMenuItem onClick={() => handleConvertToQuote(estimate.id, 'customer')}>
                        <User className="mr-2 h-4 w-4" />
                        Customer Quote
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleConvertToQuote(estimate.id, 'manufacturer')}>
                        <Factory className="mr-2 h-4 w-4" />
                        Manufacturer Quote
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleConvertToQuote(estimate.id, 'both')}>
                        <Users className="mr-2 h-4 w-4" />
                        Multiple Quotes
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
                    {estimate.ocrStatus === 'done' && (
                      <>
                        <DropdownMenuItem onClick={() => handleEditEstimate(estimate.id)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit/Review
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDuplicate(estimate)}
                          disabled={isDuplicatingId === estimate.id}
                        >
                          {isDuplicatingId === estimate.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Copy className="mr-2 h-4 w-4" />
                          )}
                          {isDuplicatingId === estimate.id ? 'Remixing…' : 'Remix'}
                        </DropdownMenuItem>
                      </>
                    )}
                    {estimate.ocrStatus !== 'processing' && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => confirmDelete(estimate)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>

    {/* Delete Confirmation Dialog */}
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Estimate?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{estimateToDelete?.originalFileName}"? This action cannot be undone and will also delete:
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>All line items and fields</li>
              <li>The original uploaded file</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
}
