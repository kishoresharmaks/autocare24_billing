import type {
  BusinessSettings,
  AppInfo,
  AccessRole,
  AppUser,
  AuthStatus,
  BackupScheduleStatus,
  BackupResult,
  ChangePasswordInput,
  CloudBackupRecord,
  CloudDeviceApprovalInput,
  CloudDeviceListResult,
  CloudDeviceOwnerCredentials,
  CloudDeviceSummary,
  Customer,
  CustomerWithVehicles,
  DataHealthReport,
  DashboardData,
  DateRangePreset,
  DeveloperDiagnostics,
  DriveBackupResult,
  DriveConnectionStatus,
  Enquiry,
  EnquiryDashboardData,
  EnquiryFollowup,
  EnquiryFollowupInput,
  EnquiryInput,
  EnquiryStatus,
  Expense,
  ExpenseInput,
  InventoryBatch,
  InventoryDashboardData,
  InventoryItem,
  InventoryMovement,
  InventoryMovementInput,
  InventoryPurchaseInput,
  InvoiceAppendItemInput,
  InvoiceCancelInput,
  LoginInput,
  InvoiceCreateInput,
  InvoiceDetail,
  InvoiceDraft,
  InvoiceDraftSaveInput,
  InvoiceSummary,
  JobCardDashboardData,
  JobCardDetail,
  JobCardInput,
  JobCardPhoto,
  JobCardPhotoType,
  JobCardStatus,
  JobCardSummary,
  PrintInput,
  PurchaseRecord,
  PurchaseRecordInput,
  QuotationDetail,
  QuotationSaveInput,
  QuotationStatusInput,
  QuotationSummary,
  RecordPaymentInput,
  ProfitReportData,
  ReportDateFilter,
  ReportData,
  ReportExportKind,
  SavePdfInput,
  SaveAccessRoleInput,
  SaveResult,
  SaveUserInput,
  SafeRepairCode,
  SafeRepairResult,
  ServiceConsumable,
  ServiceItem,
  SyncConnectInput,
  SyncConflictResolution,
  SyncConflictSummary,
  SyncDeviceStatus,
  SyncTriggerResult,
  Supplier,
  SetupOwnerInput,
  Vehicle,
  VehicleType,
  WhatsAppShareInput
} from "../shared/types";

declare module "*.png" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    autocare: {
      authStatus: () => Promise<AuthStatus>;
      setupOwner: (input: SetupOwnerInput) => Promise<AppUser>;
      login: (input: LoginInput) => Promise<AppUser>;
      existingBusinessStatus: () => Promise<SyncDeviceStatus>;
      connectExistingBusiness: (input: SyncConnectInput) => Promise<SyncDeviceStatus>;
      checkExistingBusinessApproval: () => Promise<SyncDeviceStatus>;
      logout: () => Promise<boolean>;
      listUsers: () => Promise<AppUser[]>;
      saveUser: (input: SaveUserInput) => Promise<AppUser>;
      deactivateUser: (id: string) => Promise<boolean>;
      listAccessRoles: () => Promise<AccessRole[]>;
      saveAccessRole: (input: SaveAccessRoleInput) => Promise<AccessRole>;
      deactivateAccessRole: (id: string) => Promise<boolean>;
      changePassword: (input: ChangePasswordInput) => Promise<boolean>;
      dashboard: () => Promise<DashboardData>;
      getSettings: () => Promise<BusinessSettings>;
      saveSettings: (settings: Partial<BusinessSettings>) => Promise<BusinessSettings>;
      pickInvoiceAsset: (kind: "logo" | "signature" | "watermark") => Promise<SaveResult>;
      readInvoiceAsset: (filePath?: string) => Promise<SaveResult & { dataUrl?: string }>;
      pickInvoiceLogo: () => Promise<SaveResult>;
      readInvoiceLogo: (filePath?: string) => Promise<SaveResult & { dataUrl?: string }>;
      listServices: (includeInactive?: boolean) => Promise<ServiceItem[]>;
      saveService: (service: Partial<ServiceItem> & Pick<ServiceItem, "name">) => Promise<ServiceItem>;
      deactivateService: (id: string) => Promise<boolean>;
      inventoryDashboard: () => Promise<InventoryDashboardData>;
      listInventoryItems: (includeInactive?: boolean) => Promise<InventoryItem[]>;
      saveInventoryItem: (item: Partial<InventoryItem> & Pick<InventoryItem, "name">) => Promise<InventoryItem>;
      deactivateInventoryItem: (id: string) => Promise<boolean>;
      listSuppliers: () => Promise<Supplier[]>;
      saveSupplier: (supplier: Partial<Supplier> & Pick<Supplier, "name">) => Promise<Supplier>;
      addInventoryPurchase: (input: InventoryPurchaseInput) => Promise<InventoryBatch>;
      addInventoryMovement: (input: InventoryMovementInput) => Promise<InventoryMovement[]>;
      listInventoryBatches: (itemId?: string) => Promise<Array<InventoryBatch & { itemName: string; unit: string }>>;
      listInventoryMovements: (itemId?: string) => Promise<InventoryMovement[]>;
      listPurchaseRecords: (query?: string) => Promise<PurchaseRecord[]>;
      savePurchaseRecord: (input: PurchaseRecordInput, documentPaths?: string[]) => Promise<PurchaseRecord>;
      deletePurchaseRecord: (id: string) => Promise<boolean>;
      pickPurchaseRecordDocuments: () => Promise<string[]>;
      readPurchaseRecordDocument: (fileId: string, localPath?: string) => Promise<SaveResult & { dataUrl?: string }>;
      getServiceRecipe: (serviceId: string) => Promise<ServiceConsumable[]>;
      saveServiceRecipe: (serviceId: string, rows: Array<{ inventoryItemId: string; quantity: number }>) => Promise<ServiceConsumable[]>;
      enquiryDashboard: () => Promise<EnquiryDashboardData>;
      listEnquiries: (filter?: { query?: string; status?: EnquiryStatus | "open" | "followups" }) => Promise<Enquiry[]>;
      saveEnquiry: (input: EnquiryInput) => Promise<Enquiry>;
      listEnquiryFollowups: (enquiryId: string) => Promise<EnquiryFollowup[]>;
      addEnquiryFollowup: (input: EnquiryFollowupInput) => Promise<Enquiry>;
      convertEnquiryToCustomer: (enquiryId: string) => Promise<{ enquiry: Enquiry; customer: Customer; vehicle: Vehicle }>;
      jobCardDashboard: () => Promise<JobCardDashboardData>;
      listJobCards: (filter?: { query?: string; status?: JobCardStatus | "today" | "open" | "approval" | "progress" | "ready" | "closed" }) => Promise<JobCardSummary[]>;
      getJobCard: (id: string) => Promise<JobCardDetail>;
      saveJobCard: (input: JobCardInput) => Promise<JobCardDetail>;
      updateJobCardStatus: (input: { jobCardId: string; status: JobCardStatus; note?: string }) => Promise<JobCardDetail>;
      saveJobCardChecklist: (jobCardId: string, rows: Array<{ id: string; checked: boolean }>) => Promise<JobCardDetail>;
      getJobCardSettings: () => Promise<{ defaultChecklist: string[] }>;
      saveJobCardSettings: (input: { defaultChecklist: string[] }) => Promise<{ defaultChecklist: string[] }>;
      pickJobCardPhotos: (jobCardId: string, type: JobCardPhotoType) => Promise<JobCardPhoto[]>;
      removeJobCardPhoto: (photoId: string) => Promise<boolean>;
      updateJobCardPhotoCaption: (photoId: string, caption: string) => Promise<JobCardPhoto>;
      convertJobCardToInvoice: (jobCardId: string) => Promise<InvoiceDetail>;
      listCustomers: () => Promise<CustomerWithVehicles[]>;
      saveCustomer: (customer: Partial<Customer> & Pick<Customer, "name">) => Promise<Customer>;
      saveVehicle: (vehicle: {
        id?: string;
        customerId: string;
        vehicleType?: VehicleType;
        registrationNumber: string;
        make?: string;
        model?: string;
        color?: string;
      }) => Promise<void>;
      createInvoice: (input: InvoiceCreateInput) => Promise<InvoiceDetail>;
      listInvoices: (query?: string) => Promise<InvoiceSummary[]>;
      getInvoice: (id: string) => Promise<InvoiceDetail>;
      listInvoiceDrafts: () => Promise<InvoiceDraft[]>;
      getInvoiceDraft: (id: string) => Promise<InvoiceDraft>;
      saveInvoiceDraft: (input: InvoiceDraftSaveInput) => Promise<InvoiceDraft>;
      discardInvoiceDraft: (id: string) => Promise<boolean>;
      finalizeInvoiceDraft: (id: string) => Promise<InvoiceDetail>;
      cancelInvoice: (input: InvoiceCancelInput) => Promise<InvoiceDetail>;
      appendInvoiceItem: (input: InvoiceAppendItemInput) => Promise<InvoiceDetail>;
      finalizePendingCloudInvoice: (invoiceId: string) => Promise<InvoiceDetail>;
      movePendingCloudInvoiceToDraft: (invoiceId: string) => Promise<InvoiceDraft>;
      createReplacementDraft: (invoiceId: string) => Promise<InvoiceDraft>;
      createAddonDraft: (invoiceId: string) => Promise<InvoiceDraft>;
      recordPayment: (input: RecordPaymentInput) => Promise<InvoiceDetail>;
      listQuotations: (query?: string) => Promise<QuotationSummary[]>;
      getQuotation: (id: string) => Promise<QuotationDetail>;
      saveQuotation: (input: QuotationSaveInput) => Promise<QuotationDetail>;
      updateQuotationStatus: (input: QuotationStatusInput) => Promise<QuotationDetail>;
      convertQuotationToInvoice: (id: string) => Promise<InvoiceDetail>;
      listExpenses: (filter?: DateRangePreset | ReportDateFilter) => Promise<Expense[]>;
      saveExpense: (input: ExpenseInput) => Promise<Expense>;
      deleteExpense: (id: string) => Promise<boolean>;
      profit: (filter: DateRangePreset | ReportDateFilter) => Promise<ProfitReportData>;
      reports: (filter: DateRangePreset | ReportDateFilter) => Promise<ReportData>;
      exportReportCsv: (input: { kind: ReportExportKind; filter: DateRangePreset | ReportDateFilter; fileName?: string }) => Promise<SaveResult>;
      getDeveloperDiagnostics: () => Promise<DeveloperDiagnostics>;
      scanDataHealth: () => Promise<DataHealthReport>;
      runSafeRepair: (input: { repairCode: SafeRepairCode }) => Promise<SafeRepairResult>;
      getDeveloperLogs: () => Promise<string[]>;
      exportDiagnosticBundle: () => Promise<SaveResult>;
      getAppInfo: () => Promise<AppInfo>;
      openExternal: (url: string) => Promise<boolean>;
      showItemInFolder: (filePath: string) => Promise<SaveResult>;
      print: (input?: PrintInput) => Promise<void>;
      savePdf: (input?: SavePdfInput) => Promise<SaveResult>;
      createBackup: () => Promise<BackupResult>;
      restoreBackup: () => Promise<SaveResult>;
      backupStatus: () => Promise<BackupScheduleStatus>;
      driveStatus: () => Promise<DriveConnectionStatus>;
      connectDrive: (input: { clientId: string; clientSecret: string }) => Promise<DriveConnectionStatus>;
      disconnectDrive: () => Promise<SaveResult>;
      testDriveConnection: () => Promise<SaveResult>;
      backupToDriveNow: () => Promise<DriveBackupResult>;
      listDriveBackups: () => Promise<CloudBackupRecord[]>;
      restoreDriveBackup: (fileId: string) => Promise<SaveResult>;
      syncStatus: () => Promise<SyncDeviceStatus>;
      connectSyncDevice: (input: SyncConnectInput) => Promise<SyncDeviceStatus>;
      disconnectSyncDevice: () => Promise<SaveResult & { status: SyncDeviceStatus }>;
      triggerSync: () => Promise<SyncTriggerResult>;
      checkSyncApproval: () => Promise<SyncDeviceStatus>;
      listCloudDevices: (input: CloudDeviceOwnerCredentials) => Promise<CloudDeviceListResult>;
      approveCloudDevice: (input: CloudDeviceApprovalInput) => Promise<CloudDeviceSummary>;
      revokeCloudDevice: (input: CloudDeviceApprovalInput) => Promise<CloudDeviceSummary>;
      listSyncConflicts: () => Promise<SyncConflictSummary[]>;
      resolveSyncConflict: (input: { conflictId: string; resolution: SyncConflictResolution }) => Promise<SyncConflictSummary>;
      onSyncStatus: (callback: (status: SyncDeviceStatus) => void) => () => void;
      openWhatsAppShare: (input: WhatsAppShareInput) => Promise<SaveResult>;
      exportCsv: (kind: "invoices" | "customers" | "services" | "inventory" | "enquiries" | "jobCards") => Promise<SaveResult>;
      onDatabaseRestored: (callback: () => void) => () => void;
      onBackupScheduleStatus: (callback: (status: BackupScheduleStatus) => void) => () => void;
    };
  }
}

export {};
