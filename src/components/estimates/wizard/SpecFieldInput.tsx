/**
 * Dynamic spec-field input (Phase 4 builder).
 *
 * Renders one `opening_spec_field` as the right control for its data type:
 * Enum/Boolean → select, Dimension/Integer/Number → text input, else text.
 * Values are keyed by the field's machine `field_path` in the draft.
 *
 * Supports builder intelligence: a `derivedValue` (auto-filled by the cascade)
 * is shown with an "auto" badge when the user hasn't overridden it, and an
 * `options` override constrains the enum list to the physically-possible set.
 */

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  /** Builder-derived value shown (with an "auto" badge) when no override is set. */
  derivedValue?: string | null;
  /** Short reason for the derived value, surfaced as a tooltip. */
  derivedReason?: string | null;
  /** Constrained enum options (overrides field.enumOptions when provided). */
  options?: string[] | null;
  /** Display labels per option code, e.g. { H: "H — Honeycomb…" }. */
  optionLabels?: Record<string, string> | null;
}

function displayOptionLabel(value: string): string {
  return value.replace(/\bLockseam\b/gi, 'Invisible seam');
}

const HAND_GROUPS = [
  { label: 'Inswing', values: ['RH', 'LH'] },
  { label: 'Outswing', values: ['RHR', 'LHR'] },
  { label: 'Non-handed', values: ['NH'] },
  { label: 'Frame pair', values: ['RHA', 'LHA', 'DA'] },
];

function isHandField(field: SpecFieldWithPath): boolean {
  return field.fieldId === 'DOR-012' || field.fieldId === 'FRM-014';
}

function sortEnumOptions(field: SpecFieldWithPath, options: string[]): string[] {
  if (!isHandField(field)) return options;
  const rank = new Map<string, number>();
  HAND_GROUPS.flatMap((group) => group.values).forEach((value, index) => rank.set(value, index));
  return [...options].sort((a, b) => (rank.get(a) ?? 1000) - (rank.get(b) ?? 1000) || a.localeCompare(b));
}

function groupHandOptions(options: string[]): Array<{ label: string; options: string[] }> {
  const optionSet = new Set(options);
  const groups = HAND_GROUPS
    .map((group) => ({ label: group.label, options: group.values.filter((value) => optionSet.has(value)) }))
    .filter((group) => group.options.length > 0);
  const known = new Set(HAND_GROUPS.flatMap((group) => group.values));
  const other = options.filter((option) => !known.has(option));
  if (other.length > 0) groups.push({ label: 'Other', options: other });
  return groups;
}

function isRequired(field: SpecFieldWithPath): boolean {
  return (field.requiredWhen ?? '').trim().toLowerCase() === 'always';
}

export function SpecFieldInput({ field, value, onChange, locked, derivedValue, derivedReason, options, optionLabels }: SpecFieldInputProps) {
  if (!field.fieldPath) return null;
  const path = field.fieldPath;
  const required = isRequired(field);
  const dataType = (field.dataType ?? '').toLowerCase();
  const isBoolean = dataType.includes('bool');

  const derived = (derivedValue ?? '').trim();
  const hasOverride = value.trim() !== '';
  const effectiveValue = hasOverride ? value : derived;
  const isAuto = !hasOverride && derived !== '';

  const isFreeformMeasurement =
    !dataType.includes('enum')
    && (dataType.includes('dimension') || dataType.includes('integer') || dataType.includes('number'));
  // Dimension fields where we surface the standard chart depths as typeahead
  // suggestions but still allow a freeform custom value (e.g. "5 3/4").
  const isGuidedMeasurement =
    path === 'frame.jamb_depth'
    || path === 'opening.finished_wall_thickness_jamb_depth';
  const baseEnum = (options && !isFreeformMeasurement) ? options : (
    isBoolean && field.enumOptions.length === 0
      ? ['Yes', 'No']
      : isFreeformMeasurement
        ? []
        : field.enumOptions
  );
  // Keep the effective value selectable even if filtering excluded it.
  const enumOptions = !isFreeformMeasurement && effectiveValue && !baseEnum.includes(effectiveValue)
    ? [effectiveValue, ...baseEnum]
    : baseEnum;
  const sortedEnumOptions = sortEnumOptions(field, enumOptions);
  // Guided dimension suggestions (chart depths) shown in a datalist so the input
  // stays freeform.
  const measurementSuggestions = isGuidedMeasurement && options && options.length > 0 ? options : null;
  const suggestionsId = measurementSuggestions ? `${path}-suggestions` : undefined;

  const placeholder = (() => {
    if (!dataType.includes('dimension')) return field.allowedValues?.slice(0, 40) ?? '';
    const pathKey = path.toLowerCase();
    if (pathKey.includes('lite_cutout') || pathKey.includes('visible_glass')) return 'e.g. 24 x 36';
    if (pathKey.includes('lite_location')) return 'e.g. centered, 10" from top';
    if (pathKey.includes('glass_thickness') || pathKey.includes('kit_depth')) return 'e.g. 1/4"';
    if (pathKey.includes('jamb_depth') || pathKey.includes('wall_thickness')) return 'e.g. 5 3/4"';
    return 'e.g. 30 or 70';
  })();

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {field.fieldLabel}
        {required && <span className="text-destructive">*</span>}
        {isAuto && (
          <Badge variant="secondary" className="h-4 px-1 text-[9px] font-normal" title={derivedReason ?? 'Auto-filled'}>
            auto
          </Badge>
        )}
        {hasOverride && derived !== '' && (
          <button
            type="button"
            className="text-[9px] text-primary hover:underline"
            onClick={() => onChange(path, '')}
            title={`Revert to auto (${derived})`}
          >
            reset
          </button>
        )}
      </Label>
      {enumOptions.length > 0 ? (
        <Select value={effectiveValue} onValueChange={(v) => onChange(path, v)} disabled={locked}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {isHandField(field)
              ? groupHandOptions(sortedEnumOptions).map((group, index) => (
                <SelectGroup key={group.label}>
                  {index > 0 && <SelectSeparator />}
                  <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </SelectLabel>
                  {group.options.map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-sm">
                      {displayOptionLabel(optionLabels?.[opt] ?? opt)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
              : sortedEnumOptions.map((opt) => (
                <SelectItem key={opt} value={opt} className="text-sm">
                  {displayOptionLabel(optionLabels?.[opt] ?? opt)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            value={effectiveValue}
            onChange={(e) => onChange(path, e.target.value)}
            placeholder={isAuto ? '' : placeholder}
            className="h-8 text-sm"
            readOnly={locked}
            list={suggestionsId}
          />
          {measurementSuggestions && (
            <datalist id={suggestionsId}>
              {measurementSuggestions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}
