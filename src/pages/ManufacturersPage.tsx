import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  MoreHorizontal,
  Building2,
  MapPin,
  Users,
  AlertCircle,
  Factory,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  listManufacturers,
  createCompany,
  updateCompany,
  deleteCompany,
  type CompanyWithContactCount,
} from '@/lib/companies-api';
import type { Company } from '@/types';

export default function ManufacturersPage() {
  const { toast } = useToast();

  const [manufacturers, setManufacturers] = useState<CompanyWithContactCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingManufacturer, setEditingManufacturer] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyWithContactCount | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listManufacturers();
      setManufacturers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load manufacturers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredManufacturers = manufacturers.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openNewDialog = () => {
    setEditingManufacturer(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (manufacturer: Company) => {
    setEditingManufacturer(manufacturer);
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setIsSaving(true);
    try {
      const input = {
        name: fd.get('name') as string,
        companyType: 'manufacturer' as const,
        billingAddress: (fd.get('billingStreet') as string) || null,
        billingCity: (fd.get('billingCity') as string) || null,
        billingState: (fd.get('billingState') as string) || null,
        billingZip: (fd.get('billingZip') as string) || null,
        notes: (fd.get('notes') as string) || null,
      };

      if (editingManufacturer) {
        await updateCompany(editingManufacturer.id, input);
        toast({ title: 'Manufacturer updated', description: 'Changes have been saved.' });
      } else {
        await createCompany(input);
        toast({ title: 'Manufacturer created', description: 'New manufacturer has been added.' });
      }

      await load();
      setIsDialogOpen(false);
      setEditingManufacturer(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save manufacturer',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCompany(deleteTarget.id);
      toast({ title: 'Manufacturer deleted', description: 'Manufacturer has been removed.' });
      await load();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete manufacturer',
        variant: 'destructive',
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading manufacturers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Error Loading Manufacturers</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">{error}</p>
          <Button onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">
            Manufacturers
          </h1>
          <p className="mt-1 text-muted-foreground">
            Companies you source doors, frames, and hardware from — drives pricing on estimates
          </p>
        </div>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Add Manufacturer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Manufacturers</CardTitle>
              <CardDescription>{manufacturers.length} total manufacturers</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search manufacturers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredManufacturers.length === 0 ? (
            <div className="py-12 text-center">
              <Factory className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No manufacturers match your search' : 'No manufacturers yet'}
              </p>
              {!searchQuery && (
                <Button onClick={openNewDialog} variant="outline" className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first manufacturer
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Manufacturer</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead>Contacts</TableHead>
                    <TableHead className="hidden lg:table-cell">Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredManufacturers.map((manufacturer) => (
                    <TableRow key={manufacturer.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{manufacturer.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Added {new Date(manufacturer.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(manufacturer.billingCity || manufacturer.billingState) && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span>
                              {[manufacturer.billingCity, manufacturer.billingState]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {manufacturer.contactCount}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant={manufacturer.active ? 'default' : 'secondary'}>
                          {manufacturer.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(manufacturer)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(manufacturer)}
                              className="text-destructive focus:text-destructive"
                            >
                              Delete
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

      {/* Add / Edit Manufacturer Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editingManufacturer ? 'Edit Manufacturer' : 'New Manufacturer'}
              </DialogTitle>
              <DialogDescription>
                {editingManufacturer
                  ? 'Update manufacturer information'
                  : 'Add a supplier you source door products from'}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingManufacturer?.name}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Address</Label>
                <Input
                  name="billingStreet"
                  defaultValue={editingManufacturer?.billingAddress ?? ''}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-3"
                    name="billingCity"
                    defaultValue={editingManufacturer?.billingCity ?? ''}
                    placeholder="City"
                  />
                  <Input
                    className="col-span-1"
                    name="billingState"
                    defaultValue={editingManufacturer?.billingState ?? ''}
                    placeholder="ST"
                    maxLength={2}
                  />
                  <Input
                    className="col-span-2"
                    name="billingZip"
                    defaultValue={editingManufacturer?.billingZip ?? ''}
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  defaultValue={editingManufacturer?.notes ?? ''}
                  rows={2}
                  placeholder="e.g. preferred vendor for hollow metal doors, lead times, rep contact info..."
                />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  setEditingManufacturer(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving
                  ? 'Saving...'
                  : editingManufacturer
                  ? 'Save Changes'
                  : 'Create Manufacturer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Manufacturer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will also
              remove all contacts. Estimate items linked to this manufacturer will be unassigned.
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
    </div>
  );
}
