import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, MoreHorizontal, ArrowUpDown, ArrowUp, ArrowDown, FileOutput, User, Factory, Users, Pencil, Trash2, Copy, Loader2, Layers, DoorOpen, RectangleHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import type { EstimateWithItems, Company } from '@/types';

type SortKey = 'companyId' | 'totalPrice' | 'createdAt';
type SortDirection = 'asc' | 'desc';

type EstimateLineItem = EstimateWithItems['items'][number];

const DOOR_ITEM_TYPES = new Set(['door', 'doors']);
const FRAME_ITEM_TYPES = new Set(['frame', 'frames']);
const GENERIC_LABELS = new Set(['door', 'frame']);

/**
 * Picks the most descriptive text for a door/frame: the human label when it
 * carries detail (e.g. "HM - Polystyrene"), otherwise the canonical code
 * (e.g. "CH") so generic "Door"/"Frame" labels still distinguish estimates.
 */
function describeDoorFrame(item: EstimateLineItem): string {
  const label = item.itemLabel?.trim();
  const code = item.canonicalCode?.trim();
  if (label && !GENERIC_LABELS.has(label.toLowerCase())) return label;
  return code || label || '—';
}

/** Groups an estimate's items into door / frame summaries plus everything else. */
function summarizeItems(items: EstimateLineItem[]) {
  const doors: string[] = [];
  const frames: string[] = [];
  const others: string[] = [];
  const seenDoors = new Set<string>();
  const seenFrames = new Set<string>();
  const seenOthers = new Set<string>();

  for (const item of items) {
    const type = item.itemType?.toLowerCase() ?? '';
    if (DOOR_ITEM_TYPES.has(type)) {
      const value = describeDoorFrame(item);
      if (!seenDoors.has(value)) {
        seenDoors.add(value);
        doors.push(value);
      }
    } else if (FRAME_ITEM_TYPES.has(type)) {
      const value = describeDoorFrame(item);
      if (!seenFrames.has(value)) {
        seenFrames.add(value);
        frames.push(value);
      }
    } else {
      const value = item.itemLabel?.trim() || item.canonicalCode?.trim() || '';
      if (value && !seenOthers.has(value)) {
        seenOthers.add(value);
        others.push(value);
      }
    }
  }

  return { doors, frames, others };
}

function formatQuoteStatus(status: EstimateWithItems['latestQuoteStatus']): string {
  if (!status) return 'Not quoted';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface EstimatesTableProps {
  estimates: EstimateWithItems[];
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
  const [estimateToDelete, setEstimateToDelete] = useState<EstimateWithItems | null>(null);
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

  const handleConvertToQuote = (estimate: EstimateWithItems, quoteType: 'customer' | 'manufacturer' | 'both') => {
    if (!estimate.jobName?.trim()) {
      toast({
        title: 'Job setup required',
        description: 'Add a job name and review the project details before creating a quote.',
        variant: 'destructive',
      });
      navigate(`/app/estimates/${estimate.id}/edit?step=1`);
      return;
    }
    navigate(`/app/quotes/wizard?estimateId=${estimate.id}&quoteType=${quoteType}`);
  };

  const handleEditEstimate = (estimateId: string) => {
    navigate(`/app/estimates/${estimateId}/edit`);
  };

  const handleReviewEstimate = (estimateId: string) => {
    navigate(`/app/estimates/${estimateId}/review`);
  };

  const handleReviewSourceItems = (estimateId: string) => {
    navigate(`/app/estimates/wizard?id=${estimateId}`);
  };

  const handleDuplicate = async (estimate: EstimateWithItems) => {
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

  const confirmDelete = (estimate: EstimateWithItems) => {
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
        description: 'The estimate has been deleted.',
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
                  onClick={() => handleSort('companyId')}
                >
                  Customer
                  <SortIcon columnKey="companyId" />
                </Button>
              </TableHead>
              <TableHead className="h-8">
                <span className="text-xs font-medium">Items</span>
              </TableHead>
              <TableHead className="h-8">
                <span className="text-xs font-medium">Openings</span>
              </TableHead>
              <TableHead className="h-8">
                <span className="text-xs font-medium">Quote Status</span>
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
              <TableHead className="h-8">
                <span className="text-xs font-medium">Created By</span>
              </TableHead>
              <TableHead className="h-8">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 px-2 text-xs font-medium"
                  onClick={() => handleSort('createdAt')}
                >
                  Date Made
                  <SortIcon columnKey="createdAt" />
                </Button>
              </TableHead>
              <TableHead className="h-8 w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEstimates.map((estimate) => {
              const spec = estimate.specSummary ?? null;
              const specMeta = spec
                ? [spec.config, spec.size, spec.wall, spec.fireLabeled ? 'Labeled' : null].filter(
                    (p): p is string => Boolean(p)
                  )
                : [];
              const { doors, frames, others } = summarizeItems(estimate.items);
              const hasPrimary = doors.length > 0 || frames.length > 0;
              const visibleOthers = others.slice(0, 3);
              const hiddenOthers = others.slice(3);
              const openingNames = estimate.openingNames ?? [];
              const jobMeta = [estimate.customerPo ? `PO ${estimate.customerPo}` : null, estimate.jobNumber ? `Job ${estimate.jobNumber}` : null]
                .filter(Boolean)
                .join(' · ');

              return (
                <TableRow key={estimate.id} className="h-10">
                  <TableCell className="py-1.5">
                    <div className="flex flex-col gap-0.5">
                      {estimate.jobName && (
                        <span className="max-w-[220px] truncate text-sm font-semibold text-foreground">
                          {estimate.jobName}
                        </span>
                      )}
                      <span
                        className={`text-sm ${
                          estimate.companyId ? 'text-foreground font-medium' : 'text-muted-foreground italic'
                        }`}
                      >
                        {getCompanyName(estimate.companyId)}
                      </span>
                      {jobMeta && (
                        <span className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                          {jobMeta}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {estimate.id.slice(-8)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    {spec ? (
                      <div className="flex max-w-[300px] flex-col gap-1">
                        {spec.door && (
                          <div className="flex items-start gap-1.5 text-xs leading-tight">
                            <DoorOpen className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-foreground">{spec.door}</span>
                          </div>
                        )}
                        {spec.frame && (
                          <div className="flex items-start gap-1.5 text-xs leading-tight">
                            <RectangleHorizontal className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-foreground">{spec.frame}</span>
                          </div>
                        )}
                        {specMeta.length > 0 && (
                          <span className="text-[11px] leading-tight text-muted-foreground">
                            {specMeta.join(' · ')}
                          </span>
                        )}
                        {!spec.door && !spec.frame && specMeta.length === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    ) : estimate.items.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex max-w-[280px] flex-col gap-1">
                        {doors.length > 0 && (
                          <div className="flex items-start gap-1.5 text-xs leading-tight">
                            <DoorOpen className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-foreground">
                              {doors.join(', ')}
                            </span>
                          </div>
                        )}
                        {frames.length > 0 && (
                          <div className="flex items-start gap-1.5 text-xs leading-tight">
                            <RectangleHorizontal className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-medium text-foreground">
                              {frames.join(', ')}
                            </span>
                          </div>
                        )}
                        {others.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            {visibleOthers.map((value) => (
                              <Badge
                                key={value}
                                variant="secondary"
                                className="h-5 max-w-[160px] truncate rounded px-1.5 text-[10px] font-normal"
                                title={value}
                              >
                                {value}
                              </Badge>
                            ))}
                            {hiddenOthers.length > 0 && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="h-5 cursor-default rounded px-1.5 text-[10px] font-normal text-muted-foreground"
                                    >
                                      +{hiddenOthers.length}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[240px]">
                                    <div className="flex flex-col gap-0.5 text-xs">
                                      {hiddenOthers.map((value) => (
                                        <span key={value}>{value}</span>
                                      ))}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        )}
                        {!hasPrimary && others.length === 0 && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {(estimate.openingsCount ?? 0) > 0 ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-sm text-foreground">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                          {estimate.openingsCount} {estimate.openingsCount === 1 ? 'opening' : 'openings'}
                        </div>
                        {openingNames.length > 0 && (
                          <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                            {openingNames.join(', ')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant={estimate.latestQuoteStatus ? 'outline' : 'secondary'} className="h-6 rounded text-xs">
                      {formatQuoteStatus(estimate.latestQuoteStatus)}
                    </Badge>
                    {(estimate.quoteCount ?? 0) > 1 && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {estimate.quoteCount} quotes
                      </p>
                    )}
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
                          <DropdownMenuItem onClick={() => handleConvertToQuote(estimate, 'customer')}>
                            <User className="mr-2 h-4 w-4" />
                            Customer Quote
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleConvertToQuote(estimate, 'manufacturer')}>
                            <Factory className="mr-2 h-4 w-4" />
                            Manufacturer Quote
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleConvertToQuote(estimate, 'both')}>
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
                  <TableCell className="py-1.5 text-sm text-muted-foreground">
                    {estimate.createdByUserName ?? '—'}
                  </TableCell>
                  <TableCell className="py-1.5 text-sm text-muted-foreground">
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
                              Edit Estimate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleReviewEstimate(estimate.id)}>
                              <DoorOpen className="mr-2 h-4 w-4" />
                              Review Pricing
                            </DropdownMenuItem>
                            {estimate.source !== 'manual' && (
                              <DropdownMenuItem onClick={() => handleReviewSourceItems(estimate.id)}>
                                <FileText className="mr-2 h-4 w-4" />
                                Review Source Items
                              </DropdownMenuItem>
                            )}
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this estimate? This action cannot be undone and will also delete:
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
