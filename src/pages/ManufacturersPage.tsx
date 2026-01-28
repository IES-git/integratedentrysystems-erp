import { useState } from 'react';
import { Plus, Search, MoreHorizontal, Mail, Phone, MapPin, Globe } from 'lucide-react';
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
import { manufacturerStorage } from '@/lib/storage';
import type { Manufacturer } from '@/types';

export default function ManufacturersPage() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>(manufacturerStorage.getAll());
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingManufacturer, setEditingManufacturer] = useState<Manufacturer | null>(null);
  const { toast } = useToast();

  const filteredManufacturers = manufacturers.filter(
    (manufacturer) =>
      manufacturer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      manufacturer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      manufacturer.primaryContactName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveManufacturer = (formData: FormData) => {
    const manufacturerData = {
      name: formData.get('name') as string,
      primaryContactName: formData.get('primaryContactName') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      address: formData.get('address') as string,
      website: formData.get('website') as string,
      notes: formData.get('notes') as string,
    };

    if (editingManufacturer) {
      manufacturerStorage.update(editingManufacturer.id, manufacturerData);
      toast({ title: 'Manufacturer updated', description: 'Changes have been saved.' });
    } else {
      manufacturerStorage.create(manufacturerData);
      toast({ title: 'Manufacturer created', description: 'New manufacturer has been added.' });
    }

    setManufacturers(manufacturerStorage.getAll());
    setIsDialogOpen(false);
    setEditingManufacturer(null);
  };

  const handleDeleteManufacturer = (id: string) => {
    manufacturerStorage.delete(id);
    setManufacturers(manufacturerStorage.getAll());
    toast({ title: 'Manufacturer deleted', description: 'Manufacturer has been removed.' });
  };

  const openEditDialog = (manufacturer: Manufacturer) => {
    setEditingManufacturer(manufacturer);
    setIsDialogOpen(true);
  };

  const openNewDialog = () => {
    setEditingManufacturer(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide">Manufacturers</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your manufacturer relationships
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Add Manufacturer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveManufacturer(new FormData(e.currentTarget));
              }}
            >
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">
                  {editingManufacturer ? 'Edit Manufacturer' : 'New Manufacturer'}
                </DialogTitle>
                <DialogDescription>
                  {editingManufacturer
                    ? 'Update manufacturer information'
                    : 'Add a new manufacturer to your database'}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
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
                    <Label htmlFor="primaryContactName">Primary Contact *</Label>
                    <Input
                      id="primaryContactName"
                      name="primaryContactName"
                      defaultValue={editingManufacturer?.primaryContactName}
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
                      defaultValue={editingManufacturer?.email}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      name="phone"
                      defaultValue={editingManufacturer?.phone}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    name="website"
                    type="url"
                    placeholder="https://"
                    defaultValue={editingManufacturer?.website}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Textarea
                    id="address"
                    name="address"
                    defaultValue={editingManufacturer?.address}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    defaultValue={editingManufacturer?.notes}
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
                  {editingManufacturer ? 'Save Changes' : 'Create Manufacturer'}
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
              <p className="text-muted-foreground">
                {searchQuery ? 'No manufacturers match your search' : 'No manufacturers yet'}
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
                    <TableHead className="hidden lg:table-cell">Website</TableHead>
                    <TableHead className="w-12"></TableHead>
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
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">{manufacturer.primaryContactName}</span>
                          <a
                            href={`mailto:${manufacturer.email}`}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Mail className="h-3 w-3" />
                            {manufacturer.email}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {manufacturer.phone && (
                          <a
                            href={`tel:${manufacturer.phone}`}
                            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                          >
                            <Phone className="h-3 w-3" />
                            {manufacturer.phone}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {manufacturer.website && (
                          <a
                            href={manufacturer.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                          >
                            <Globe className="h-3 w-3" />
                            <span className="truncate max-w-[150px]">
                              {manufacturer.website.replace(/^https?:\/\//, '')}
                            </span>
                          </a>
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
                            <DropdownMenuItem onClick={() => openEditDialog(manufacturer)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteManufacturer(manufacturer.id)}
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
