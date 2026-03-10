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

export interface EstimateItem {
  id: string;
  estimateId: string;
  itemLabel: string;
  canonicalCode: string;
  quantity: number;
  unitPrice: number | null;
  sortOrder?: number;
  manufacturerId: string | null;
  createdAt: string;
}

export interface EstimateWithItems extends Estimate {
  items: Pick<EstimateItem, 'id' | 'canonicalCode' | 'itemLabel'>[];
}

export interface FieldValueOption {
  id: string;
  fieldDefinitionId: string;
  value: string;
  usageCount: number;
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

export interface FieldDefinition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  valueType: FieldValueType;
  description: string | null;
  status: FieldDefinitionStatus;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
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

// Navigation & UI Types
export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  children?: NavItem[];
}
