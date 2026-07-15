import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  ChevronRight,
  Plus,
  MoreHorizontal,
  Pencil,
  Star,
  AlertCircle,
  Building2,
  MapPin,
  FileText,
  Settings,
  Users,
} from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  getCompanyWithContacts,
  updateCompany,
  updateCompanySettings,
  createContact,
  updateContact,
  deleteContact,
} from '@/lib/companies-api';
import { listTemplates } from '@/lib/templates-api';
import type { Company, Contact, CompanySettings, Template } from '@/types';

function formatPartNumberMap(value?: Record<string, string>): string {
  return Object.entries(value ?? {}).map(([internal, customer]) => `${internal} = ${customer}`).join('\n');
}

function parsePartNumberMap(value: string): Record<string, string> {
  const entries = value.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) return [];
    const internal = line.slice(0, separator).trim();
    const customer = line.slice(separator + 1).trim();
    return internal && customer ? [[internal, customer] as const] : [];
  });
  return Object.fromEntries(entries);
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Company edit
  const [isEditCompanyOpen, setIsEditCompanyOpen] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);

  // Contact dialog
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [deleteContactTarget, setDeleteContactTarget] = useState<Contact | null>(null);

  // Settings
  const [settingsValues, setSettingsValues] = useState<CompanySettings>({
    costMultiplier: 1.0,
    paymentTerms: null,
    defaultTemplateId: null,
    defaultQuoteOrganizationMode: 'by_product_group',
    defaultQuoteDetailLevel: 'rolled_up',
    quoteValidityDays: 90,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [partNumberMapText, setPartNumberMapText] = useState('');
  const [quoteTemplates, setQuoteTemplates] = useState<Template[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const [result, templates] = await Promise.all([
        getCompanyWithContacts(id),
        listTemplates().catch(() => [] as Template[]),
      ]);
      if (!result) {
        setError('Company not found');
        return;
      }
      setCompany(result.company);
      setContacts(result.contacts);
      setSettingsValues(result.company.settings);
      setPartNumberMapText(formatPartNumberMap(result.company.settings.customerPartNumberMap));
      setQuoteTemplates(templates.filter((template) => template.audience === 'customer'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Company Edit ----

  const handleSaveCompany = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!company) return;
    const fd = new FormData(e.currentTarget);
    setIsSavingCompany(true);
    try {
      await updateCompany(company.id, {
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
        active: (e.currentTarget.querySelector('#editActive') as HTMLInputElement)?.checked ?? true,
      });
      toast({ title: 'Company updated', description: 'Changes have been saved.' });
      await load();
      setIsEditCompanyOpen(false);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update company',
        variant: 'destructive',
      });
    } finally {
      setIsSavingCompany(false);
    }
  };

  const copyBillingToShipping = (form: HTMLFormElement | null) => {
    if (!form) return;
    const billingStreet = form.elements.namedItem('billingStreet') as HTMLInputElement | null;
    const billingCity = form.elements.namedItem('billingCity') as HTMLInputElement | null;
    const billingState = form.elements.namedItem('billingState') as HTMLInputElement | null;
    const billingZip = form.elements.namedItem('billingZip') as HTMLInputElement | null;
    const shippingStreet = form.elements.namedItem('shippingStreet') as HTMLInputElement | null;
    const shippingCity = form.elements.namedItem('shippingCity') as HTMLInputElement | null;
    const shippingState = form.elements.namedItem('shippingState') as HTMLInputElement | null;
    const shippingZip = form.elements.namedItem('shippingZip') as HTMLInputElement | null;

    if (shippingStreet && billingStreet) shippingStreet.value = billingStreet.value;
    if (shippingCity && billingCity) shippingCity.value = billingCity.value;
    if (shippingState && billingState) shippingState.value = billingState.value;
    if (shippingZip && billingZip) shippingZip.value = billingZip.value;
  };

  const copyShippingToBilling = (form: HTMLFormElement | null) => {
    if (!form) return;
    for (const field of ['Street', 'City', 'State', 'Zip']) {
      const shipping = form.elements.namedItem(`shipping${field}`) as HTMLInputElement | null;
      const billing = form.elements.namedItem(`billing${field}`) as HTMLInputElement | null;
      if (shipping && billing) billing.value = shipping.value;
    }
  };

  // ---- Contacts ----

  const handleSaveContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!company) return;
    const fd = new FormData(e.currentTarget);
    setIsSavingContact(true);
    try {
      const isPrimary =
        (e.currentTarget.querySelector('#contactIsPrimary') as HTMLInputElement)?.checked ?? false;
      const input = {
        firstName: fd.get('firstName') as string,
        lastName: fd.get('lastName') as string,
        email: (fd.get('email') as string) || undefined,
        phone: (fd.get('phone') as string) || undefined,
        title: (fd.get('title') as string) || undefined,
        isPrimary,
        notes: (fd.get('notes') as string) || undefined,
      };

      if (editingContact) {
        await updateContact(editingContact.id, { ...input, companyId: company.id });
        toast({ title: 'Contact updated' });
      } else {
        await createContact({ companyId: company.id, ...input });
        toast({ title: 'Contact added' });
      }

      await load();
      setContactDialogOpen(false);
      setEditingContact(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save contact',
        variant: 'destructive',
      });
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!deleteContactTarget) return;
    try {
      await deleteContact(deleteContactTarget.id);
      toast({ title: 'Contact deleted' });
      await load();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete contact',
        variant: 'destructive',
      });
    } finally {
      setDeleteContactTarget(null);
    }
  };

  // ---- Settings ----

  const handleSaveSettings = async () => {
    if (!company) return;
    setIsSavingSettings(true);
    try {
      await updateCompanySettings(company.id, {
        ...settingsValues,
        customerPartNumberMap: parsePartNumberMap(partNumberMapText),
      });
      toast({ title: 'Settings saved' });
      await load();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ---- Loading / Error states ----

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading company...</p>
        </div>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <div className="max-w-md rounded-lg border bg-card p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Error</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">{error || 'Company not found'}</p>
          <Button onClick={() => navigate('/app/customers')}>Back to Customers</Button>
        </div>
      </div>
    );
  }

  const primaryContact = contacts.find((c) => c.isPrimary);
  const isManufacturerRoute =
    location.pathname.includes('/manufacturers') || company.companyType === 'manufacturer';
  const directoryPath = isManufacturerRoute ? '/app/manufacturers' : '/app/customers';
  const directoryLabel = isManufacturerRoute ? 'Manufacturers' : 'Customers';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to={directoryPath} className="transition-colors hover:text-foreground">
          {directoryLabel}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-foreground">{company.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl sm:text-3xl tracking-wide">{company.name}</h1>
              <Badge variant={company.active ? 'default' : 'secondary'}>
                {company.active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {primaryContact && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Primary contact: {primaryContact.firstName} {primaryContact.lastName}
                {primaryContact.title && ` · ${primaryContact.title}`}
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => setIsEditCompanyOpen(true)}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit Company
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content – left 2 columns */}
        <div className="space-y-6 lg:col-span-2">
          {/* Company Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" />
                Company Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Billing Address
                </p>
                {company.billingAddress || company.billingCity ? (
                  <address className="not-italic text-sm leading-relaxed">
                    {company.billingAddress && <div>{company.billingAddress}</div>}
                    {(company.billingCity || company.billingState || company.billingZip) && (
                      <div>
                        {[company.billingCity, company.billingState].filter(Boolean).join(', ')}
                        {company.billingZip && ` ${company.billingZip}`}
                      </div>
                    )}
                  </address>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Shipping Address
                </p>
                {company.shippingAddress || company.shippingCity ? (
                  <address className="not-italic text-sm leading-relaxed">
                    {company.shippingAddress && <div>{company.shippingAddress}</div>}
                    {(company.shippingCity || company.shippingState || company.shippingZip) && (
                      <div>
                        {[company.shippingCity, company.shippingState].filter(Boolean).join(', ')}
                        {company.shippingZip && ` ${company.shippingZip}`}
                      </div>
                    )}
                  </address>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>

              {company.notes && (
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes
                  </p>
                  <p className="whitespace-pre-line text-sm">{company.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contacts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <CardTitle className="text-base">Contacts</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {contacts.length}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingContact(null);
                    setContactDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Contact
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">No contacts yet</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      setEditingContact(null);
                      setContactDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Contact
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Email</TableHead>
                      <TableHead className="hidden md:table-cell">Phone</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">
                                {contact.firstName} {contact.lastName}
                              </span>
                              {contact.isPrimary && (
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                  <Star className="mr-0.5 h-2.5 w-2.5" />
                                  Primary
                                </Badge>
                              )}
                            </div>
                            {contact.title && (
                              <p className="text-xs text-muted-foreground">{contact.title}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {contact.email ? (
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-sm text-muted-foreground hover:text-foreground"
                            >
                              {contact.email}
                            </a>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {contact.phone ? (
                            <a
                              href={`tel:${contact.phone}`}
                              className="text-sm text-muted-foreground hover:text-foreground"
                            >
                              {contact.phone}
                            </a>
                          ) : (
                            '—'
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
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingContact(contact);
                                  setContactDialogOpen(true);
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteContactTarget(contact)}
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
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar – right column */}
        <div className="space-y-6">
          {/* Settings Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="h-4 w-4" />
                Account Settings
              </CardTitle>
              <CardDescription className="text-xs">
                Applied to all quotes for this company
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="costMultiplier" className="text-sm">
                  Cost Multiplier
                </Label>
                <Input
                  id="costMultiplier"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settingsValues.costMultiplier}
                  onChange={(e) =>
                    setSettingsValues((prev) => ({
                      ...prev,
                      costMultiplier: parseFloat(e.target.value) || 1.0,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Applied to all quote line items for this company
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paymentTerms" className="text-sm">
                  Payment Terms
                </Label>
                <Input
                  id="paymentTerms"
                  value={settingsValues.paymentTerms ?? ''}
                  onChange={(e) =>
                    setSettingsValues((prev) => ({
                      ...prev,
                      paymentTerms: e.target.value || null,
                    }))
                  }
                  placeholder="e.g. Net 30"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Quote Organization</Label>
                  <Select
                    value={settingsValues.defaultQuoteOrganizationMode ?? 'by_product_group'}
                    onValueChange={(value) => setSettingsValues((prev) => ({
                      ...prev,
                      defaultQuoteOrganizationMode: value as CompanySettings['defaultQuoteOrganizationMode'],
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_product_group">By Product Group</SelectItem>
                      <SelectItem value="by_opening">By Opening</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Quote Detail</Label>
                  <Select
                    value={settingsValues.defaultQuoteDetailLevel ?? 'rolled_up'}
                    onValueChange={(value) => setSettingsValues((prev) => ({
                      ...prev,
                      defaultQuoteDetailLevel: value as CompanySettings['defaultQuoteDetailLevel'],
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="summary">Summary Only</SelectItem>
                      <SelectItem value="rolled_up">Rolled-Up Totals</SelectItem>
                      <SelectItem value="per_item_sell">Per-Item Sell</SelectItem>
                      <SelectItem value="full_internal">Full Internal Detail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Default Customer Quote Template</Label>
                <Select
                  value={settingsValues.defaultQuoteTemplateKey ?? '__none'}
                  onValueChange={(value) => setSettingsValues((prev) => ({
                    ...prev,
                    defaultQuoteTemplateKey: value === '__none' ? null : value,
                  }))}
                >
                  <SelectTrigger><SelectValue placeholder="Use system default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Use system default</SelectItem>
                    {quoteTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Applied automatically when starting a new customer quote for this company.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quoteValidityDays" className="text-sm">Quote Validity Days</Label>
                <Input
                  id="quoteValidityDays"
                  type="number"
                  min={1}
                  value={settingsValues.quoteValidityDays ?? 90}
                  onChange={(e) => setSettingsValues((prev) => ({
                    ...prev,
                    quoteValidityDays: Math.max(1, Number(e.target.value) || 90),
                  }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quoteHeaderText" className="text-sm">Default Quote Header</Label>
                <Textarea
                  id="quoteHeaderText"
                  rows={2}
                  value={settingsValues.quoteHeaderText ?? ''}
                  onChange={(e) => setSettingsValues((prev) => ({ ...prev, quoteHeaderText: e.target.value || null }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quoteDisclaimerText" className="text-sm">Default Disclaimer</Label>
                <Textarea
                  id="quoteDisclaimerText"
                  rows={3}
                  value={settingsValues.quoteDisclaimerText ?? ''}
                  onChange={(e) => setSettingsValues((prev) => ({ ...prev, quoteDisclaimerText: e.target.value || null }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quoteFooterText" className="text-sm">Default Quote Footer</Label>
                <Textarea
                  id="quoteFooterText"
                  rows={2}
                  value={settingsValues.quoteFooterText ?? ''}
                  onChange={(e) => setSettingsValues((prev) => ({ ...prev, quoteFooterText: e.target.value || null }))}
                />
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="showCustomerPartNumbers"
                    checked={settingsValues.showCustomerPartNumbers ?? false}
                    onCheckedChange={(checked) => setSettingsValues((prev) => ({
                      ...prev,
                      showCustomerPartNumbers: checked === true,
                    }))}
                  />
                  <div>
                    <Label htmlFor="showCustomerPartNumbers" className="text-sm">Show customer part numbers</Label>
                    <p className="text-xs text-muted-foreground">Replaces matching internal codes on this customer’s Sales Estimate.</p>
                  </div>
                </div>
                <Textarea
                  value={partNumberMapText}
                  onChange={(event) => setPartNumberMapText(event.target.value)}
                  rows={5}
                  placeholder={'Internal code = Customer part\nH-3070 = FB-10042'}
                  disabled={!settingsValues.showCustomerPartNumbers}
                />
                <p className="text-[11px] text-muted-foreground">One mapping per line. Unmapped codes retain their internal value.</p>
              </div>

              <Button
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="w-full"
                size="sm"
              >
                {isSavingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardContent>
          </Card>

          {/* Meta */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(company.createdAt).toLocaleDateString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Updated</span>
                <span>{new Date(company.updatedAt).toLocaleDateString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={company.active ? 'default' : 'secondary'} className="text-xs">
                  {company.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Company Dialog */}
      <Dialog open={isEditCompanyOpen} onOpenChange={setIsEditCompanyOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <form onSubmit={handleSaveCompany}>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Edit Company</DialogTitle>
              <DialogDescription>Update company information</DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="editCompanyName">Company Name *</Label>
                <Input
                  id="editCompanyName"
                  name="companyName"
                  defaultValue={company.name}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">Billing Address</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={(event) => copyShippingToBilling(event.currentTarget.form)}>
                    Copy Shipping
                  </Button>
                </div>
                <Input
                  name="billingStreet"
                  defaultValue={company.billingAddress ?? ''}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-3"
                    name="billingCity"
                    defaultValue={company.billingCity ?? ''}
                    placeholder="City"
                  />
                  <Input
                    className="col-span-1"
                    name="billingState"
                    defaultValue={company.billingState ?? ''}
                    placeholder="ST"
                    maxLength={2}
                  />
                  <Input
                    className="col-span-2"
                    name="billingZip"
                    defaultValue={company.billingZip ?? ''}
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">Shipping Address</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(event) => copyBillingToShipping(event.currentTarget.form)}
                  >
                    Copy Billing
                  </Button>
                </div>
                <Input
                  name="shippingStreet"
                  defaultValue={company.shippingAddress ?? ''}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-6 gap-2">
                  <Input
                    className="col-span-3"
                    name="shippingCity"
                    defaultValue={company.shippingCity ?? ''}
                    placeholder="City"
                  />
                  <Input
                    className="col-span-1"
                    name="shippingState"
                    defaultValue={company.shippingState ?? ''}
                    placeholder="ST"
                    maxLength={2}
                  />
                  <Input
                    className="col-span-2"
                    name="shippingZip"
                    defaultValue={company.shippingZip ?? ''}
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="editNotes">Notes</Label>
                <Textarea
                  id="editNotes"
                  name="notes"
                  defaultValue={company.notes ?? ''}
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="editActive" defaultChecked={company.active} />
                <Label htmlFor="editActive" className="cursor-pointer">
                  Active company
                </Label>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditCompanyOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingCompany}>
                {isSavingCompany ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Contact Dialog */}
      <Dialog
        open={contactDialogOpen}
        onOpenChange={(open) => {
          setContactDialogOpen(open);
          if (!open) setEditingContact(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSaveContact}>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">
                {editingContact ? 'Edit Contact' : 'Add Contact'}
              </DialogTitle>
              <DialogDescription>
                {editingContact
                  ? 'Update contact details'
                  : `Add a contact to ${company.name}`}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contactFirstName">First Name *</Label>
                  <Input
                    id="contactFirstName"
                    name="firstName"
                    defaultValue={editingContact?.firstName}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactLastName">Last Name *</Label>
                  <Input
                    id="contactLastName"
                    name="lastName"
                    defaultValue={editingContact?.lastName}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail">Email</Label>
                  <Input
                    id="contactEmail"
                    name="email"
                    type="email"
                    defaultValue={editingContact?.email ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactPhone">Phone</Label>
                  <Input
                    id="contactPhone"
                    name="phone"
                    defaultValue={editingContact?.phone ?? ''}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contactTitle">Title / Role</Label>
                <Input
                  id="contactTitle"
                  name="title"
                  defaultValue={editingContact?.title ?? ''}
                  placeholder="e.g. Project Manager"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contactNotes">Notes</Label>
                <Textarea
                  id="contactNotes"
                  name="notes"
                  defaultValue={editingContact?.notes ?? ''}
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="contactIsPrimary"
                  defaultChecked={editingContact?.isPrimary ?? false}
                />
                <Label htmlFor="contactIsPrimary" className="cursor-pointer">
                  Set as primary contact
                </Label>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setContactDialogOpen(false);
                  setEditingContact(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingContact}>
                {isSavingContact
                  ? 'Saving...'
                  : editingContact
                    ? 'Save Changes'
                    : 'Add Contact'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Contact Confirmation */}
      <AlertDialog
        open={!!deleteContactTarget}
        onOpenChange={(open) => !open && setDeleteContactTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong>
                {deleteContactTarget?.firstName} {deleteContactTarget?.lastName}
              </strong>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteContact}
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
