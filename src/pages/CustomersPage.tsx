import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreHorizontal,
  Users,
  MapPin,
  AlertCircle,
  Building2,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  createContact,
  type CompanyWithContactCount,
} from '@/lib/companies-api';
import type { Company } from '@/types';

export default function CustomersPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [companies, setCompanies] = useState<CompanyWithContactCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyWithContactCount | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [addContact, setAddContact] = useState(true);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listCompanies();
      setCompanies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setIsSaving(true);
    try {
      const companyInput = {
        name: fd.get('companyName') as string,
        billingAddress: (fd.get('billingStreet') as string) || null,
        billingCity: (fd.get('billingCity') as string) || null,
        billingState: (fd.get('billingState') as string) || null,
        billingZip: (fd.get('billingZip') as string) || null,
        shippingAddress: (fd.get('shippingStreet') as string) || null,
        shippingCity: (fd.get('shippingCity') as string) || null,
        shippingState: (fd.get('shippingState') as string) || null,
        shippingZip: (fd.get('shippingZip') as string) || null,
        notes: (fd.get('notes') as string) || null,
      };

      if (editingCompany) {
        await updateCompany(editingCompany.id, companyInput);
        toast({ title: 'Company updated', description: 'Changes have been saved.' });
      } else {
        const newCompany = await createCompany(companyInput);
        if (addContact) {
          const firstName = fd.get('firstName') as string;
          const lastName = fd.get('lastName') as string;
          if (firstName && lastName) {
            await createContact({
              companyId: newCompany.id,
              firstName,
              lastName,
              email: (fd.get('email') as string) || undefined,
              phone: (fd.get('phone') as string) || undefined,
              title: (fd.get('title') as string) || undefined,
              isPrimary: true,
            });
          }
        }
        toast({ title: 'Company created', description: 'New customer has been added.' });
      }

      await load();
      setIsDialogOpen(false);
      setEditingCompany(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save company',
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
      toast({ title: 'Company deleted', description: 'Company has been removed.' });
      await load();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete company',
        variant: 'destructive',
      });
    } finally {
      setDeleteTarget(null);
    }
  };

  const openNewDialog = () => {
    setEditingCompany(null);
    setAddContact(true);
    setIsDialogOpen(true);
  };

  const openEditDialog = (company: Company) => {
    setEditingCompany(company);
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading companies...</p>
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
            <h2 className="text-lg font-semibold">Error Loading Companies</h2>
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
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wide">Customers</h1>
          <p className="mt-1 text-muted-foreground">Manage your customer companies and contacts</p>
        </div>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Companies</CardTitle>
              <CardDescription>{companies.length} total companies</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredCompanies.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No companies match your search' : 'No companies yet'}
              </p>
              {!searchQuery && (
                <Button onClick={openNewDialog} variant="outline" className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first company
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead>Contacts</TableHead>
                    <TableHead className="hidden lg:table-cell">Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompanies.map((company) => (
                    <TableRow
                      key={company.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/app/customers/${company.id}`)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{company.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Added {new Date(company.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(company.billingCity || company.billingState) && (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span>
                              {[company.billingCity, company.billingState]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {company.contactCount}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant={company.active ? 'default' : 'secondary'}>
                          {company.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => navigate(`/app/customers/${company.id}`)}
                            >
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(company)}>
                              Edit Company
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteTarget(company)}
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

      {/* Add / Edit Company Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                {editingCompany ? 'Edit Company' : 'New Customer'}
              </DialogTitle>
              <DialogDescription>
                {editingCompany
                  ? 'Update company information'
                  : 'Add a new customer company to your database'}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  name="companyName"
                  defaultValue={editingCompany?.name}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Billing Address</Label>
                <Input
                  name="billingStreet"
                  defaultValue={editingCompany?.billingAddress ?? ''}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-3"
                    name="billingCity"
                    defaultValue={editingCompany?.billingCity ?? ''}
                    placeholder="City"
                  />
                  <Input
                    className="col-span-1"
                    name="billingState"
                    defaultValue={editingCompany?.billingState ?? ''}
                    placeholder="ST"
                    maxLength={2}
                  />
                  <Input
                    className="col-span-2"
                    name="billingZip"
                    defaultValue={editingCompany?.billingZip ?? ''}
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Shipping Address</Label>
                <Input
                  name="shippingStreet"
                  defaultValue={editingCompany?.shippingAddress ?? ''}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-3"
                    name="shippingCity"
                    defaultValue={editingCompany?.shippingCity ?? ''}
                    placeholder="City"
                  />
                  <Input
                    className="col-span-1"
                    name="shippingState"
                    defaultValue={editingCompany?.shippingState ?? ''}
                    placeholder="ST"
                    maxLength={2}
                  />
                  <Input
                    className="col-span-2"
                    name="shippingZip"
                    defaultValue={editingCompany?.shippingZip ?? ''}
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  defaultValue={editingCompany?.notes ?? ''}
                  rows={2}
                />
              </div>

              {/* Contact section – new company only */}
              {!editingCompany && (
                <div className="border-t pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Checkbox
                      id="addContactCheck"
                      checked={addContact}
                      onCheckedChange={(v) => setAddContact(!!v)}
                    />
                    <Label htmlFor="addContactCheck" className="cursor-pointer font-medium">
                      Add a primary contact
                    </Label>
                  </div>
                  {addContact && (
                    <div className="grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="firstName">First Name *</Label>
                          <Input id="firstName" name="firstName" required={addContact} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="lastName">Last Name *</Label>
                          <Input id="lastName" name="lastName" required={addContact} />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" name="email" type="email" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="phone">Phone</Label>
                          <Input id="phone" name="phone" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="title">Title / Role</Label>
                        <Input
                          id="title"
                          name="title"
                          placeholder="e.g. Project Manager"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  setEditingCompany(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : editingCompany ? 'Save Changes' : 'Create Customer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will also
              delete all contacts. Estimates linked to this company will be unassigned.
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
