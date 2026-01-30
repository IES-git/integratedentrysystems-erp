import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface AddressData {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressFieldsProps {
  prefix: string;
  label: string;
  defaultValue?: AddressData | string;
}

// Helper to parse legacy single-string address to structured format
export function parseAddressString(address: string): AddressData {
  // Simple heuristic: try to split by comma or newline
  const parts = address.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
  
  if (parts.length === 0) {
    return { street: '', city: '', state: '', zip: '' };
  }
  
  // Try to extract state and zip from last part
  const lastPart = parts[parts.length - 1] || '';
  const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)$/);
  
  if (stateZipMatch) {
    return {
      street: parts[0] || '',
      city: parts.length > 2 ? parts[parts.length - 2] : '',
      state: stateZipMatch[1],
      zip: stateZipMatch[2],
    };
  }
  
  // Fallback: put everything in street
  return {
    street: address,
    city: '',
    state: '',
    zip: '',
  };
}

// Helper to combine structured address back to string for storage
export function formatAddressToString(data: AddressData): string {
  const parts = [
    data.street,
    data.city,
    data.state && data.zip ? `${data.state} ${data.zip}` : data.state || data.zip,
  ].filter(Boolean);
  return parts.join(', ');
}

export function AddressFields({ prefix, label, defaultValue }: AddressFieldsProps) {
  const parsed = typeof defaultValue === 'string' 
    ? parseAddressString(defaultValue) 
    : defaultValue || { street: '', city: '', state: '', zip: '' };

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="space-y-2 pl-0">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}Street`} className="text-xs text-muted-foreground">
            Street Address
          </Label>
          <Input
            id={`${prefix}Street`}
            name={`${prefix}Street`}
            defaultValue={parsed.street}
            placeholder="123 Main St"
          />
        </div>
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-3 space-y-1.5">
            <Label htmlFor={`${prefix}City`} className="text-xs text-muted-foreground">
              City
            </Label>
            <Input
              id={`${prefix}City`}
              name={`${prefix}City`}
              defaultValue={parsed.city}
              placeholder="City"
            />
          </div>
          <div className="col-span-1 space-y-1.5">
            <Label htmlFor={`${prefix}State`} className="text-xs text-muted-foreground">
              State
            </Label>
            <Input
              id={`${prefix}State`}
              name={`${prefix}State`}
              defaultValue={parsed.state}
              placeholder="CA"
              maxLength={2}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor={`${prefix}Zip`} className="text-xs text-muted-foreground">
              ZIP
            </Label>
            <Input
              id={`${prefix}Zip`}
              name={`${prefix}Zip`}
              defaultValue={parsed.zip}
              placeholder="12345"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to extract address from FormData
export function getAddressFromFormData(formData: FormData, prefix: string): string {
  const data: AddressData = {
    street: formData.get(`${prefix}Street`) as string || '',
    city: formData.get(`${prefix}City`) as string || '',
    state: formData.get(`${prefix}State`) as string || '',
    zip: formData.get(`${prefix}Zip`) as string || '',
  };
  return formatAddressToString(data);
}
