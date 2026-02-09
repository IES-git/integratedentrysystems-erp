import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  CheckCircle2,
  Clock,
  Trash2,
  Check,
  X,
  BookOpen,
  RefreshCw,
  AlertCircle,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  getFieldDefinitions,
  updateFieldDefinitionStatus,
  updateFieldDefinition,
  deleteFieldDefinition,
} from '@/lib/estimates-api';
import type { FieldDefinition, FieldDefinitionStatus, FieldValueType } from '@/types';

export default function AdminFieldDefinitionsPage() {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending_review' | 'approved'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<FieldDefinition | null>(null);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<FieldDefinition | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editValueType, setEditValueType] = useState<FieldValueType>('string');

  const { toast } = useToast();

  const fetchFields = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getFieldDefinitions();
      setFields(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load field definitions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const pendingCount = fields.filter((f) => f.status === 'pending_review').length;
  const approvedCount = fields.filter((f) => f.status === 'approved').length;

  const filteredFields = fields.filter((field) => {
    // Tab filter
    if (activeTab === 'pending_review' && field.status !== 'pending_review') return false;
    if (activeTab === 'approved' && field.status !== 'approved') return false;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        field.fieldKey.toLowerCase().includes(q) ||
        field.fieldLabel.toLowerCase().includes(q) ||
        (field.description && field.description.toLowerCase().includes(q))
      );
    }

    return true;
  });

  const handleApprove = async (field: FieldDefinition) => {
    try {
      setActionLoading(field.id);
      const updated = await updateFieldDefinitionStatus(field.id, 'approved');
      setFields((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f))
      );
      toast({
        title: 'Field approved',
        description: `"${field.fieldLabel}" is now approved and will be used in future extractions.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to approve field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (field: FieldDefinition) => {
    try {
      setActionLoading(field.id);
      const updated = await updateFieldDefinitionStatus(field.id, 'pending_review');
      setFields((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f))
      );
      toast({
        title: 'Field moved to pending',
        description: `"${field.fieldLabel}" has been moved back to pending review.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setActionLoading(deleteTarget.id);
      await deleteFieldDefinition(deleteTarget.id);
      setFields((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      toast({
        title: 'Field deleted',
        description: `"${deleteTarget.fieldLabel}" has been permanently removed.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
      setDeleteTarget(null);
    }
  };

  const openEditDialog = (field: FieldDefinition) => {
    setEditTarget(field);
    setEditLabel(field.fieldLabel);
    setEditDescription(field.description || '');
    setEditValueType(field.valueType);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    try {
      setActionLoading(editTarget.id);
      const updated = await updateFieldDefinition(editTarget.id, {
        fieldLabel: editLabel,
        description: editDescription || null,
        valueType: editValueType,
      });
      setFields((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f))
      );
      toast({
        title: 'Field updated',
        description: `"${updated.fieldLabel}" has been updated.`,
      });
      setEditTarget(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update field',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveAll = async () => {
    const pendingFields = fields.filter((f) => f.status === 'pending_review');
    if (pendingFields.length === 0) return;

    try {
      setActionLoading('approve-all');
      const results = await Promise.allSettled(
        pendingFields.map((f) => updateFieldDefinitionStatus(f.id, 'approved'))
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      // Refresh full list to get accurate state
      await fetchFields();

      if (failed > 0) {
        toast({
          title: 'Partial success',
          description: `Approved ${succeeded} fields, ${failed} failed.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'All fields approved',
          description: `${succeeded} pending fields have been approved.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to approve fields',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const getValueTypeBadge = (type: FieldValueType) => {
    const config: Record<FieldValueType, string> = {
      string: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      number: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      bool: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
      date: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
      code: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    };
    return (
      <Badge variant="secondary" className={`font-mono text-xs ${config[type]}`}>
        {type}
      </Badge>
    );
  };

  const getStatusBadge = (status: FieldDefinitionStatus) => {
    if (status === 'approved') {
      return (
        <Badge variant="outline" className="flex w-fit items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Approved
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="flex w-fit items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Clock className="h-3 w-3" />
        Pending Review
      </Badge>
    );
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Field Definitions</h1>
          <p className="mt-1 text-muted-foreground">
            Manage AI-discovered fields used in estimate extraction
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchFields} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Fields</CardDescription>
            <CardTitle className="text-3xl">{fields.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              All discovered field definitions
            </p>
          </CardContent>
        </Card>
        <Card className={pendingCount > 0 ? 'border-amber-500/50' : ''}>
          <CardHeader className="pb-2">
            <CardDescription>Pending Review</CardDescription>
            <CardTitle className="text-3xl text-amber-600 dark:text-amber-400">
              {pendingCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {pendingCount > 0
                ? 'New fields awaiting approval'
                : 'No pending fields'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Approved</CardDescription>
            <CardTitle className="text-3xl text-emerald-600 dark:text-emerald-400">
              {approvedCount}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Active fields sent to Gemini for extraction
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card>
        <CardHeader>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <TabsList>
                <TabsTrigger value="all">
                  All ({fields.length})
                </TabsTrigger>
                <TabsTrigger value="pending_review">
                  Pending ({pendingCount})
                </TabsTrigger>
                <TabsTrigger value="approved">
                  Approved ({approvedCount})
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                {activeTab === 'pending_review' && pendingCount > 0 && (
                  <Button
                    size="sm"
                    onClick={handleApproveAll}
                    disabled={actionLoading === 'approve-all'}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Approve All ({pendingCount})
                  </Button>
                )}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search fields..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {/* Error state */}
            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Tab content shared across all tabs (same table, different filters) */}
            <TabsContent value="all" className="mt-0">
              <FieldTable
                fields={filteredFields}
                loading={loading}
                searchQuery={searchQuery}
                actionLoading={actionLoading}
                getValueTypeBadge={getValueTypeBadge}
                getStatusBadge={getStatusBadge}
                onApprove={handleApprove}
                onReject={handleReject}
                onEdit={openEditDialog}
                onDelete={setDeleteTarget}
              />
            </TabsContent>
            <TabsContent value="pending_review" className="mt-0">
              <FieldTable
                fields={filteredFields}
                loading={loading}
                searchQuery={searchQuery}
                actionLoading={actionLoading}
                getValueTypeBadge={getValueTypeBadge}
                getStatusBadge={getStatusBadge}
                onApprove={handleApprove}
                onReject={handleReject}
                onEdit={openEditDialog}
                onDelete={setDeleteTarget}
              />
            </TabsContent>
            <TabsContent value="approved" className="mt-0">
              <FieldTable
                fields={filteredFields}
                loading={loading}
                searchQuery={searchQuery}
                actionLoading={actionLoading}
                getValueTypeBadge={getValueTypeBadge}
                getStatusBadge={getStatusBadge}
                onApprove={handleApprove}
                onReject={handleReject}
                onEdit={openEditDialog}
                onDelete={setDeleteTarget}
              />
            </TabsContent>
          </Tabs>
        </CardHeader>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete field definition?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{' '}
              <span className="font-semibold">"{deleteTarget?.fieldLabel}"</span>{' '}
              (<code className="rounded bg-muted px-1 text-xs">{deleteTarget?.fieldKey}</code>).
              Existing item fields referencing this definition will not be deleted, but the
              link will be broken. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Edit Field Definition</DialogTitle>
            <DialogDescription>
              Update the label, type, or description for{' '}
              <code className="rounded bg-muted px-1 text-xs">{editTarget?.fieldKey}</code>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-label">Display Label</Label>
              <Input
                id="edit-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-type">Value Type</Label>
              <Select value={editValueType} onValueChange={(v) => setEditValueType(v as FieldValueType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="bool">Boolean</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="code">Code</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="AI-generated description of what this field represents..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!editLabel.trim() || actionLoading === editTarget?.id}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Field Table
// ---------------------------------------------------------------------------

interface FieldTableProps {
  fields: FieldDefinition[];
  loading: boolean;
  searchQuery: string;
  actionLoading: string | null;
  getValueTypeBadge: (type: FieldValueType) => React.ReactNode;
  getStatusBadge: (status: FieldDefinitionStatus) => React.ReactNode;
  onApprove: (field: FieldDefinition) => void;
  onReject: (field: FieldDefinition) => void;
  onEdit: (field: FieldDefinition) => void;
  onDelete: (field: FieldDefinition) => void;
}

function FieldTable({
  fields,
  loading,
  searchQuery,
  actionLoading,
  getValueTypeBadge,
  getStatusBadge,
  onApprove,
  onReject,
  onEdit,
  onDelete,
}: FieldTableProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <RefreshCw className="mb-4 h-8 w-8 animate-spin text-muted-foreground/50" />
        <p className="text-muted-foreground">Loading field definitions...</p>
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">
          {searchQuery
            ? 'No fields match your search'
            : 'No field definitions found. Fields will appear here as Gemini discovers them during estimate processing.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Description</TableHead>
            <TableHead className="text-right">Usage</TableHead>
            <TableHead className="hidden md:table-cell">Discovered</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => (
            <TableRow
              key={field.id}
              className={field.status === 'pending_review' ? 'bg-amber-500/5' : ''}
            >
              <TableCell>
                <div>
                  <p className="font-medium">{field.fieldLabel}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {field.fieldKey}
                  </p>
                </div>
              </TableCell>
              <TableCell>{getValueTypeBadge(field.valueType)}</TableCell>
              <TableCell>{getStatusBadge(field.status)}</TableCell>
              <TableCell className="hidden max-w-xs truncate lg:table-cell">
                <span className="text-sm text-muted-foreground">
                  {field.description || '—'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono text-sm">
                  {field.usageCount}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                {new Date(field.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  {field.status === 'pending_review' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                          onClick={() => onApprove(field)}
                          disabled={actionLoading === field.id}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Approve</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
                          onClick={() => onReject(field)}
                          disabled={actionLoading === field.id}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Move to Pending</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onEdit(field)}
                        disabled={actionLoading === field.id}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(field)}
                        disabled={actionLoading === field.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
