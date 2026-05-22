// User & Auth Types
export type UserRole = 'admin' | 'sales' | 'ops' | 'finance' | 'hr';

export interface User {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

// Company & Contact Types
export interface CompanySettings {
  costMultiplier: number;
  paymentTerms: string | null;
  defaultTemplateId: string | null;
  markupOverrides?: Record<string, number>;
}

export type CompanyType = 'customer' | 'manufacturer' | 'both';

export interface Company {
  id: string;
  name: string;
  companyType: CompanyType;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  notes: string | null;
  active: boolean;
  settings: CompanySettings;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Manufacturer Types
export interface Manufacturer {
  id: string;
  name: string;
  primaryContactName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  notes: string;
  createdAt: string;
}

// Estimate Types (PDF Intake)
export type OcrStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Estimate {
  id: string;
  companyId: string | null;
  uploadedByUserId: string;
  source: string;
  originalFileUrl: string;
  originalFileName: string;
  fileType: 'pdf' | 'image';
  ocrStatus: OcrStatus;
  ocrError: string | null;
  extractedCustomerName?: string | null;
  extractedCustomerContact?: string | null;
  extractedCustomerEmail?: string | null;
  extractedCustomerPhone?: string | null;
  customerConfidence?: number | null;
  totalPrice: number | null;
  extractedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** How a unit_price was set on an estimate item. */
export type PriceSource = 'lookup' | 'manual' | 'ocr';

/**
 * Status codes returned by the pricing lookup engine.
 * - matched: a cell price was found and used
 * - no_table: no pricing table exists for this series/category
 * - no_vendor: manufacturer is not linked to any table for this series
 * - no_row: no row matched the width/height dimensions
 * - no_column: no column matched the field values (gauge, material, depth)
 * - no_cell: row+column pair exists but no price has been entered
 * - category_unsupported: item category has no lookup logic yet (e.g. hardware)
 */
export type PriceLookupStatus =
  | 'matched'
  | 'no_table'
  | 'no_vendor'
  | 'no_row'
  | 'no_column'
  | 'no_cell'
  | 'category_unsupported';

/** Snapshot data stored in estimate_items.price_lookup_metadata */
export interface PriceLookupMetadata {
  tableId: string | null;
  rowId: string | null;
  columnId: string | null;
  parentColumnId: string | null;
  adderCellIds: string[];
  vendorId: string | null;
  computedAt: string;
  status: PriceLookupStatus;
  warnings: string[];
}

/** Result of a single pricing lookup call. */
export interface PriceResult {
  basePrice: number | null;
  adders: {
    fieldKey: string;
    fieldLabel: string;
    optionValue: string;
    price: number;
    cellId: string;
  }[];
  totalUnitPrice: number | null;
  vendorId: string | null;
  status: PriceLookupStatus;
  warnings: string[];
  metadata: PriceLookupMetadata;
}

export interface EstimateItem {
  id: string;
  estimateId: string | null;
  itemLabel: string;
  canonicalCode: string;
  quantity: number;
  unitPrice: number | null;
  sortOrder?: number;
  manufacturerId: string | null;
  openingId?: string | null;
  parentItemId?: string | null;
  subcategory?: HardwareSubcategory | null;
  itemType?: ItemCategory | null;
  /** How unit_price was populated. Null means not yet looked up. */
  priceSource?: PriceSource | null;
  /** Snapshot of the last pricing lookup for this item. */
  priceLookupMetadata?: PriceLookupMetadata | null;
  /** True when the user manually entered a price override on the Review step. */
  isManualPriceOverride?: boolean;
  createdAt: string;
}

export interface EstimateItemWithHardware extends EstimateItem {
  hardware: EstimateItem[];
}

export type OpeningTemplateType = 'single' | 'pair' | 'single_with_panel' | 'pair_with_panel';

export interface EstimateOpening {
  id: string;
  estimateId: string;
  name: string;
  quantity: number;
  sortOrder: number;
  templateType: OpeningTemplateType | null;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateOpeningWithItems extends EstimateOpening {
  /** Door and frame items (top-level, no parent). */
  items: EstimateItemWithHardware[];
  /** Opening-level hardware items (parent_item_id = null, subcategory set). */
  hardware: EstimateItem[];
}

export interface EstimateWithItems extends Estimate {
  items: Pick<EstimateItem, 'id' | 'canonicalCode' | 'itemLabel'>[];
  createdByUserName?: string | null;
  openingsCount?: number;
}

export interface FieldValueOption {
  id: string;
  fieldDefinitionId: string;
  value: string;
  usageCount: number;
  sortOrder: number;
  isDefault: boolean;
  /** Abbreviation contributed to a hardware canonical_code when this option is selected (e.g. 'FM', 'SS', '80'). Null for options that produce no token. */
  codeToken?: string | null;
  createdAt: string;
}

export type FieldValueType = 'string' | 'number' | 'bool' | 'date' | 'code';

export interface ItemField {
  id: string;
  estimateItemId: string;
  fieldDefinitionId?: string | null;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: FieldValueType;
  sourceConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

// Field Definition Types
export type FieldDefinitionStatus = 'approved' | 'pending_review';

export type OptionType = 'selection' | 'string' | 'integer';

export type ManufacturerFieldLabelStatus = 'pending' | 'approved';

export interface ManufacturerFieldLabel {
  id: string;
  fieldDefinitionId: string;
  manufacturerId: string | null;
  manufacturerFieldLabel: string;
  status: ManufacturerFieldLabelStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  // joined
  manufacturer?: Pick<Company, 'id' | 'name'>;
}

export interface FieldDefinition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  valueType: FieldValueType;
  optionType: OptionType;
  description: string | null;
  status: FieldDefinitionStatus;
  usageCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // joined
  aliases?: ManufacturerFieldLabel[];
}

export interface BlockedFieldLabel {
  id: string;
  fieldLabel: string;
  fieldKey: string | null;
  fieldDefinitionId: string | null;
  blockedByUserId: string | null;
  notes: string | null;
  createdAt: string;
}

// Item Management Types

/** Top-level category tag. Historically 'doors' | 'frames' | 'hardware'; now any registered slug. */
export type ItemCategory = string;

/** Row from item_type_registry — defines a user or system item type. */
export interface ItemTypeRegistryEntry {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  sortOrder: number;
  isSystem: boolean;
  /** If set, this is a sub-type of the referenced parent slug and should not appear as a top-level category. */
  parentSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row from item_type_base_fields — links a field_definition to an item type as a base field. */
export interface ItemTypeBaseField {
  id: string;
  itemTypeSlug: string;
  fieldDefinitionId: string;
  sortOrder: number;
  passValueToFrame: boolean;
  createdAt: string;
  // joined
  fieldDefinition?: FieldDefinition;
}

export type HardwareSubcategory = 'swing_it' | 'close_it' | 'latch_it' | 'protect_it' | 'mount_it';

export interface HardwareCatalogItem {
  id: string;
  name: string;
  canonicalCode: string;
  subcategory: HardwareSubcategory;
  description?: string;
  active: boolean;
  sortOrder: number;
  /** True for new configurable family rows; false for legacy leaf rows. */
  isFamily?: boolean;
  /** True for the original 66 leaf rows seeded before progressive-disclosure. */
  isLegacy?: boolean;
  /** Required when isFamily=true. Top-level prefix for the assembled canonical_code (e.g. 'HINGE', 'CONT-HINGE'). */
  codePrefix?: string | null;
  /** Ordered list of field_definitions.field_key values whose selected option tokens build the rest of the code. */
  codeFieldKeys?: string[] | null;
  /** Optional human-readable template for the item label (e.g. 'Hinge - {hinge_type} {material}'). Falls back to name. */
  labelTemplate?: string | null;
}

export interface ItemType {
  /** Primary (most-used) canonical code for this item group — used for field management */
  canonicalCode: string;
  /** All canonical codes that belong to this item group */
  canonicalCodes: string[];
  itemLabel: string;
  usageCount: number;
  category: ItemCategory;
  series?: string;
  material?: string;
  gauge?: string;
  openingWidth?: string;
  openingHeight?: string;
  subcategory?: HardwareSubcategory;
  /** True for hardware family rows that require the progressive-disclosure wizard. */
  isFamily?: boolean;
  /**
   * For hardware family rows: the canonical code prefix used in leaf item codes
   * (e.g. 'WSTRIP' for the 'WEATHERSTRIP' family, 'CONT-HINGE' for 'CONT-HINGE').
   * Used to query leaf items even when they are keyed differently from the family.
   */
  hwCodePrefix?: string | null;
}

export interface ItemTypeField {
  id: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
  fieldDefinition?: FieldDefinition;
}

// Template Types
export type TemplateAudience = 'customer' | 'manufacturer';

export interface Template {
  id: string;
  name: string;
  audience: TemplateAudience;
  description: string;
  matchingRulesJson: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type FieldVisibility = 'show' | 'hide';

export interface TemplateField {
  id: string;
  templateId: string;
  fieldKey: string;
  displayLabelOverride: string | null;
  groupName: string | null;
  sortOrder: number;
  visibility: FieldVisibility;
  formattingHint: string | null;
  createdAt: string;
}

// Quote Types
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted';
export type QuoteType = 'customer' | 'manufacturer' | 'both';

export interface Quote {
  id: string;
  estimateId: string;
  companyId: string | null;
  createdByUserId: string;
  status: QuoteStatus;
  quoteType: QuoteType;
  markupMultiplier: number;
  subtotal: number;
  total: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  estimateItemId: string | null;
  itemLabel: string;
  canonicalCode: string | null;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
  createdAt: string;
}

export interface QuoteWithItems extends Quote {
  items: Pick<QuoteItem, 'id' | 'canonicalCode' | 'itemLabel'>[];
}

export type QuoteDocumentAudience = 'customer' | 'manufacturer';
export type GenerationMethod = 'template' | 'ai' | 'manual';

export interface QuoteDocument {
  id: string;
  quoteId: string;
  audience: QuoteDocumentAudience;
  templateId: string | null;
  generationMethod: GenerationMethod;
  documentJson: string;
  pdfUrl: string | null;
  createdAt: string;
}

// Order Types
export type OrderStatus = 
  | 'pending' 
  | 'ordered' 
  | 'in_production' 
  | 'shipped' 
  | 'completed' 
  | 'cancelled';

export interface Order {
  id: string;
  quoteId: string;
  customerId: string;
  status: OrderStatus;
  orderedAt: string | null;
  promisedShipDate: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  userId: string;
  eventType: string;
  notes: string;
  createdAt: string;
}

// Hardware Request Types
export type HardwareStatus = 
  | 'not_needed' 
  | 'needed_not_ordered' 
  | 'ordered' 
  | 'received';

export interface HardwareRequest {
  id: string;
  orderId: string;
  required: boolean;
  status: HardwareStatus;
  vendorName: string | null;
  vendorOrderNumber: string | null;
  trackingNumber: string | null;
  notes: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// QuickBooks Types
export type QbStatus = 'not_synced' | 'synced' | 'error';

export interface QuickBooksSync {
  id: string;
  orderId: string;
  qbStatus: QbStatus;
  qbReferenceId: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
}

// Pricing Types
export type PricingCategory = 'doors' | 'frames' | 'hardware' | 'lites_louvers_glass';

export interface PricingTable {
  id: string;
  category: PricingCategory;
  seriesValue: string;
  fieldValueOptionId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingTableVendor {
  id: string;
  pricingTableId: string;
  companyId: string;
  createdAt: string;
}

export type DimensionCriteriaLeaf =
  | { type: 'in'; values: number[] }
  | { type: 'between'; min: number; max: number }
  | { type: 'gte'; value: number }
  | { type: 'gt'; value: number }
  | { type: 'lte'; value: number };

export type DimensionCriteria =
  | DimensionCriteriaLeaf
  | { type: 'or'; conditions: DimensionCriteriaLeaf[] }
  | { type: 'raw'; label: string };

export type ColumnCriteria = Record<string, string | { type: 'in'; values: string[] }>;

export interface PricingColumn {
  id: string;
  pricingTableId: string;
  label: string;
  criteria: ColumnCriteria;
  /** If set, this column is a sub-column (depth) under the given parent (gauge group). */
  parentColumnId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PricingRow {
  id: string;
  pricingTableId: string;
  label: string;
  widthCriteria: DimensionCriteria | Record<string, never>;
  heightCriteria: DimensionCriteria | Record<string, never>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PricingCell {
  id: string;
  pricingRowId: string;
  pricingColumnId: string;
  price: number | null;
  currency: string;
  notes: string | null;
  updatedAt: string;
}

/** Summary of a single pricing table as shown in series list views. */
export interface PricingTableSummary {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  lastUpdatedAt: string;
  vendors: { id: string; name: string }[];
}

export interface DoorSeriesSummary {
  /** The series value (e.g. 'CH') */
  seriesValue: string;
  /** Display label from field_value_options or item_fields */
  label: string;
  /** The field_value_option id, or null for series discovered from item_fields only */
  fieldValueOptionId: string | null;
  /** All pricing tables that have been created for this series. */
  pricingTables: PricingTableSummary[];
}

/** A row in pricing_table_items — links an item (by canonical_code) to a pricing table. */
export interface PricingTableItem {
  id: string;
  pricingTableId: string;
  canonicalCode: string;
  itemType: string;
  /** Display label fetched from estimate_items.item_label */
  itemLabel: string;
  sortOrder: number;
  createdAt: string;
}

export interface LitesLouversGlassItemSummary {
  /** canonical_code from estimate_items — used as series_value on pricing_tables */
  canonicalCode: string;
  /** Display label (item_label from estimate_items) */
  label: string;
  /** The pricing table id if one exists for this item, otherwise null */
  pricingTableId: string | null;
  rowCount: number;
  columnCount: number;
  lastUpdatedAt: string | null;
  vendors: { id: string; name: string }[];
}

/** A pricing table group as shown in the lites/louvers/glass list view. */
export interface LitesLouversGlassPricingGroup {
  tableId: string;
  tableName: string;
  /** All items tagged to this pricing table */
  items: { canonicalCode: string; label: string }[];
  rowCount: number;
  columnCount: number;
  lastUpdatedAt: string;
  vendors: { id: string; name: string }[];
}

/** Result shape for the grouped lites/louvers/glass list view. */
export interface LitesLouversGlassGroupedListResult {
  /** Pricing tables that have at least one item tagged */
  pricingTables: LitesLouversGlassPricingGroup[];
  /** Items that have no pricing table association yet */
  untaggedItems: { canonicalCode: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Per-item field override types (item_type_field_overrides_and_adders migration)
// ---------------------------------------------------------------------------

/** Row from item_type_field_overrides — per-item copy-on-write field config. */
export interface ItemTypeFieldOverride {
  id: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  fieldLabelOverride: string | null;
  isRequired: boolean;
  isAdder: boolean;
  isHidden: boolean;
  sortOrder: number | null;
  /** True when this field was added directly on the item (not inherited from global). */
  isAddedLocally: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Row from item_type_field_value_options — per-item option set. */
export interface ItemTypeFieldValueOption {
  id: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  value: string;
  sortOrder: number;
  isDefault: boolean;
  /** Abbreviation contributed to a hardware canonical_code when this option is selected. Null for options that produce no token. */
  codeToken?: string | null;
  createdAt: string;
}

/** Row from item_type_manufacturer_field_labels — per-item alias override. */
export interface ItemTypeManufacturerFieldLabel {
  id: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  manufacturerId: string | null;
  manufacturerFieldLabel: string;
  status: ManufacturerFieldLabelStatus;
  /** True when this row marks an inherited global alias as removed for this item. */
  isRemoved: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // joined
  manufacturer?: Pick<Company, 'id' | 'name'>;
}

/** Row from pricing_adder_cells — one price per (table × item × adder field × option value × vendor). */
export interface PricingAdderCell {
  id: string;
  pricingTableId: string;
  canonicalCode: string;
  fieldDefinitionId: string;
  /** The option value (e.g. "18 Gauge") this cell prices. */
  optionValue: string;
  companyId: string;
  price: number | null;
  currency: string;
  notes: string | null;
  updatedAt: string;
}

/**
 * Merged view of a single field for a specific item type, as returned by
 * `getItemFieldsView()`. Combines global field_definitions +
 * item_type_field_overrides into a single object the UI consumes directly.
 */
export interface ItemFieldView {
  definition: FieldDefinition;
  /** Resolved label: override wins, falls back to definition.fieldLabel. */
  effectiveLabel: string;
  isRequired: boolean;
  isAdder: boolean;
  isHidden: boolean;
  sortOrder: number;
  /** True when the field was added locally (not from global defaults). */
  isAddedLocally: boolean;
  /** Effective option list: per-item set when one exists, else global. */
  options: (FieldValueOption | ItemTypeFieldValueOption)[];
  /** Effective alias list: merged global + per-item overrides (is_removed=true filtered out). */
  aliases: (ManufacturerFieldLabel | ItemTypeManufacturerFieldLabel)[];
  /** The raw override row if one exists, null otherwise. */
  override: ItemTypeFieldOverride | null;
}

export interface ItemFieldsView {
  /** Big Five / base fields (series, gauge, opening_width, opening_height). */
  baseFields: ItemFieldView[];
  /** All other (non-Big-Five) fields, sorted by sortOrder. */
  otherFields: ItemFieldView[];
  /** Merged (type-level defaults + per-item overrides) dependency rules for this item. */
  resolvedDependencies: ResolvedFieldDependency[];
}

/** Summary row used by the Adders tab in the Pricing editor. */
export interface AdderFieldSummary {
  canonicalCode: string;
  fieldDefinitionId: string;
  fieldLabel: string;
  itemLabel: string;
  /** Effective option values for this field (per-item if overridden, global otherwise). */
  options: string[];
}

// Navigation & UI Types
export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  children?: NavItem[];
}

// Field Dependency Types

export type DependencyOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between';

export interface ItemTypeFieldDependency {
  id: string;
  itemTypeSlug: string;
  parentFieldDefinitionId: string;
  childFieldDefinitionId: string;
  operator: DependencyOperator;
  triggerValues: (string | number)[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  parentField?: FieldDefinition;
  childField?: FieldDefinition;
}

export interface ItemTypeFieldDependencyOverride {
  id: string;
  canonicalCode: string;
  parentFieldDefinitionId: string;
  childFieldDefinitionId: string;
  operator: DependencyOperator | null;
  triggerValues: (string | number)[] | null;
  sortOrder: number | null;
  isHidden: boolean;
  isAddedLocally: boolean;
  createdAt: string;
  updatedAt: string;
  /** Populated by the API layer when joining field_definitions. */
  childField?: FieldDefinition;
}

export interface ResolvedFieldDependency {
  parentFieldDefinitionId: string;
  childField: FieldDefinition;
  operator: DependencyOperator;
  triggerValues: (string | number)[];
  sortOrder: number;
}
