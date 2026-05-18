export interface Account {
  id: string;
  name: string;
  type: string;
  primaryContactName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  accountManager?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  sites?: Site[];
  workOrders?: WorkOrder[];
  invoices?: Invoice[];
  _count?: { sites: number; workOrders: number };
}

export interface Site {
  id: string;
  accountId: string;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  accessNotes?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  petsOnSite: boolean;
  preferredVisitWindow?: string | null;
  account?: Account;
  workOrders?: WorkOrder[];
  _count?: { workOrders: number };
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email?: string | null;
  phone?: string | null;
  hourlyCost: number;
  employmentType: string;
  territory?: string | null;
  active: boolean;
  skills?: { skill: Skill }[];
  vehicles?: Vehicle[];
  assets?: Asset[];
  workOrders?: WorkOrder[];
  _count?: { workOrders: number };
}

export interface Skill {
  id: string;
  name: string;
  category?: string | null;
  _count?: { employees: number };
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  accountId: string;
  siteId: string;
  title: string;
  description?: string | null;
  jobType: string;
  priority: string;
  status: string;
  assignedEmployeeId?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  slaDueAt?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  completionNotes?: string | null;
  slaBreached?: boolean;
  account?: Account;
  site?: Site;
  assignedEmployee?: Employee | null;
  requiredSkills?: { skill: Skill }[];
  quotes?: Quote[];
  invoices?: Invoice[];
  stockMovements?: StockMovement[];
  attachments?: Attachment[];
  timeEntries?: TimeEntry[];
}

export interface Attachment {
  id: string;
  workOrderId: string;
  filename: string;
  mimeType: string;
  kind: string;
  uploadedByEmail?: string | null;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  workOrderId: string;
  employeeId: string;
  date: string;
  hours: number;
  notes?: string | null;
  billable: boolean;
  employee?: Employee;
}

export interface JobCosting {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  status: string;
  quotedRevenue: number;
  invoiceRevenue: number;
  revenue: number;
  estLabourCost: number;
  actualLabourCost: number;
  timesheetHours: number;
  labourSource: string;
  materialCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  travelCost: number;
  disposalCost: number;
  totalActualCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  varianceFromQuote: number;
  marginRisk: boolean;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  workOrderId: string;
  accountId: string;
  status: string;
  labourHours: number;
  labourRate: number;
  materialCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  travelCost: number;
  disposalCost: number;
  marginPercent: number;
  subtotal: number;
  gst: number;
  total: number;
  validUntil?: string | null;
  notes?: string | null;
  account?: Account;
  workOrder?: WorkOrder;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  workOrderId?: string | null;
  accountId: string;
  status: string;
  subtotal: number;
  gst: number;
  total: number;
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
  overdue?: boolean;
  account?: Account;
  workOrder?: WorkOrder;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  unit: string;
  unitCost: number;
  sellPrice: number;
  reorderPoint: number;
  active: boolean;
}

export interface InventoryLocation {
  id: string;
  name: string;
  type: string;
}

export interface StockLevel {
  itemId: string;
  sku: string;
  name: string;
  category?: string | null;
  unit: string;
  unitCost: number;
  sellPrice: number;
  reorderPoint: number;
  totalQuantity: number;
  lowStock: boolean;
  locations: { locationId: string; name: string; quantity: number }[];
}

export interface StockMovement {
  id: string;
  inventoryItemId: string;
  quantity: number;
  movementType: string;
  notes?: string | null;
  createdAt: string;
  inventoryItem?: InventoryItem;
  fromLocation?: InventoryLocation | null;
  toLocation?: InventoryLocation | null;
  workOrder?: WorkOrder | null;
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  _count?: { purchaseOrders: number };
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  status: string;
  expectedDate?: string | null;
  notes?: string | null;
  supplier?: Supplier;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  inventoryItemId: string;
  quantity: number;
  unitCost: number;
  total: number;
  receivedQty: number;
  inventoryItem?: InventoryItem;
}

export interface Vehicle {
  id: string;
  name: string;
  registration: string;
  assignedEmployeeId?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometer: number;
  serviceDueAt?: string | null;
  registrationDueAt?: string | null;
  active: boolean;
  assignedEmployee?: Employee | null;
  serviceDueSoon?: boolean;
  registrationDueSoon?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  assetType: string;
  serialNumber?: string | null;
  assignedEmployeeId?: string | null;
  assignedVehicleId?: string | null;
  status: string;
  serviceDueAt?: string | null;
  assignedEmployee?: Employee | null;
  assignedVehicle?: Vehicle | null;
}

export interface DashboardSummary {
  openWorkOrders: number;
  unassignedJobs: number;
  jobsDueToday: number;
  slaBreaches: number;
  jobsWaitingOnParts: number;
  technicianUtilization: number;
  revenueThisMonth: number;
  grossMarginThisMonth: number;
  outstandingInvoices: number;
  outstandingInvoiceCount: number;
  lowStockItems: number;
  vehiclesDueForService: number;
  worstJobsByMargin: JobCosting[];
}
