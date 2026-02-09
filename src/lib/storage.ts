// localStorage-based persistence layer
// Easy to swap with real backend later

import type {
  User,
  Customer,
  Manufacturer,
  Estimate,
  EstimateItem,
  ItemField,
  Template,
  TemplateField,
  Quote,
  QuoteItem,
  QuoteItemField,
  QuoteDocument,
  Order,
  OrderEvent,
  HardwareRequest,
  QuickBooksSync,
} from '@/types';

const STORAGE_KEYS = {
  users: 'ies_users',
  currentUser: 'ies_current_user',
  customers: 'ies_customers',
  manufacturers: 'ies_manufacturers',
  estimates: 'ies_estimates',
  estimateItems: 'ies_estimate_items',
  itemFields: 'ies_item_fields',
  templates: 'ies_templates',
  templateFields: 'ies_template_fields',
  quotes: 'ies_quotes',
  quoteItems: 'ies_quote_items',
  quoteItemFields: 'ies_quote_item_fields',
  quoteDocuments: 'ies_quote_documents',
  orders: 'ies_orders',
  orderEvents: 'ies_order_events',
  hardwareRequests: 'ies_hardware_requests',
  quickBooksSync: 'ies_qb_sync',
} as const;

// Generic helpers
function getItem<T>(key: string, defaultValue: T[] = []): T[] {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setItem<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function now(): string {
  return new Date().toISOString();
}

// User operations
export const userStorage = {
  getAll: (): User[] => getItem<User>(STORAGE_KEYS.users),
  
  getById: (id: string): User | undefined => 
    getItem<User>(STORAGE_KEYS.users).find(u => u.id === id),
  
  create: (user: Omit<User, 'id' | 'createdAt'>): User => {
    const users = getItem<User>(STORAGE_KEYS.users);
    const newUser: User = { ...user, id: generateId(), createdAt: now() };
    setItem(STORAGE_KEYS.users, [...users, newUser]);
    return newUser;
  },
  
  update: (id: string, updates: Partial<User>): User | undefined => {
    const users = getItem<User>(STORAGE_KEYS.users);
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return undefined;
    users[index] = { ...users[index], ...updates };
    setItem(STORAGE_KEYS.users, users);
    return users[index];
  },
  
  delete: (id: string): boolean => {
    const users = getItem<User>(STORAGE_KEYS.users);
    const filtered = users.filter(u => u.id !== id);
    if (filtered.length === users.length) return false;
    setItem(STORAGE_KEYS.users, filtered);
    return true;
  },
  
  getCurrentUser: (): User | null => {
    try {
      const user = localStorage.getItem(STORAGE_KEYS.currentUser);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },
  
  setCurrentUser: (user: User | null): void => {
    if (user) {
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEYS.currentUser);
    }
  },
};

// Customer operations
export const customerStorage = {
  getAll: (): Customer[] => getItem<Customer>(STORAGE_KEYS.customers),
  
  getById: (id: string): Customer | undefined =>
    getItem<Customer>(STORAGE_KEYS.customers).find(c => c.id === id),
  
  create: (customer: Omit<Customer, 'id' | 'createdAt'>): Customer => {
    const customers = getItem<Customer>(STORAGE_KEYS.customers);
    const newCustomer: Customer = { ...customer, id: generateId(), createdAt: now() };
    setItem(STORAGE_KEYS.customers, [...customers, newCustomer]);
    return newCustomer;
  },
  
  update: (id: string, updates: Partial<Customer>): Customer | undefined => {
    const customers = getItem<Customer>(STORAGE_KEYS.customers);
    const index = customers.findIndex(c => c.id === id);
    if (index === -1) return undefined;
    customers[index] = { ...customers[index], ...updates };
    setItem(STORAGE_KEYS.customers, customers);
    return customers[index];
  },
  
  delete: (id: string): boolean => {
    const customers = getItem<Customer>(STORAGE_KEYS.customers);
    const filtered = customers.filter(c => c.id !== id);
    if (filtered.length === customers.length) return false;
    setItem(STORAGE_KEYS.customers, filtered);
    return true;
  },
};

// Manufacturer operations
export const manufacturerStorage = {
  getAll: (): Manufacturer[] => getItem<Manufacturer>(STORAGE_KEYS.manufacturers),
  
  getById: (id: string): Manufacturer | undefined =>
    getItem<Manufacturer>(STORAGE_KEYS.manufacturers).find(m => m.id === id),
  
  create: (manufacturer: Omit<Manufacturer, 'id' | 'createdAt'>): Manufacturer => {
    const manufacturers = getItem<Manufacturer>(STORAGE_KEYS.manufacturers);
    const newManufacturer: Manufacturer = { ...manufacturer, id: generateId(), createdAt: now() };
    setItem(STORAGE_KEYS.manufacturers, [...manufacturers, newManufacturer]);
    return newManufacturer;
  },
  
  update: (id: string, updates: Partial<Manufacturer>): Manufacturer | undefined => {
    const manufacturers = getItem<Manufacturer>(STORAGE_KEYS.manufacturers);
    const index = manufacturers.findIndex(m => m.id === id);
    if (index === -1) return undefined;
    manufacturers[index] = { ...manufacturers[index], ...updates };
    setItem(STORAGE_KEYS.manufacturers, manufacturers);
    return manufacturers[index];
  },
  
  delete: (id: string): boolean => {
    const manufacturers = getItem<Manufacturer>(STORAGE_KEYS.manufacturers);
    const filtered = manufacturers.filter(m => m.id !== id);
    if (filtered.length === manufacturers.length) return false;
    setItem(STORAGE_KEYS.manufacturers, filtered);
    return true;
  },
};

// Estimate operations
export const estimateStorage = {
  getAll: (): Estimate[] => getItem<Estimate>(STORAGE_KEYS.estimates),
  
  getById: (id: string): Estimate | undefined =>
    getItem<Estimate>(STORAGE_KEYS.estimates).find(e => e.id === id),
  
  create: (estimate: Omit<Estimate, 'id' | 'createdAt'>): Estimate => {
    const estimates = getItem<Estimate>(STORAGE_KEYS.estimates);
    const newEstimate: Estimate = { ...estimate, id: generateId(), createdAt: now() };
    setItem(STORAGE_KEYS.estimates, [...estimates, newEstimate]);
    return newEstimate;
  },
  
  update: (id: string, updates: Partial<Estimate>): Estimate | undefined => {
    const estimates = getItem<Estimate>(STORAGE_KEYS.estimates);
    const index = estimates.findIndex(e => e.id === id);
    if (index === -1) return undefined;
    estimates[index] = { ...estimates[index], ...updates };
    setItem(STORAGE_KEYS.estimates, estimates);
    return estimates[index];
  },
  
  delete: (id: string): boolean => {
    const estimates = getItem<Estimate>(STORAGE_KEYS.estimates);
    const filtered = estimates.filter(e => e.id !== id);
    if (filtered.length === estimates.length) return false;
    setItem(STORAGE_KEYS.estimates, filtered);
    return true;
  },
};

// Estimate Item operations
export const estimateItemStorage = {
  getAll: (): EstimateItem[] => getItem<EstimateItem>(STORAGE_KEYS.estimateItems),
  
  getByEstimateId: (estimateId: string): EstimateItem[] =>
    getItem<EstimateItem>(STORAGE_KEYS.estimateItems).filter(i => i.estimateId === estimateId),
  
  getById: (id: string): EstimateItem | undefined =>
    getItem<EstimateItem>(STORAGE_KEYS.estimateItems).find(i => i.id === id),
  
  create: (item: Omit<EstimateItem, 'id' | 'createdAt'>): EstimateItem => {
    const items = getItem<EstimateItem>(STORAGE_KEYS.estimateItems);
    const newItem: EstimateItem = { ...item, id: generateId(), createdAt: now() };
    setItem(STORAGE_KEYS.estimateItems, [...items, newItem]);
    return newItem;
  },
  
  update: (id: string, updates: Partial<EstimateItem>): EstimateItem | undefined => {
    const items = getItem<EstimateItem>(STORAGE_KEYS.estimateItems);
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return undefined;
    items[index] = { ...items[index], ...updates };
    setItem(STORAGE_KEYS.estimateItems, items);
    return items[index];
  },
  
  delete: (id: string): boolean => {
    const items = getItem<EstimateItem>(STORAGE_KEYS.estimateItems);
    const filtered = items.filter(i => i.id !== id);
    if (filtered.length === items.length) return false;
    setItem(STORAGE_KEYS.estimateItems, filtered);
    return true;
  },
};

// Item Field operations
export const itemFieldStorage = {
  getAll: (): ItemField[] => getItem<ItemField>(STORAGE_KEYS.itemFields),
  
  getByEstimateItemId: (estimateItemId: string): ItemField[] =>
    getItem<ItemField>(STORAGE_KEYS.itemFields).filter(f => f.estimateItemId === estimateItemId),
  
  create: (field: Omit<ItemField, 'id' | 'createdAt' | 'updatedAt'>): ItemField => {
    const fields = getItem<ItemField>(STORAGE_KEYS.itemFields);
    const newField: ItemField = { ...field, id: generateId(), createdAt: now(), updatedAt: now() };
    setItem(STORAGE_KEYS.itemFields, [...fields, newField]);
    return newField;
  },
  
  update: (id: string, updates: Partial<ItemField>): ItemField | undefined => {
    const fields = getItem<ItemField>(STORAGE_KEYS.itemFields);
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return undefined;
    fields[index] = { ...fields[index], ...updates, updatedAt: now() };
    setItem(STORAGE_KEYS.itemFields, fields);
    return fields[index];
  },
  
  delete: (id: string): boolean => {
    const fields = getItem<ItemField>(STORAGE_KEYS.itemFields);
    const filtered = fields.filter(f => f.id !== id);
    if (filtered.length === fields.length) return false;
    setItem(STORAGE_KEYS.itemFields, filtered);
    return true;
  },
};

// Quote operations
export const quoteStorage = {
  getAll: (): Quote[] => getItem<Quote>(STORAGE_KEYS.quotes),
  
  getById: (id: string): Quote | undefined =>
    getItem<Quote>(STORAGE_KEYS.quotes).find(q => q.id === id),
  
  getByCustomerId: (customerId: string): Quote[] =>
    getItem<Quote>(STORAGE_KEYS.quotes).filter(q => q.customerId === customerId),
  
  create: (quote: Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>): Quote => {
    const quotes = getItem<Quote>(STORAGE_KEYS.quotes);
    const newQuote: Quote = { ...quote, id: generateId(), createdAt: now(), updatedAt: now() };
    setItem(STORAGE_KEYS.quotes, [...quotes, newQuote]);
    return newQuote;
  },
  
  update: (id: string, updates: Partial<Quote>): Quote | undefined => {
    const quotes = getItem<Quote>(STORAGE_KEYS.quotes);
    const index = quotes.findIndex(q => q.id === id);
    if (index === -1) return undefined;
    quotes[index] = { ...quotes[index], ...updates, updatedAt: now() };
    setItem(STORAGE_KEYS.quotes, quotes);
    return quotes[index];
  },
  
  delete: (id: string): boolean => {
    const quotes = getItem<Quote>(STORAGE_KEYS.quotes);
    const filtered = quotes.filter(q => q.id !== id);
    if (filtered.length === quotes.length) return false;
    setItem(STORAGE_KEYS.quotes, filtered);
    return true;
  },
};

// Order operations
export const orderStorage = {
  getAll: (): Order[] => getItem<Order>(STORAGE_KEYS.orders),
  
  getById: (id: string): Order | undefined =>
    getItem<Order>(STORAGE_KEYS.orders).find(o => o.id === id),
  
  getByCustomerId: (customerId: string): Order[] =>
    getItem<Order>(STORAGE_KEYS.orders).filter(o => o.customerId === customerId),
  
  create: (order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Order => {
    const orders = getItem<Order>(STORAGE_KEYS.orders);
    const newOrder: Order = { ...order, id: generateId(), createdAt: now(), updatedAt: now() };
    setItem(STORAGE_KEYS.orders, [...orders, newOrder]);
    return newOrder;
  },
  
  update: (id: string, updates: Partial<Order>): Order | undefined => {
    const orders = getItem<Order>(STORAGE_KEYS.orders);
    const index = orders.findIndex(o => o.id === id);
    if (index === -1) return undefined;
    orders[index] = { ...orders[index], ...updates, updatedAt: now() };
    setItem(STORAGE_KEYS.orders, orders);
    return orders[index];
  },
  
  delete: (id: string): boolean => {
    const orders = getItem<Order>(STORAGE_KEYS.orders);
    const filtered = orders.filter(o => o.id !== id);
    if (filtered.length === orders.length) return false;
    setItem(STORAGE_KEYS.orders, filtered);
    return true;
  },
};

// Template operations
export const templateStorage = {
  getAll: (): Template[] => getItem<Template>(STORAGE_KEYS.templates),
  
  getById: (id: string): Template | undefined =>
    getItem<Template>(STORAGE_KEYS.templates).find(t => t.id === id),
  
  getByAudience: (audience: 'customer' | 'manufacturer'): Template[] =>
    getItem<Template>(STORAGE_KEYS.templates).filter(t => t.audience === audience),
  
  create: (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>): Template => {
    const templates = getItem<Template>(STORAGE_KEYS.templates);
    const newTemplate: Template = { ...template, id: generateId(), createdAt: now(), updatedAt: now() };
    setItem(STORAGE_KEYS.templates, [...templates, newTemplate]);
    return newTemplate;
  },
  
  update: (id: string, updates: Partial<Template>): Template | undefined => {
    const templates = getItem<Template>(STORAGE_KEYS.templates);
    const index = templates.findIndex(t => t.id === id);
    if (index === -1) return undefined;
    templates[index] = { ...templates[index], ...updates, updatedAt: now() };
    setItem(STORAGE_KEYS.templates, templates);
    return templates[index];
  },
  
  delete: (id: string): boolean => {
    const templates = getItem<Template>(STORAGE_KEYS.templates);
    const filtered = templates.filter(t => t.id !== id);
    if (filtered.length === templates.length) return false;
    setItem(STORAGE_KEYS.templates, filtered);
    return true;
  },
};

// Initialize with demo data if empty
export function initializeDemoData(): void {
  // Create demo user if none exists
  if (userStorage.getAll().length === 0) {
    const demoUser = userStorage.create({
      name: 'John Smith',
      firstName: 'John',
      lastName: 'Smith',
      jobTitle: 'Sales Representative',
      email: 'john@integratedentrysystems.com',
      role: 'sales',
      active: true,
    });
    userStorage.setCurrentUser(demoUser);
    
    userStorage.create({
      name: 'Sarah Johnson',
      firstName: 'Sarah',
      lastName: 'Johnson',
      jobTitle: 'Operations Manager',
      email: 'sarah@integratedentrysystems.com',
      role: 'ops',
      active: true,
    });
    
    userStorage.create({
      name: 'Mike Chen',
      firstName: 'Mike',
      lastName: 'Chen',
      jobTitle: 'Finance Analyst',
      email: 'mike@integratedentrysystems.com',
      role: 'finance',
      active: true,
    });
    
    userStorage.create({
      name: 'Admin User',
      firstName: 'Admin',
      lastName: 'User',
      jobTitle: 'System Administrator',
      email: 'admin@integratedentrysystems.com',
      role: 'admin',
      active: true,
    });
  }
  
  // Create demo customers if none exist
  if (customerStorage.getAll().length === 0) {
    customerStorage.create({
      name: 'ABC Construction',
      primaryContactName: 'Robert Wilson',
      email: 'rwilson@abcconstruction.com',
      phone: '(555) 123-4567',
      billingAddress: '123 Main St, Suite 100, Dallas, TX 75201',
      shippingAddress: '456 Commerce Dr, Dallas, TX 75202',
      notes: 'Preferred customer - net 30 terms',
    });
    
    customerStorage.create({
      name: 'Metro Building Group',
      primaryContactName: 'Lisa Martinez',
      email: 'lmartinez@metrobg.com',
      phone: '(555) 987-6543',
      billingAddress: '789 Corporate Blvd, Houston, TX 77001',
      shippingAddress: '789 Corporate Blvd, Houston, TX 77001',
      notes: 'New customer - requires credit check',
    });
    
    customerStorage.create({
      name: 'Skyline Developers',
      primaryContactName: 'James Park',
      email: 'jpark@skylinedev.com',
      phone: '(555) 456-7890',
      billingAddress: '321 Tower Ave, Austin, TX 78701',
      shippingAddress: '555 Project Site Rd, Austin, TX 78702',
      notes: 'Large commercial projects',
    });
  }

  // Create demo manufacturers if none exist
  if (manufacturerStorage.getAll().length === 0) {
    manufacturerStorage.create({
      name: 'CECO Door Products',
      primaryContactName: 'Tom Henderson',
      email: 'thenderson@cecodoor.com',
      phone: '(800) 232-6773',
      address: '1601 Blount Rd, Pompano Beach, FL 33069',
      website: 'https://www.cecodoor.com',
      notes: 'Primary hollow metal door supplier',
    });

    manufacturerStorage.create({
      name: 'Curries Company',
      primaryContactName: 'Amanda Foster',
      email: 'afoster@curries.com',
      phone: '(800) 324-8830',
      address: '1502 12th St NW, Mason City, IA 50401',
      website: 'https://www.curries.com',
      notes: 'Steel doors and frames - quick turnaround',
    });

    manufacturerStorage.create({
      name: 'Steelcraft',
      primaryContactName: 'David Kim',
      email: 'dkim@steelcraft.com',
      phone: '(800) 543-4501',
      address: '9017 Blue Ash Rd, Cincinnati, OH 45242',
      website: 'https://www.steelcraft.com',
      notes: 'Premium hollow metal doors',
    });

    manufacturerStorage.create({
      name: 'Republic Doors',
      primaryContactName: 'Jennifer Blake',
      email: 'jblake@republicdoor.com',
      phone: '(800) 733-3667',
      address: '155 Republic Dr, McKenzie, TN 38201',
      website: 'https://www.republicdoor.com',
      notes: 'Commercial steel doors and frames',
    });
  }

  // Create demo templates if none exist
  if (templateStorage.getAll().length === 0) {
    const currentUser = userStorage.getCurrentUser();
    const userId = currentUser?.id || 'system';

    templateStorage.create({
      name: 'Standard Customer Quote',
      audience: 'customer',
      description: 'Professional customer-facing quote with pricing and specifications',
      matchingRulesJson: JSON.stringify({ includesPricing: true, includesSpecs: true }),
      createdByUserId: userId,
    });

    templateStorage.create({
      name: 'Detailed Manufacturer RFQ',
      audience: 'manufacturer',
      description: 'Comprehensive request for quote with all technical specifications',
      matchingRulesJson: JSON.stringify({ detailed: true, technical: true }),
      createdByUserId: userId,
    });

    templateStorage.create({
      name: 'Quick Estimate Summary',
      audience: 'customer',
      description: 'Simplified quote format for fast turnaround projects',
      matchingRulesJson: JSON.stringify({ simplified: true }),
      createdByUserId: userId,
    });
  }
}
