/**
 * Dynamic spec-field input (Phase 4 builder).
 *
 * Renders one `opening_spec_field` as the right control for its data type:
 * Enum/Boolean → select, Dimension/Integer/Number → text input, else text.
 * Values are keyed by the field's machine `field_path` in the draft.
 */

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SpecFieldWithPath } from '@/lib/cpq-catalog-api';

interface SpecFieldInputProps {
  field: SpecFieldWithPath;
  value: string;
  onChange: (path: string, value: string) => void;
  /** Locked fields (e.g. dimensions pushed from the opening) render read-only. */
  locked?: boolean;
}

function isRequired(field: SpecFieldWithPath): boolean {
  return (field.requiredWhen ?? '').trim().toLowerCase() === 'always';
}

export function SpecFieldInput({ field, value, onChange, locked }: SpecFieldInputProps) {
  if (!field.fieldPath) return null;
  const path = field.fieldPath;
  const required = isRequired(field);
  const dataType = (field.dataType ?? '').toLowerCase();
  const isBoolean = dataType.includes('bool');
  const enumOptions = isBoolean && field.enumOptions.length === 0 ? ['Yes', 'No'] : field.enumOptions;
  const placeholder =
    dataType.includes('dimension')
      ? "e.g. 3-0 or 36\""
      : field.allowedValues?.slice(0, 40) ?? '';

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {field.fieldLabel}
        {required && <span className="text-destructive">*</span>}
        <span className="font-mono text-[10px] opacity-50">{field.fieldId}</span>
      </Label>
      {enumOptions.length > 0 ? (
        <Select value={value} onValueChange={(v) => onChange(path, v)} disabled={locked}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {enumOptions.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-sm">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(path, e.target.value)}
          placeholder={placeholder}
          className="h-8 text-sm"
          readOnly={locked}
        />
      )}
    </div>
  );
}
