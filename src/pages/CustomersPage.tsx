import { useState } from 'react';
import { Plus, Search, MoreHorizontal, Mail, Phone, MapPin } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { customerStorage } from '@/lib/storage';
import type { Customer } from '@/types';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>(customerStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.primaryContactName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveCustomer = (formData: FormData) => {
    const customerData = {
      name: formData.get('name') as string,
      primaryContactName: formData.get('primaryContactName') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      billingAddress: formData.get('billingAddress') as string,
      shippingAddress: formData.get('shippingAddress') as string,
      notes: formData.get('notes') as string,
    };

    if (editingCustomer) {
      customerStorage.update(editingCustomer.id, customerData);
      toast({ title: 'Customer updated', description: 'Changes have been saved.' });
    } else {
      customerStorage.create(customerData);
      toast({ title: 'Customer created', description: 'New customer has been added.' });
    }

    setCustomers(customerStorage.getAll());
    setIsDialogOpen(false);
    setEditingCustomer(null);
  };

  const handleDeleteCustomer = (id: string) => {
    customerStorage.delete(id);
    setCustomers(customerStorage.getAll());
    toast({ title: 'Customer deleted', description: 'Customer has been removed.' });
  };

  const openEditDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    setIsDialogOpen(true);
  };

  const openNewDialog = () => {
    setEditingCustomer(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Customers</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your customer database
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveCustomer(new FormData(e.currentTarget));
              }}
            >
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">
                  {editingCustomer ? 'Edit Customer' : 'New Customer'}
                </DialogTitle>
                <DialogDescription>
                  {editingCustomer
                    ? 'Update customer information'
                    : 'Add a new customer to your database'}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Company Name *</Label>
                    <Input
                      id="name"
                      name="name"
                      defaultValue={editingCustomer?.name}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryContactName">Primary Contact *</Label>
                    <Input
                      id="primaryContactName"
                      name="primaryContactName"
                      defaultValue={editingCustomer?.primaryContactName}
                      required
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      defaultValue={editingCustomer?.email}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      name="phone"
                      defaultValue={editingCustomer?.phone}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="billingAddress">Billing Address</Label>
                  <Textarea
                    id="billingAddress"
                    name="billingAddress"
                    defaultValue={editingCustomer?.billingAddress}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shippingAddress">Shipping Address</Label>
                  <Textarea
                    id="shippingAddress"
                    name="shippingAddress"
                    defaultValue={editingCustomer?.shippingAddress}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    defaultValue={editingCustomer?.notes}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingCustomer ? 'Save Changes' : 'Create Customer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All Customers</CardTitle>
              <CardDescription>{customers.length} total customers</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredCustomers.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                {searchQuery ? 'No customers match your search' : 'No customers yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Location</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Added {new Date(customer.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{customer.primaryContactName}</span>
                          <a
                            href={`mailto:${customer.email}`}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Mail className="h-3 w-3" />
                            {customer.email}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {customer.phone && (
                          <a
                            href={`tel:${customer.phone}`}
                            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                          >
                            <Phone className="h-3 w-3" />
                            {customer.phone}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {customer.shippingAddress && (
                          <div className="flex items-start gap-1 text-sm text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">{customer.shippingAddress}</span>
                          </div>
                        )}
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
                              <a href={`/app/customers/${customer.id}`}>View Details</a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(customer)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteCustomer(customer.id)}
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
    </div>
  );
}
