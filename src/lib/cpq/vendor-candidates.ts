import { buildNormalizedSpec, type ComponentDraft, type OpeningDraft } from './opening-spec';
import { priceOpeningLive } from './live-pricing';
import { resolveOpeningSpecFromDb } from './resolver';
import type { EngineLine } from '@/lib/pricing';
import type { NgpCatalog } from '@/lib/ngp-catalog-api';
import type { ManufacturerCatalogOption, ManufacturerPricedEntity } from '@/lib/price-rules-api';
import type { RuleEntityType, SpecFieldMapping, UserOpeningSpec } from '@/types';

export type VendorCandidatePricingStatus = 'priced' | 'incomplete' | 'manual_quote' | 'invalid';

export interface ComponentVendorCandidate {
  entityType: ManufacturerPricedEntity;
  componentIds: string[];
  manufacturerId: string;
  manufacturerName: string;
  priceBookDocumentId: string;
  priceBookTitle: string | null;
  resolvedSeries: string | null;
  baseLineCount: number;
  netTotal: number;
  sellTotal: number;
}

export interface VendorPackageCandidate {
  id: string;
  manufacturerId: string;
  manufacturerName: string;
  status: VendorCandidatePricingStatus;
  totalNet: number;
  totalSell: number;
  priceBookDocumentIds: Partial<Record<ManufacturerPricedEntity, string>>;
  priceBookTitles: Partial<Record<ManufacturerPricedEntity, string>>;
  resolvedSeries: Partial<Record<ManufacturerPricedEntity, string | null>>;
  components: ComponentVendorCandidate[];
  manualQuoteReason: string | null;
  diagnostics: string[];
}

export interface VendorCandidateResult {
  status: 'ready' | 'incomplete' | 'manual_quote' | 'invalid';
  message: string | null;
  candidates: VendorPackageCandidate[];
}

const STRUCTURAL_ENTITIES = new Set<RuleEntityType>(['door', 'frame', 'panel']);
const SELECTABLE_STATUSES = new Set(['PRICED', 'NO_CHARGE']);
const EXCEPTION_STATUSES = new Set(['INVALID', 'CONTACT_FACTORY', 'EXTERNAL_PENDING']);

function buildRequirementsOnlySpec(draft: OpeningDraft): UserOpeningSpec {
  const requirements: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.openingFields)) if (v) requirements[k] = v;
  const firstDoor = draft.doors[0];
  if (firstDoor) {
    for (const [k, v] of Object.entries(firstDoor.fields)) {
      if (v && k !== 'door.door_series_construction') requirements[k] = v;
    }
  }
  const firstFrame = draft.frames[0];
  if (firstFrame) {
    for (const [k, v] of Object.entries(firstFrame.fields)) {
      if (v && k !== 'frame.frame_series') requirements[k] = v;
    }
  }
  return {
    openingId: draft.openingId,
    estimateId: draft.estimateId,
    name: draft.name,
    quantity: draft.quantity,
    configurationType: draft.configurationType,
    leafCount: draft.leafCount,
    openingWidth: draft.openingWidth,
    openingHeight: draft.openingHeight,
    fireLabelRequired: draft.fireLabelRequired,
    requirements,
  };
}

function requiredEntities(draft: OpeningDraft): ManufacturerPricedEntity[] {
  const entities: ManufacturerPricedEntity[] = [];
  if (draft.doors.length > 0) entities.push('door');
  if (draft.frames.length > 0) entities.push('frame');
  if (draft.panels.length > 0) entities.push('panel');
  return entities;
}

function selectedSeries(draft: OpeningDraft): Partial<Record<ManufacturerPricedEntity, string | null>> {
  return {
    door: draft.doors[0]?.fields['door.door_series_construction'] ?? null,
    frame: draft.frames[0]?.fields['frame.frame_series'] ?? null,
    panel: draft.panels[0]?.fields['panel.panel_construction_series'] ?? null,
  };
}

function constructionOptions(draft: OpeningDraft, candidates: Awaited<ReturnType<typeof resolveOpeningSpecFromDb>>): Array<{
  id: string;
  title: string;
  series: Partial<Record<ManufacturerPricedEntity, string | null>>;
  diagnostics: string[];
}> {
  const current = selectedSeries(draft);
  const hasCurrent = Boolean(current.door || current.frame || current.panel);
  const options = new Map<string, {
    id: string;
    title: string;
    series: Partial<Record<ManufacturerPricedEntity, string | null>>;
    diagnostics: string[];
  }>();

  if (hasCurrent) {
    options.set(`current:${current.door ?? ''}:${current.frame ?? ''}:${current.panel ?? ''}`, {
      id: 'current',
      title: 'Current construction',
      series: current,
      diagnostics: [],
    });
  }

  if (candidates.status === 'auto' || candidates.status === 'choice_required') {
    for (const cand of candidates.candidates) {
      const series = {
        door: cand.resolved.series.door ?? null,
        frame: cand.resolved.series.frame ?? null,
        panel: current.panel ?? null,
      };
      options.set(`resolved:${series.door ?? ''}:${series.frame ?? ''}:${series.panel ?? ''}`, {
        id: cand.id,
        title: cand.title,
        series,
        diagnostics: candidates.diagnostics,
      });
    }
  }

  return [...options.values()];
}

function applyCatalogToDraft(
  draft: OpeningDraft,
  catalog: ManufacturerCatalogOption,
  series: Partial<Record<ManufacturerPricedEntity, string | null>>,
): OpeningDraft {
  const patch = (component: ComponentDraft, entity: ManufacturerPricedEntity): ComponentDraft => {
    const fields = { ...component.fields };
    if (entity === 'door' && series.door) fields['door.door_series_construction'] = series.door;
    if (entity === 'frame' && series.frame) fields['frame.frame_series'] = series.frame;
    if (entity === 'panel' && series.panel) fields['panel.panel_construction_series'] = series.panel;
    return {
      ...component,
      manufacturerId: catalog.manufacturerId,
      priceBookDocumentId: catalog.documentIds[entity] ?? component.priceBookDocumentId ?? null,
      fields,
    };
  };

  return {
    ...draft,
    doors: draft.doors.map((c) => patch(c, 'door')),
    frames: draft.frames.map((c) => patch(c, 'frame')),
    panels: draft.panels.map((c) => patch(c, 'panel')),
  };
}

function pricedStructuralLines(lines: EngineLine[]): EngineLine[] {
  return lines.filter((line) =>
    STRUCTURAL_ENTITIES.has(line.entityType) &&
    line.lineType !== 'INCLUDED' &&
    !line.includedOrSuppressedBy,
  );
}

function baseLinesFor(lines: EngineLine[], components: ComponentDraft[], entityType: ManufacturerPricedEntity): EngineLine[] {
  const ids = new Set(components.map((c) => c.id));
  return lines.filter((line) =>
    line.entityType === entityType &&
    line.lineType === 'BASE' &&
    (!line.componentId || ids.has(line.componentId)),
  );
}

function componentCandidate(
  entityType: ManufacturerPricedEntity,
  components: ComponentDraft[],
  catalog: ManufacturerCatalogOption,
  series: string | null | undefined,
  lines: EngineLine[],
): ComponentVendorCandidate {
  const entityLines = pricedStructuralLines(lines).filter((line) => line.entityType === entityType);
  return {
    entityType,
    componentIds: components.map((c) => c.id),
    manufacturerId: catalog.manufacturerId,
    manufacturerName: catalog.manufacturerName,
    priceBookDocumentId: catalog.documentIds[entityType] ?? '',
    priceBookTitle: catalog.titles[entityType] ?? null,
    resolvedSeries: series ?? null,
    baseLineCount: baseLinesFor(lines, components, entityType).length,
    netTotal: entityLines.reduce((sum, line) => sum + (line.extendedNetPrice ?? 0), 0),
    sellTotal: entityLines.reduce((sum, line) => sum + (line.sellPrice ?? 0), 0),
  };
}

function candidateStatus(
  lines: EngineLine[],
  draft: OpeningDraft,
  required: ManufacturerPricedEntity[],
): { status: VendorCandidatePricingStatus; reason: string | null } {
  for (const entity of required) {
    const components = entity === 'door' ? draft.doors : entity === 'frame' ? draft.frames : draft.panels;
    const base = baseLinesFor(lines, components, entity);
    if (base.length === 0 || base.some((line) => !SELECTABLE_STATUSES.has(line.priceStatus))) {
      return { status: 'incomplete', reason: `${entity} base line did not price.` };
    }
  }

  const exceptions = pricedStructuralLines(lines).filter((line) => EXCEPTION_STATUSES.has(line.priceStatus));
  if (exceptions.some((line) => line.priceStatus === 'INVALID')) {
    return { status: 'invalid', reason: exceptions[0].exceptionMessage ?? exceptions[0].description };
  }
  if (exceptions.length > 0) {
    return { status: 'manual_quote', reason: exceptions[0].exceptionMessage ?? exceptions[0].description };
  }
  return { status: 'priced', reason: null };
}

export async function resolveVendorPackageCandidates({
  draft,
  mappings,
  ngpCatalog,
  manufacturerCatalogs,
}: {
  draft: OpeningDraft;
  mappings: SpecFieldMapping[];
  ngpCatalog: NgpCatalog;
  manufacturerCatalogs: ManufacturerCatalogOption[];
}): Promise<VendorCandidateResult> {
  const required = requiredEntities(draft);
  if (required.length === 0 || !draft.openingWidth || !draft.openingHeight) {
    return {
      status: 'incomplete',
      message: 'Complete the opening size and required door/frame components to see vendor packages.',
      candidates: [],
    };
  }

  const resolution = await resolveOpeningSpecFromDb(buildRequirementsOnlySpec(draft));
  if (resolution.status === 'manual_quote' || resolution.status === 'invalid') {
    return {
      status: resolution.status,
      message: resolution.diagnostics[0] ?? 'This configuration needs a manual quote.',
      candidates: [],
    };
  }

  const constructions = constructionOptions(draft, resolution);
  if (constructions.length === 0) {
    return {
      status: 'incomplete',
      message: 'Complete the required construction fields to price vendor packages.',
      candidates: [],
    };
  }

  const eligibleCatalogs = manufacturerCatalogs.filter((catalog) =>
    required.every((entity) => Boolean(catalog.documentIds[entity])),
  );
  const results = await Promise.all(eligibleCatalogs.flatMap((catalog) =>
    constructions.map(async (construction) => {
      const candidateDraft = applyCatalogToDraft(draft, catalog, construction.series);
      const engineResult = await priceOpeningLive(
        buildNormalizedSpec(candidateDraft, mappings, ngpCatalog),
        { priceBookDocumentId: null },
      );
      const structuralLines = pricedStructuralLines(engineResult.lines);
      const status = candidateStatus(engineResult.lines, candidateDraft, required);
      const components: ComponentVendorCandidate[] = [];
      if (candidateDraft.doors.length > 0) {
        components.push(componentCandidate('door', candidateDraft.doors, catalog, construction.series.door, engineResult.lines));
      }
      if (candidateDraft.frames.length > 0) {
        components.push(componentCandidate('frame', candidateDraft.frames, catalog, construction.series.frame, engineResult.lines));
      }
      if (candidateDraft.panels.length > 0) {
        components.push(componentCandidate('panel', candidateDraft.panels, catalog, construction.series.panel, engineResult.lines));
      }
      return {
        id: `${catalog.manufacturerId}:${construction.id}`,
        manufacturerId: catalog.manufacturerId,
        manufacturerName: catalog.manufacturerName,
        status: status.status,
        totalNet: structuralLines.reduce((sum, line) => sum + (line.extendedNetPrice ?? 0), 0),
        totalSell: structuralLines.reduce((sum, line) => sum + (line.sellPrice ?? 0), 0),
        priceBookDocumentIds: catalog.documentIds,
        priceBookTitles: catalog.titles,
        resolvedSeries: construction.series,
        components,
        manualQuoteReason: status.reason,
        diagnostics: construction.diagnostics,
      } satisfies VendorPackageCandidate;
    }),
  ));

  const sorted = results.sort((a, b) =>
    (a.status === 'priced' ? 0 : 1) - (b.status === 'priced' ? 0 : 1) ||
    a.totalSell - b.totalSell ||
    a.manufacturerName.localeCompare(b.manufacturerName),
  );

  return {
    status: sorted.some((c) => c.status === 'priced') ? 'ready' : 'manual_quote',
    message: sorted.length === 0 ? 'No published vendor package can satisfy the required components.' : null,
    candidates: sorted,
  };
}
