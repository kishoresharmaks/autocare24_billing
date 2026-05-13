# Autocare24 Billing Wireflow Diagram

Visual project map for Autocare24 Billing.

This document uses Mermaid diagrams. Open it in a Markdown preview that supports Mermaid to see the diagrams rendered.

Related guide: [USER_MANUAL.md](USER_MANUAL.md).

## 1. Full Project Wireflow

```mermaid
flowchart LR
  Owner["Owner / Manager"]
  BillingStaff["Billing Staff"]
  StockStaff["Stock Staff"]
  Customer["Customer"]
  Support["Support / Developer"]

  Desktop["Windows Desktop App"]
  Login["First Setup / Login"]
  Overview["Overview Dashboard"]
  Billing["Billing Workspace"]
  Stock["Stock Management"]
  Enquiries["Customer Enquiries"]
  Reports["Reports"]
  Settings["Settings"]
  About["About"]

  LocalDb["Local App Database"]
  Backup["Local Backup / Restore"]
  Drive["Google Drive Backup"]
  Diagnostic["Diagnostic Export"]

  CloudApi["Cloud Sync API"]
  CloudDb["Cloud MySQL / MariaDB"]
  Uploads["Cloud File Upload Storage"]
  Mobile["Android Reports App"]

  WhatsApp["WhatsApp Sharing"]
  PdfPrint["PDF / Print"]

  Owner --> Desktop
  BillingStaff --> Desktop
  StockStaff --> Desktop
  Support --> Diagnostic

  Desktop --> Login
  Login --> Overview
  Overview --> Billing
  Overview --> Stock
  Overview --> Enquiries
  Overview --> Reports
  Overview --> Settings
  Overview --> About

  Billing --> LocalDb
  Stock --> LocalDb
  Enquiries --> LocalDb
  Reports --> LocalDb
  Settings --> LocalDb

  Billing --> PdfPrint
  Billing --> WhatsApp
  Customer --> WhatsApp
  Customer --> PdfPrint

  Settings --> Backup
  Settings --> Drive
  Settings --> Diagnostic
  Backup --> LocalDb
  Drive --> Backup

  Desktop -. optional sync .-> CloudApi
  CloudApi --> CloudDb
  CloudApi --> Uploads
  Mobile -. reports .-> CloudApi
```

## 2. Main Screen Navigation Wireflow

```mermaid
flowchart TD
  Start["Open App"]
  AuthCheck["Check User / Device Status"]
  FirstRun{"First Run?"}
  OwnerSetup["New Owner / Main PC Setup"]
  StaffSetup["Staff / Existing Business PC Setup"]
  Login["Login"]
  Approval["Wait For Owner Approval"]
  Overview["Overview"]

  BillingModule["Billing"]
  StockModule["Stock Management"]
  EnquiryModule["Customer Enquiries"]
  ReportsModule["Reports"]
  SettingsModule["Settings"]
  AboutModule["About"]

  Start --> AuthCheck
  AuthCheck --> FirstRun
  FirstRun -- yes --> OwnerSetup
  FirstRun -- existing business PC --> StaffSetup
  FirstRun -- no --> Login
  StaffSetup --> Approval
  Approval --> Login
  OwnerSetup --> Overview
  Login --> Overview

  Overview --> BillingModule
  Overview --> StockModule
  Overview --> EnquiryModule
  Overview --> ReportsModule
  Overview --> SettingsModule
  Overview --> AboutModule
```

## 3. Business Workflow Wireflow

```mermaid
flowchart LR
  Lead["New Enquiry"]
  Followup["Follow-up"]
  CustomerVehicle["Customer + Vehicle"]
  Quote["Quotation"]
  JobCard["Job Card"]
  Invoice["Final Invoice"]
  Payment["Payment / Due"]
  Reports["Reports"]

  Service["Service / Package"]
  Recipe["Consumable Recipe"]
  RetailItem["Retail Stock Item"]
  StockMove["Stock Movement"]
  Profit["Profit & Expense"]

  Lead --> Followup
  Followup --> CustomerVehicle
  CustomerVehicle --> Quote
  CustomerVehicle --> JobCard
  CustomerVehicle --> Invoice
  Quote --> Invoice
  JobCard --> Invoice
  Invoice --> Payment
  Payment --> Reports

  Service --> Invoice
  Service --> Recipe
  Recipe --> StockMove
  RetailItem --> Invoice
  Invoice --> StockMove
  StockMove --> Reports
  StockMove --> Profit
  Reports --> Profit
```

## 4. Billing And Invoice Lifecycle

```mermaid
flowchart TD
  NewBill["New Bill"]
  Mode["GST Invoice or Simple Receipt"]
  CustomerVehicle["Customer + Vehicle"]
  Lines["Services / Retail Items / Custom Lines"]
  Draft["Draft Bill"]
  Validate{"Valid To Finalize?"}
  CloudNeeded{"Cloud Number Needed?"}
  CloudOk{"Cloud Available?"}
  Finalize["Finalize Invoice"]
  OfficialNo["Official Invoice Number"]
  StockDeduct["Deduct Linked Stock"]
  Payment["Record Initial Payment"]
  Invoice["Invoice History"]

  Print["Print"]
  Pdf["Save PDF"]
  WhatsApp["Send WhatsApp"]
  DueReminder["Due Reminder"]
  Addon["Add Extra Product / Service"]
  Cancel["Cancel And Make New Bill"]
  Replacement["Replacement Draft"]
  Reports["Sales / GST / Dues / Profit Reports"]

  NewBill --> Mode
  Mode --> CustomerVehicle
  CustomerVehicle --> Lines
  Lines --> Draft
  Draft --> Validate
  Validate -- no --> Draft
  Validate -- yes --> CloudNeeded
  CloudNeeded -- no --> Finalize
  CloudNeeded -- yes --> CloudOk
  CloudOk -- no --> Draft
  CloudOk -- yes --> Finalize
  Finalize --> OfficialNo
  OfficialNo --> StockDeduct
  StockDeduct --> Payment
  Payment --> Invoice
  Invoice --> Print
  Invoice --> Pdf
  Invoice --> WhatsApp
  Invoice --> DueReminder
  Invoice --> Addon
  Invoice --> Cancel
  Addon --> StockDeduct
  Cancel --> Replacement
  Invoice --> Reports
```

## 5. Quotation And Job Card Flow

```mermaid
flowchart LR
  Customer["Customer + Vehicle"]

  Quote["Quotation"]
  QuoteStatus["Draft / Sent / Accepted / Rejected / Expired"]
  QuotePdf["Quotation PDF / WhatsApp"]
  QuoteConvert["Convert To Invoice"]

  JobCard["Job Card"]
  Checklist["Checklist"]
  Photos["Photo Proof"]
  JobStatus["Status Timeline"]
  JobPdf["Job Card PDF / WhatsApp"]
  JobConvert["Convert To Invoice"]

  Invoice["Invoice"]
  Reports["Reports"]

  Customer --> Quote
  Quote --> QuoteStatus
  Quote --> QuotePdf
  QuoteStatus --> QuoteConvert
  QuoteConvert --> Invoice

  Customer --> JobCard
  JobCard --> Checklist
  JobCard --> Photos
  JobCard --> JobStatus
  JobCard --> JobPdf
  JobStatus --> JobConvert
  JobConvert --> Invoice

  Invoice --> Reports
```

## 6. Stock Management Flow

```mermaid
flowchart TD
  StockList["Stock List"]
  Suppliers["Suppliers"]
  AddStock["Add Stock"]
  PurchaseBatch["Purchase Batch"]
  PurchaseRecords["Purchase Records"]
  Documents["Supplier PDF / Image Documents"]
  RemoveStock["Remove Stock"]

  Usage["Used In Studio"]
  QuickSale["Stock Sold / Quick Cash Stock Sale"]
  Damage["Damaged / Wasted"]
  InvoiceSale["Invoice Retail Sale"]
  ServiceRecipe["Service Consumable Recipe"]
  Movement["Stock History / Movement"]
  StockReports["Stock Reports"]
  ProfitReports["Profit Reports"]

  Suppliers --> AddStock
  StockList --> AddStock
  AddStock --> PurchaseBatch
  PurchaseBatch --> Movement

  Suppliers --> PurchaseRecords
  PurchaseRecords --> Documents
  PurchaseRecords -. reference only .-> StockReports

  StockList --> RemoveStock
  RemoveStock --> Usage
  RemoveStock --> QuickSale
  RemoveStock --> Damage
  Usage --> Movement
  QuickSale --> Movement
  Damage --> Movement

  StockList --> InvoiceSale
  StockList --> ServiceRecipe
  InvoiceSale --> Movement
  ServiceRecipe --> Movement
  Movement --> StockReports
  Movement --> ProfitReports
```

## 7. Reports And Accounting Flow

```mermaid
flowchart LR
  Invoice["Invoices"]
  Payments["Payments"]
  QuickStockSales["Quick Stock Sales"]
  StockMovements["Stock Movements"]
  Expenses["Expenses"]
  Enquiries["Enquiries"]
  JobCards["Job Cards"]

  SalesReport["Sales Report"]
  GstReport["GST / Tax Report"]
  PaymentDues["Payment & Dues"]
  StockReport["Stock Report"]
  EnquiryReport["Enquiry Report"]
  JobCardReport["Job Card Report"]
  ProfitReport["Profit & Expense"]
  FullSummary["Full Business Summary"]
  Exports["PDF / CSV / Daily Report Backup"]

  Invoice --> SalesReport
  Invoice --> GstReport
  Invoice --> PaymentDues
  Payments --> SalesReport
  Payments --> PaymentDues
  Payments --> ProfitReport
  QuickStockSales --> SalesReport
  QuickStockSales --> ProfitReport
  StockMovements --> StockReport
  StockMovements --> ProfitReport
  Expenses --> ProfitReport
  Enquiries --> EnquiryReport
  JobCards --> JobCardReport

  SalesReport --> FullSummary
  GstReport --> FullSummary
  PaymentDues --> FullSummary
  StockReport --> FullSummary
  EnquiryReport --> FullSummary
  JobCardReport --> FullSummary
  ProfitReport --> FullSummary
  FullSummary --> Exports
```

## 8. Cloud Sync And Multi-PC Flow

```mermaid
flowchart TD
  OwnerPc["Owner Main PC"]
  StaffPc["Additional Staff PC"]
  Register["Register Device With Key"]
  Pending["Pending Approval"]
  Approve["Owner Approves Device"]
  Login["Staff Login"]
  Token["Approved Device Token"]
  SyncPush["Sync Push"]
  SyncPull["Sync Pull"]
  Conflicts["Sync Conflicts"]
  Resolve["Owner Resolves Conflict"]
  FinalInvoice["Finalize Invoice"]
  CloudNumber["Cloud Official Invoice Number"]
  CloudApi["Cloud API /api/v1"]
  CloudDb["Cloud Database"]
  Uploads["File Upload Records"]

  OwnerPc --> Register
  Register --> Token
  StaffPc --> Register
  Register --> Pending
  Pending --> Approve
  Approve --> Token
  Token --> Login
  Token --> SyncPush
  Token --> SyncPull
  SyncPush --> CloudApi
  SyncPull --> CloudApi
  CloudApi --> CloudDb
  CloudApi --> Uploads
  CloudApi --> Conflicts
  Conflicts --> Resolve
  Resolve --> SyncPull
  FinalInvoice --> CloudApi
  CloudApi --> CloudNumber
```

## 9. Backup, Restore, And Support Flow

```mermaid
flowchart TD
  Settings["Settings"]
  LocalDb["Local App Database"]
  LocalBackup["Local Backup Bundle"]
  DriveBackup["Google Drive Backup"]
  Restore["Restore"]
  Reopen["Reopen App"]
  Verify["Verify Invoices / Settings / Stock / Users"]
  Diagnostic["Diagnostic Export"]
  Support["Support"]

  Settings --> LocalBackup
  LocalDb --> LocalBackup
  LocalBackup --> DriveBackup
  Settings --> Restore
  Restore --> LocalDb
  Restore --> Reopen
  Reopen --> Verify
  Settings --> Diagnostic
  Diagnostic --> Support
```

## 10. Access And Permission Flow

```mermaid
flowchart LR
  Owner["Owner"]
  StaffOps["Staff Operations"]
  BillingStaff["Billing Staff"]
  StockStaff["Stock Staff"]
  CustomRole["Custom Role"]

  UsersRoles["Settings - Users & Roles"]
  Permissions["Permission Groups"]
  Nav["Visible Menu Items"]
  ProtectedTools["Protected Owner Tools"]

  Billing["Billing"]
  Stock["Stock"]
  Enquiries["Enquiries"]
  Reports["Reports"]
  Documents["Documents / WhatsApp / PDF"]
  System["Settings / Backup / Cloud / Developer"]

  Owner --> UsersRoles
  UsersRoles --> StaffOps
  UsersRoles --> BillingStaff
  UsersRoles --> StockStaff
  UsersRoles --> CustomRole
  UsersRoles --> Permissions
  Permissions --> Nav

  Permissions --> Billing
  Permissions --> Stock
  Permissions --> Enquiries
  Permissions --> Reports
  Permissions --> Documents
  Permissions --> System

  Owner --> ProtectedTools
  System --> ProtectedTools
```

## 11. Reading The Diagram

- Solid arrows show normal user or data movement.
- Dotted arrows show optional or reference-only connections.
- Billing, stock, enquiries, reports, settings, backup, and cloud sync are connected through shared business records.
- Purchase Records are document references only; they do not increase stock and do not become expenses.
- Quick stock sales are stock movements and reporting entries; they are separate from GST invoice billing.
- Cloud sync helps multi-PC operation and official invoice numbering, but backup is still required.
