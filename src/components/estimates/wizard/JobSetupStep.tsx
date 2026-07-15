import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Copy, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { listContacts } from '@/lib/companies-api';
import type { Company, Contact, EstimateJobInfo, EstimateShipToSource } from '@/types';

interface JobSetupStepProps {
  value: EstimateJobInfo;
  selectedCompany: Company | null;
  onChange: (value: EstimateJobInfo) => void;
  onBack: () => void;
  onNext: () => void;
  saving?: boolean;
}

const SHIP_TO_OPTIONS: { value: EstimateShipToSource; label: string }[] = [
  { value: 'customer_shipping', label: 'Customer shipping' },
  { value: 'customer_billing', label: 'Customer billing' },
  { value: 'override', label: 'Job site override' },
  { value: 'will_call', label: 'Will call' },
];

function formatAddress(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(', ');
}

export function JobSetupStep({
  value,
  selectedCompany,
  onChange,
  onBack,
  onNext,
  saving = false,
}: JobSetupStepProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const selectedCompanyIdRef = useRef<string | null>(null);
  const autoFilledJobLocationRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!selectedCompany) {
      setContacts([]);
      return;
    }
    listContacts(selectedCompany.id)
      .then((rows) => {
        if (active) setContacts(rows);
      })
      .catch(() => {
        if (active) setContacts([]);
      });
    return () => {
      active = false;
    };
  }, [selectedCompany]);

  const customerShippingAddress = useMemo(
    () =>
      selectedCompany
        ? formatAddress([
            selectedCompany.shippingAddress,
            selectedCompany.shippingCity,
            selectedCompany.shippingState,
            selectedCompany.shippingZip,
          ])
        : '',
    [selectedCompany],
  );

  const customerBillingAddress = useMemo(
    () =>
      selectedCompany
        ? formatAddress([
            selectedCompany.billingAddress,
            selectedCompany.billingCity,
            selectedCompany.billingState,
            selectedCompany.billingZip,
          ])
        : '',
    [selectedCompany],
  );

  useEffect(() => {
    const selectedCompanyId = selectedCompany?.id ?? null;
    if (!selectedCompanyId || selectedCompanyIdRef.current === selectedCompanyId) return;

    selectedCompanyIdRef.current = selectedCompanyId;
    const customerAddress = customerShippingAddress || customerBillingAddress;
    const currentJobLocation = value.jobLocation?.trim() ?? '';
    const canAutofill = !currentJobLocation || currentJobLocation === autoFilledJobLocationRef.current;

    if (!customerAddress || !canAutofill) {
      autoFilledJobLocationRef.current = null;
      return;
    }

    autoFilledJobLocationRef.current = customerAddress;
    if (currentJobLocation !== customerAddress) {
      onChange({ ...value, jobLocation: customerAddress });
    }
  }, [customerBillingAddress, customerShippingAddress, onChange, selectedCompany, value]);

  const selectedShipTo = value.shipToSource ?? 'customer_shipping';
  const shipToPreview =
    selectedShipTo === 'customer_billing'
      ? customerBillingAddress
      : selectedShipTo === 'customer_shipping'
        ? customerShippingAddress || customerBillingAddress
        : selectedShipTo === 'will_call'
          ? 'Will call'
          : formatAddress([value.shipToAddress, value.shipToCity, value.shipToState, value.shipToZip]);

  const update = <K extends keyof EstimateJobInfo>(key: K, nextValue: EstimateJobInfo[K]) => {
    onChange({ ...value, [key]: nextValue });
  };

  const copyJobLocationToShipTo = () => {
    onChange({
      ...value,
      shipToSource: 'override',
      shipToAddress: value.jobLocation ?? '',
    });
  };

  const copyShipToToJobLocation = () => {
    if (!shipToPreview) return;
    update('jobLocation', shipToPreview);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BriefcaseBusiness className="h-4 w-4" />
            Job Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="jobName">Job Name *</Label>
            <Input
              id="jobName"
              value={value.jobName ?? ''}
              onChange={(event) => update('jobName', event.target.value)}
              placeholder="e.g. SEC-101 Lobby Opening Demo"
              required
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="jobLocation">Job Location</Label>
            <Input
              id="jobLocation"
              value={value.jobLocation ?? ''}
              onChange={(event) => update('jobLocation', event.target.value)}
              placeholder="Street, city, state, ZIP"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jobNumber">Job Number</Label>
            <Input
              id="jobNumber"
              value={value.jobNumber ?? ''}
              onChange={(event) => update('jobNumber', event.target.value)}
              placeholder="e.g. IES-2026-001"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customerPo">Customer PO</Label>
            <Input
              id="customerPo"
              value={value.customerPo ?? ''}
              onChange={(event) => update('customerPo', event.target.value)}
              placeholder="PO / reference"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quoteDate">Quote Date</Label>
            <Input
              id="quoteDate"
              type="date"
              value={value.quoteDate ?? ''}
              onChange={(event) => update('quoteDate', event.target.value || null)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shippingMethod">Shipping Method</Label>
            <Input
              id="shippingMethod"
              value={value.shippingMethod ?? ''}
              onChange={(event) => update('shippingMethod', event.target.value)}
              placeholder="Truck, will call, TBD"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="terms">Terms</Label>
            <Input
              id="terms"
              value={value.terms ?? ''}
              onChange={(event) => update('terms', event.target.value)}
              placeholder="Net 30"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delivery">Delivery</Label>
            <Input
              id="delivery"
              value={value.delivery ?? ''}
              onChange={(event) => update('delivery', event.target.value)}
              placeholder="Lead time / delivery note"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            Contacts And Ship-To
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Customer Contact</Label>
            <Select
              value={value.customerContactId ?? 'none'}
              onValueChange={(nextValue) => update('customerContactId', nextValue === 'none' ? null : nextValue)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select contact" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No contact</SelectItem>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName}
                    {contact.isPrimary ? ' · Primary' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Ship-To Source</Label>
            <Select
              value={selectedShipTo}
              onValueChange={(nextValue) => update('shipToSource', nextValue as EstimateShipToSource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIP_TO_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="shipToAddress">Ship-To Address</Label>
              <div className="flex flex-wrap justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={copyJobLocationToShipTo}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Job → Ship-To
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={copyShipToToJobLocation} disabled={!shipToPreview}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Ship-To → Job
                </Button>
              </div>
            </div>
            <Input
              id="shipToAddress"
              value={value.shipToAddress ?? ''}
              onChange={(event) => update('shipToAddress', event.target.value)}
              placeholder={shipToPreview || 'Street address'}
              disabled={selectedShipTo !== 'override'}
            />
            {selectedShipTo === 'override' && (
              <div className="grid grid-cols-6 gap-2">
                <Input
                  className="col-span-3"
                  value={value.shipToCity ?? ''}
                  onChange={(event) => update('shipToCity', event.target.value)}
                  placeholder="City"
                />
                <Input
                  className="col-span-1"
                  value={value.shipToState ?? ''}
                  onChange={(event) => update('shipToState', event.target.value.toUpperCase())}
                  placeholder="ST"
                  maxLength={2}
                />
                <Input
                  className="col-span-2"
                  value={value.shipToZip ?? ''}
                  onChange={(event) => update('shipToZip', event.target.value)}
                  placeholder="ZIP"
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customerRepName">Customer Rep</Label>
            <Input
              id="customerRepName"
              value={value.customerRepName ?? ''}
              onChange={(event) => update('customerRepName', event.target.value)}
              placeholder="Name"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customerRepPhone">Rep Phone</Label>
              <Input
                id="customerRepPhone"
                value={value.customerRepPhone ?? ''}
                onChange={(event) => update('customerRepPhone', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerRepEmail">Rep Email</Label>
              <Input
                id="customerRepEmail"
                type="email"
                value={value.customerRepEmail ?? ''}
                onChange={(event) => update('customerRepEmail', event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="internalNotes">Internal Notes</Label>
            <Textarea
              id="internalNotes"
              value={value.internalNotes ?? ''}
              onChange={(event) => update('internalNotes', event.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="mr-2 h-4 w-4" />
          )}
          Continue
        </Button>
      </div>
    </form>
  );
}
