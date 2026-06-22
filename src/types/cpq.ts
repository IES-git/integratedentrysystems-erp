/**
 * CPQ v2 - Spec-driven pricing & hardware integration types.
 *
 * Mirrors the canonical Supabase schema introduced by the Pioneer spec-pricing
 * overhaul (migrations prefixed `cpq_v2_`). Field names are camelCase; map to
 * snake_case DB columns in the API layer.
 */

// ===== Shared enums =====
export type ReviewStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW';

export type PriceStatus =
  | 'PRICED'
  | 'NO_CHARGE'
  | 'INCLUDED'
  | 'NOT_APPLICABLE'
  | 'CONTACT_FACTORY';

export type PriceActionType =
  | 'BASE_AMOUNT'
  | 'FIXED_ADD'
  | 'FIXED_ADD_X_QTY'
  | 'RATE_X_QUANTITY'
  | 'PERCENT_OF'
  | 'REFERENCE_PLUS_ADD'
  | 'TIERED_ADD'
  | 'WAIVER'
  | 'OVERRIDE'
  | 'NO_CHARGE'
  | 'INCLUDED'
  | 'NOT_APPLICABLE'
  | 'CONTACT_FACTORY'
  | 'EXTERNAL_REQUIRED';

export type StackingBehavior =
  | 'STACK'
  | 'OVERRIDE'
  | 'EXCLUSIVE_GROUP'
  | 'SUPPRESS_IF_INCLUDED';

export type RoundingMethod =
  | 'NONE'
  | 'CEILING'
  | 'FLOOR'
  | 'NEAREST'
  | 'CEILING_PER_ITEM'
  | 'CEILING_AFTER_SUM';

export type RuleEntityType =
  | 'door'
  | 'frame'
  | 'panel'
  | 'stick'
  | 'specialty'
  | 'prep'
  | 'anchor'
  | 'packaging'
  | 'hardware'
  // NGP infill (glass / lite kits / louvers) — priced via the same rule engine.
  | 'lite_kit'
  | 'louver'
  | 'glass'
  | 'glazing_tape';

/** NGP infill entity types (a subset of RuleEntityType). */
export const NGP_INFILL_ENTITY_TYPES = ['lite_kit', 'louver', 'glass', 'glazing_tape'] as const;
export type NgpInfillEntityType = (typeof NGP_INFILL_ENTITY_TYPES)[number];

export type ProductEntityType = 'door' | 'frame' | 'panel' | 'stick' | 'specialty';

export type OptionEntityType =
  | 'opening'
  | 'door'
  | 'frame'
  | 'panel'
  | 'stick'
  | 'special_frame'
  | 'hardware';

export type SpecFieldEntity =
  | 'opening'
  | 'door'
  | 'frame'
  | 'panel'
  | 'special_frame'
  | 'hardware';

export type ConditionOperator =
  | 'EQ'
  | 'NE'
  | 'IN'
  | 'NOT_IN'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'BETWEEN'
  | 'EXISTS'
  | 'MISSING';

export type ConditionValueType = 'TEXT' | 'NUMBER' | 'DIMENSION' | 'BOOLEAN' | 'CODE' | 'DATE';

export type NullBehavior = 'FAIL' | 'DEFAULT' | 'IGNORE' | 'MANUAL_REVIEW';

export type DependencyRelationship =
  | 'REQUIRES'
  | 'EXCLUDES'
  | 'AUTO_ADD'
  | 'SUPPRESSES'
  | 'DEFAULTS'
  | 'WARNS'
  | 'REQUESTS_INPUT';

export type DependencySeverity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCK_PRICING' | 'BLOCK_ORDER';

export type DependencyTargetType =
  | 'spec_field'
  | 'option_code'
  | 'price_rule'
  | 'external_item'
  | 'manual_quote';

export type PriceTableArchetype =
  | 'base_matrix'
  | 'component_matrix'
  | 'code_adder_list'
  | 'elevation'
  | 'size_oversize'
  | 'per_foot'
  | 'fabrication'
  | 'install_kit'
  | 'anchor'
  | 'quantity_tier'
  | 'percentage'
  | 'next_larger'
  | 'included_nc_na'
  | 'contact_factory'
  | 'specialty_assembly'
  | 'narrative';

export type PriceBookStatus = 'draft' | 'published' | 'superseded' | 'archived';

export type EstimateLineType = 'BASE' | 'ADDER' | 'INCLUDED' | 'EXTERNAL' | 'MANUAL_QUOTE' | 'WARNING';

export type EstimateLinePriceStatus =
  | 'PRICED'
  | 'INCLUDED'
  | 'NO_CHARGE'
  | 'CONTACT_FACTORY'
  | 'EXTERNAL_PENDING'
  | 'INVALID';

export type ManualQuoteReason =
  | 'CONTACT_FACTORY'
  | 'LOW_CONFIDENCE'
  | 'UNRESOLVED_REFERENCE'
  | 'INVALID_COMBINATION'
  | 'MISSING_PRICE';

export type ManualQuoteStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';

export type QaIssueSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCK';
export type QaIssueStatus = 'open' | 'resolved' | 'waived';

export type OpeningConfigurationType =
  | 'single'
  | 'pair'
  | 'double_egress'
  | 'communicating'
  | 'dutch'
  | 'borrowed_lite'
  | 'sidelite_transom'
  | 'storefront'
  | 'specialty';

// Hardware enums
export type SellCostBasis = 'net' | 'list';
export type HardwareCompatibilitySubject = 'product' | 'variant' | 'category';
export type HardwareCompatibilityRelationship = 'REQUIRES' | 'EXCLUDES' | 'ALLOWS';
export type LinearLengthBasis = 'width' | 'height' | 'perimeter' | 'head_plus_jambs' | 'custom';
export type ServiceScopeType =
  | 'install'
  | 'labor'
  | 'wiring'
  | 'glazing'
  | 'freight'
  | 'packaging'
  | 'tax'
  | 'commissioning'
  | 'field_work';
export type ServiceScopeBasis =
  | 'per_opening'
  | 'per_leaf'
  | 'per_unit'
  | 'percent_of'
  | 'flat'
  | 'per_hour';
export type QuoteHardwareLineStatus = 'PRICED' | 'EXTERNAL_PENDING' | 'MANUAL_QUOTE' | 'INVALID';

// ===== Raw evidence layer =====
export interface PriceBookDocument {
  id: string;
  manufacturerId: string | null;
  title: string;
  revision: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  currencyCode: string;
  sourceFilePath: string | null;
  sourceFileHash: string | null;
  pageCount: number | null;
  ingestionProfileKey?: string | null;
  ingestionProfileVersion?: string | null;
  supersedesId: string | null;
  status: PriceBookStatus;
  reviewStatus: ReviewStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRegion {
  id: string;
  priceBookId: string;
  pageNumber: number | null;
  regionType: 'page' | 'table' | 'note' | 'cell' | 'image';
  bbox: Record<string, unknown> | null;
  tableTitle: string | null;
  rawText: string | null;
  extractionConfidence: number | null;
  createdAt: string;
}

export interface RawTableCell {
  id: string;
  sourceRegionId: string;
  priceBookId: string;
  rowIndex: number | null;
  colIndex: number | null;
  rowHeaders: Record<string, unknown>;
  colHeaders: Record<string, unknown>;
  rawValue: string | null;
  normalizedValue: string | null;
  createdAt: string;
}

// ===== Canonical catalog layer =====
export interface ProductFamily {
  id: string;
  priceBookId: string | null;
  entityType: ProductEntityType;
  familyCode: string;
  name: string | null;
  defaultAttributes: Record<string, unknown>;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OptionDefinition {
  id: string;
  entityType: OptionEntityType;
  category: string | null;
  featureNumber: string | null;
  code: string;
  description: string | null;
  templateRequired: boolean;
  handRequired: boolean;
  pdfPages: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PriceTable {
  id: string;
  priceBookId: string;
  entityType: RuleEntityType | null;
  archetype: PriceTableArchetype;
  name: string;
  section: string | null;
  basis: string | null;
  unit: string | null;
  precedence: number;
  sourceRegionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningSpecField {
  id: string;
  fieldId: string;
  entity: SpecFieldEntity;
  category: string | null;
  fieldLabel: string;
  dataType: string | null;
  requiredWhen: string | null;
  allowedValues: string | null;
  pricingLogic: string | null;
  pdfPages: string | null;
  pricedBy: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpecFieldMapping {
  id: string;
  fieldId: string;
  fieldPath: string;
  valueType: ConditionValueType | null;
  notes: string | null;
  createdAt: string;
}

// ===== Pricing rule layer =====
export interface PriceRule {
  id: string;
  ruleKey: string | null;
  priceBookId: string;
  priceTableId: string | null;
  entityType: RuleEntityType;
  chargeCategory: string | null;
  itemOrOptionCode: string | null;
  priceStatus: PriceStatus;
  actionType: PriceActionType;
  amount: number | null;
  currencyCode: string;
  unitOfMeasure: string | null;
  quantityBasisField: string | null;
  baseQuantityIncluded: number | null;
  minimumCharge: number | null;
  maximumCharge: number | null;
  referenceRuleId: string | null;
  percentage: number | null;
  fixedAddAfterReference: number | null;
  roundingMethod: RoundingMethod | null;
  roundingIncrement: number | null;
  priority: number;
  stackingBehavior: StackingBehavior;
  exclusiveGroup: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceRegionId: string | null;
  rawValueText: string | null;
  extractionConfidence: number | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RuleCondition {
  id: string;
  priceRuleId: string;
  conditionGroup: number;
  fieldId: string | null;
  fieldPath: string | null;
  operator: ConditionOperator;
  valueType: ConditionValueType | null;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  inclusiveMin: boolean | null;
  inclusiveMax: boolean | null;
  normalizedValue: string | null;
  sourcePhrase: string | null;
  derivedFlag: boolean;
  nullBehavior: NullBehavior;
  createdAt: string;
}

export interface RuleActionParameter {
  id: string;
  priceRuleId: string;
  paramKey: string;
  paramValue: string | null;
  referenceRuleId: string | null;
  createdAt: string;
}

export interface IncludedScope {
  id: string;
  priceRuleId: string;
  includedFeature: string | null;
  includedOptionCode: string | null;
  suppressesChargeCategory: string | null;
  notes: string | null;
  createdAt: string;
}

export interface QuantityTier {
  id: string;
  priceRuleId: string;
  quantityField: string | null;
  minQty: number | null;
  maxQty: number | null;
  amount: number | null;
  status: PriceStatus | null;
  isSetupCharge: boolean;
  createdAt: string;
}

export interface DependencyRule {
  id: string;
  ruleKey: string | null;
  priceBookId: string | null;
  triggerConditions: Record<string, unknown>;
  relationshipType: DependencyRelationship;
  targetType: DependencyTargetType | null;
  targetIdOrValue: string | null;
  severity: DependencySeverity;
  autoApplyAllowed: boolean;
  messageTemplate: string | null;
  priceEffect: string | null;
  sourceRegionId: string | null;
  priority: number;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalScopeRequirement {
  id: string;
  priceRuleId: string | null;
  category: string;
  requiredAttributes: Record<string, unknown>;
  description: string | null;
  createdAt: string;
}

// ===== Estimate layer =====
export interface EstimateLine {
  id: string;
  estimateId: string | null;
  openingId: string | null;
  componentId: string | null;
  entityType: RuleEntityType | null;
  lineType: EstimateLineType;
  priceRuleId: string | null;
  chargeCategory: string | null;
  description: string | null;
  selectedOptionCode: string | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  unitListPrice: number | null;
  extendedListPrice: number | null;
  discountMultiplier: number | null;
  extendedNetPrice: number | null;
  sellPrice: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  priceStatus: EstimateLinePriceStatus | null;
  calculationExpression: string | null;
  matchedConditions: Record<string, unknown> | null;
  includedOrSuppressedBy: string | null;
  sourcePage: string | null;
  sourceRegionId: string | null;
  priceBookId: string | null;
  confidence: number | null;
  reviewStatus: string | null;
  exceptionMessage: string | null;
  sortOrder: number;
  createdAt: string;
  /** User-entered sell price override. When set, use this instead of sell_price for display/totals. */
  manualSellPrice?: number | null;
  /** True when manual_sell_price has been set by the user on the Review step. */
  isManualOverride?: boolean | null;
}

export interface ManualQuoteQueueItem {
  id: string;
  estimateId: string | null;
  openingId: string | null;
  componentId: string | null;
  priceRuleId: string | null;
  reason: ManualQuoteReason;
  requestedInputs: string | null;
  status: ManualQuoteStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QaIssue {
  id: string;
  priceBookId: string | null;
  priceRuleId: string | null;
  sourceRegionId: string | null;
  checkName: string;
  severity: QaIssueSeverity;
  detail: string | null;
  status: QaIssueStatus;
  createdAt: string;
  updatedAt: string;
}

// ===== Hardware catalog =====
export interface HardwareProduct {
  id: string;
  category: string;
  subcategory: string | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  productFamily: string | null;
  model: string | null;
  description: string | null;
  active: boolean;
  sourceRowRef: string | null;
  sourceConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareVariant {
  id: string;
  hardwareProductId: string;
  sku: string | null;
  function: string | null;
  finish: string | null;
  size: string | null;
  hand: string | null;
  voltage: string | null;
  rating: string | null;
  material: string | null;
  optionAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareAttribute {
  id: string;
  hardwareProductId: string | null;
  hardwareVariantId: string | null;
  attrName: string;
  attrValue: string | null;
  attrUnit: string | null;
  sourceText: string | null;
  createdAt: string;
}

export interface HardwarePriceBook {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  title: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  currencyCode: string;
  sourceFile: string | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HardwarePrice {
  id: string;
  hardwareVariantId: string;
  hardwarePriceBookId: string | null;
  listPrice: number | null;
  discountMultiplier: number | null;
  netCost: number | null;
  uom: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  minimumQuantity: number | null;
  sourceRowRef: string | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareSellRule {
  id: string;
  name: string;
  costBasis: SellCostBasis;
  markupMultiplier: number | null;
  gmTargetPct: number | null;
  rounding: string | null;
  customerClass: string | null;
  companyId: string | null;
  category: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareCompatibilityRule {
  id: string;
  subjectType: HardwareCompatibilitySubject;
  subjectRef: string;
  relationshipType: HardwareCompatibilityRelationship;
  targetType: string | null;
  targetRef: string | null;
  allowedRatings: string | null;
  allowedSizes: string | null;
  allowedFunctions: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwarePrepCrosswalk {
  id: string;
  hardwareCategory: string;
  hardwareProductId: string | null;
  hardwareVariantId: string | null;
  doorPrepCode: string | null;
  framePrepCode: string | null;
  templateId: string | null;
  handRequired: boolean;
  locationRequired: boolean;
  additionalRequiredFields: string | null;
  quantityBasis: string | null;
  pricingBehavior: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareTemplate {
  id: string;
  manufacturerId: string | null;
  manufacturerName: string | null;
  modelSeries: string | null;
  templateNumber: string | null;
  revision: string | null;
  documentLink: string | null;
  dimensions: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareSetTemplate {
  id: string;
  name: string;
  useCase: string | null;
  fireRated: boolean | null;
  accessControlled: boolean | null;
  ratedFlags: Record<string, unknown>;
  selectionConditions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HardwareSetItem {
  id: string;
  hardwareSetTemplateId: string;
  category: string;
  quantityFormula: string | null;
  required: boolean;
  position: number;
  compatibleVariants: Record<string, unknown>;
  createdAt: string;
}

export interface LinearHardwareRule {
  id: string;
  hardwareCategory: string;
  lengthBasis: LinearLengthBasis;
  cutIncrement: number | null;
  wastePct: number | null;
  minimumLength: number | null;
  perFootPrice: number | null;
  hardwareVariantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceScope {
  id: string;
  scopeType: ServiceScopeType;
  name: string;
  basis: ServiceScopeBasis;
  rate: number | null;
  percent: number | null;
  referenceBasis: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== Hardware estimate-scoped =====
export interface KeyingSchedule {
  id: string;
  estimateId: string | null;
  format: string | null;
  keyway: string | null;
  masterKeyHierarchy: Record<string, unknown> | null;
  constructionCoreStrategy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessControlBundle {
  id: string;
  openingId: string | null;
  estimateId: string | null;
  reader: string | null;
  lockStrike: string | null;
  powerTransfer: string | null;
  powerSupply: string | null;
  dps: string | null;
  panelIo: string | null;
  cableRequirements: string | null;
  components: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningHardwareItem {
  id: string;
  openingId: string;
  estimateId: string | null;
  componentId: string | null;
  hardwareVariantId: string | null;
  category: string | null;
  quantity: number;
  selectedFinish: string | null;
  selectedFunction: string | null;
  selectedHand: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteHardwareLine {
  id: string;
  openingHardwareItemId: string | null;
  estimateId: string | null;
  listPrice: number | null;
  netCost: number | null;
  sellPrice: number | null;
  quantity: number | null;
  extension: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  source: string | null;
  prepLinks: Record<string, unknown>;
  status: QuoteHardwareLineStatus | null;
  createdAt: string;
}

// ===== NGP infill catalog (glass / lite kits / louvers / tape) =====

export type NgpInfillType = 'NONE' | 'LITE' | 'LOUVER';

/** NGP product categories as normalized by the importer. */
export type NgpProductCategory =
  | 'GLASS'
  | 'LITE_KIT'
  | 'LOUVER'
  | 'GLAZING_ACCESSORY'
  | 'LOUVER_ACCESSORY'
  | 'FINISH_ACCESSORY';

/** glass_scope on a kit/product: how separate glass is treated at pricing time. */
export type NgpGlassScope =
  | 'SEPARATE_REQUIRED'
  | 'BUNDLED'
  | 'BUNDLED_IN_ASSEMBLY'
  | 'NOT_APPLICABLE';

export interface NgpProduct {
  id: string;
  priceBookDocumentId: string | null;
  productId: string;
  manufacturer: string | null;
  category: string;
  subcategory: string | null;
  model: string | null;
  modelAliases: string | null;
  productName: string | null;
  material: string | null;
  standardFinish: string | null;
  doorThicknessMinIn: number | null;
  doorThicknessMaxIn: number | null;
  glassThicknessMinIn: number | null;
  glassThicknessMaxIn: number | null;
  fireRatingMax: number | null;
  preferredPriceUom: string | null;
  glassScope: string | null;
  active: boolean;
  sourcePage: string | null;
  notes: string | null;
  createdAt: string;
}

export interface NgpKitGlassCapacity {
  id: string;
  priceBookDocumentId: string | null;
  capacityId: string | null;
  kitModel: string;
  doorThicknessIn: number | null;
  glassThicknessIn: number | null;
  requiredTapeModel: string | null;
  profileGroup: string | null;
  allowed: boolean;
  sourcePage: string | null;
}

export interface NgpGlassRating {
  id: string;
  priceBookDocumentId: string | null;
  ratingId: string | null;
  glassModel: string;
  fireMinutes: string | null;
  application: string | null;
  maxVisibleAreaSqIn: number | null;
  maxVisibleWidthIn: number | null;
  maxVisibleHeightIn: number | null;
  sourcePage: string | null;
}

export interface NgpSizeRule {
  id: string;
  priceBookDocumentId: string | null;
  sizeRuleId: string | null;
  modelOrFamily: string;
  outputField: string;
  operator: string | null;
  value: number | null;
  unit: string | null;
  inputBasis: string | null;
  sourcePage: string | null;
}

export interface NgpRelationship {
  id: string;
  priceBookDocumentId: string | null;
  relationshipId: string | null;
  sourceModel: string | null;
  targetModel: string | null;
  relationshipType: string;
  rule: string | null;
  inclusionScope: string | null;
  confidence: string | null;
  sourcePage: string | null;
}

export interface NgpFinishCode {
  id: string;
  priceBookDocumentId: string | null;
  finishCode: string;
  finishName: string | null;
  availability: string | null;
  notes: string | null;
}

export interface NgpOption {
  id: string;
  priceBookDocumentId: string | null;
  optionId: string | null;
  appliesTo: string | null;
  optionCode: string | null;
  optionName: string | null;
  optionType: string | null;
  requirements: string | null;
  exclusions: string | null;
  pricingStatus: string | null;
  priceRuleId: string | null;
  sourcePage: string | null;
}

export interface NgpCommercialPolicy {
  id: string;
  priceBookDocumentId: string | null;
  policyId: string | null;
  policyType: string;
  description: string | null;
  basis: string | null;
  amountOrThreshold: number | null;
  unit: string | null;
  condition: string | null;
  sourcePage: string | null;
}

export interface NgpPriceTableMap {
  id: string;
  priceBookDocumentId: string | null;
  mapId: string | null;
  ngpPriceTableId: string;
  priceTableId: string | null;
  model: string;
  relationship: string | null;
  multiplier: number | null;
  condition: string | null;
  includedScope: string | null;
  glassModel: string | null;
  tapeModel: string | null;
  entityType: string | null;
  sourcePage: string | null;
}

// ===========================================================================
// Spec-driven Opening Builder (Release 1)
//
// Manufacturer series (DOR-002 / FRM-002) are resolution OUTPUTS, never user
// inputs. The user describes requirements (UserOpeningSpec); the resolver
// derives the manufacturer-facing configuration (ResolvedOpeningConfig) and the
// plain-language alternatives an estimator chooses between (ResolutionCandidate).
// ===========================================================================

/**
 * Current resolver contract version. Bump whenever resolution semantics change
 * so openings can be gated between the new engine and the legacy path, and so
 * each `opening_resolution_revision` records the version it was resolved under.
 */
export const RESOLVER_VERSION = 1;

/** Component scope a capability predicate / derived option applies to. */
export type ResolverComponentScope = 'opening' | 'door' | 'frame' | 'panel';

/**
 * User-facing opening requirements ONLY. Manufacturer series, base-table
 * identity, option codes and prep codes are deliberately absent — they are
 * resolver outputs (see {@link ResolvedOpeningConfig}), never user inputs.
 */
export interface UserOpeningSpec {
  openingId: string | null;
  estimateId: string | null;
  name: string;
  quantity: number;
  configurationType: OpeningConfigurationType;
  leafCount: number;
  openingWidth: string;
  openingHeight: string;
  fireLabelRequired: boolean;
  /** Requirement fields keyed by machine field_path (no series/option/prep keys). */
  requirements: Record<string, string>;
}

/** A single derived option/prep on a resolved component. */
export interface ResolvedComponentOption {
  scope: ResolverComponentScope;
  componentId: string | null;
  kind: 'option' | 'prep';
  code: string;
  source: 'derived' | 'estimator' | 'capability';
  description: string | null;
}

/** Internal, manufacturer-facing resolution output. Hidden behind audit detail. */
export interface ResolvedOpeningConfig {
  /** Pioneer family/series per component scope (door/frame/panel). */
  series: Partial<Record<ResolverComponentScope, string>>;
  /** Base price-table identity per scope (resolved base-signature key). */
  baseTableId: Partial<Record<ResolverComponentScope, string | null>>;
  /** Required construction options + preparation codes. */
  options: ResolvedComponentOption[];
  /** NGP product selections, when applicable. */
  ngpProductIds: string[];
  /** Selected hardware variant ids. */
  hardwareVariantIds: string[];
  resolverVersion: number;
  catalogVersion: string | null;
  priceBookId: string | null;
}

/** Plain-language alternative construction the estimator can choose between. */
export interface ResolutionCandidate {
  id: string;
  /** Estimator-facing one-line summary. */
  title: string;
  description: string;
  construction: string | null;
  gauge: string | null;
  core: string | null;
  edge: string | null;
  compliance: string[];
  /** Relative price impact label (e.g. "+$120", "base"). */
  priceImpact: string | null;
  /** Internal series codes — shown ONLY in expandable technical/audit detail. */
  technical: {
    doorSeries: string | null;
    frameSeries: string | null;
    panelSeries: string | null;
    optionCodes: string[];
  };
  /** The resolved config this candidate would produce if chosen. */
  resolved: ResolvedOpeningConfig;
}

export type ResolutionStatus = 'auto' | 'choice_required' | 'manual_quote' | 'invalid';

/** Result of `resolveOpeningSpec`. */
export interface ResolutionResult {
  status: ResolutionStatus;
  candidates: ResolutionCandidate[];
  /** Set when status === 'auto' (single compliant candidate accepted). */
  selected: ResolutionCandidate | null;
  /** Human-readable reasons families were eliminated / routed to manual quote. */
  diagnostics: string[];
  resolverVersion: number;
  catalogVersion: string | null;
}

/**
 * The single quantity contract every priced action returns. Each line extends
 * EXACTLY once: `extendedAmount` is the price for one component instance
 * (unitRate × billableQuantity); the component count and opening quantity are
 * applied later, once each, at component extension and rollup respectively.
 */
export interface QuantityContract {
  /** Price for ONE unit (per single component instance). */
  unitRate: number | null;
  /** Within-component billable quantity from a basis field (default 1). */
  billableQuantity: number;
  /** unitRate × billableQuantity for one component instance. */
  extendedAmount: number | null;
}

// ===== Versioned capability + resolution catalog =====

export type CapabilityOperator = ConditionOperator;

export interface ProductFamilyCapability {
  id: string;
  familyId: string;
  componentScope: ResolverComponentScope;
  field: string;
  operator: CapabilityOperator;
  value: string | null;
  value2: string | null;
  catalogVersion: string;
  notes: string | null;
  createdAt: string;
}

export interface FamilyResolutionPolicy {
  id: string;
  componentScope: ResolverComponentScope;
  familyId: string | null;
  /** Lower ranks are preferred when multiple candidates comply. */
  rank: number;
  /** Whether to auto-accept when this is the sole survivor. */
  autoAccept: boolean;
  displayLabel: string | null;
  catalogVersion: string;
  createdAt: string;
}

export interface OpeningComponentOption {
  id: string;
  openingId: string;
  componentId: string | null;
  scope: ResolverComponentScope;
  kind: 'option' | 'prep';
  code: string;
  source: 'derived' | 'estimator' | 'capability';
  description: string | null;
  createdAt: string;
}

export interface OpeningResolutionRevision {
  id: string;
  openingId: string;
  estimateId: string | null;
  resolverVersion: number;
  catalogVersion: string | null;
  priceBookId: string | null;
  pricedAsOf: string | null;
  inputSpec: Record<string, unknown>;
  candidates: Record<string, unknown>;
  estimatorSelectionId: string | null;
  resolvedConfig: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}
