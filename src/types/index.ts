// User & Auth Types
export type UserRole = 'admin' | 'sales' | 'ops' | 'finance' | 'hr';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

// Customer Types
export interface Customer {
  id: string;
  name: string;
  primaryContactName: string;
  email: string;
  phone: string;
  billingAddress: string;
  shippingAddress: string;
  notes: string;
  createdAt: string;
}

// Estimate Types (PDF Intake)
export type OcrStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Estimate {
  id: string;
  customerId: string | null;
  uploadedByUserId: string;
  source: 'ceco_pdf';
  originalPdfUrl: string;
  originalPdfName: string;
  ocrStatus: OcrStatus;
  ocrError: string | null;
  extractedAt: string | null;
  createdAt: string;
}

export interface EstimateItem {
  id: string;
  estimateId: string;
  itemLabel: string;
  canonicalCode: string;
  quantity: number;
  createdAt: string;
}

export type FieldValueType = 'string' | 'number' | 'bool' | 'date' | 'code';

export interface ItemField {
  id: string;
  estimateItemId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: FieldValueType;
  sourceConfidence: number | null;
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

export interface Quote {
  id: string;
  customerId: string;
  createdByUserId: string;
  estimateId: string;
  status: QuoteStatus;
  totalPrice: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  estimateItemId: string;
  canonicalCode: string;
  quantity: number;
  createdAt: string;
}

export interface QuoteItemField {
  id: string;
  quoteItemId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  valueType: FieldValueType;
  createdAt: string;
  updatedAt: string;
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
