# Autocare24 Billing Customer Documentation

Customer-facing guide for the complete Autocare24 Billing project.

This document is written for owners, managers, billing staff, stock staff, and support teams who use the application in daily business operations. It explains what each part of the system does, how normal workflows should be handled, what the important safety rules are, and what information to share when support is needed.

For pure mathematical formulas, see [BILLING_CALCULATIONS.md](BILLING_CALCULATIONS.md).

## 1. Product Overview

Autocare24 Billing is a Windows billing and operations system for a bike and car detailing studio.

The application supports:

- GST invoices and simple receipts
- Invoice drafts, final invoices, payments, cancellations, corrections, and add-ons
- Customer and vehicle records
- Services, packages, and consumable recipes
- Quotations with PDF, WhatsApp sharing, and conversion to bills
- Job cards with checklist, status tracking, photo proof, PDF, and invoice conversion
- Enquiries and follow-ups
- Inventory items, suppliers, purchase batches, stock movement, and purchase document records
- Sales, GST, dues, payment, profit, expense, enquiry, job-card, and stock reports
- Local backup, Google Drive backup, restore, and diagnostic export
- Owner/staff login with access roles and permissions
- Optional cloud sync for multi-PC operation and official cloud invoice numbering
- Optional Android reports app, if provided in the deployment package

## 2. Main Users

### Owner

The owner has full access to all areas:

- Billing and invoice management
- User and role management
- Business and invoice settings
- Reports, profit, and expenses
- Stock and supplier management
- Backup and restore
- Cloud sync and cloud device approvals
- Developer and repair tools, if enabled

### Staff Operations

This role is intended for normal counter and operations staff. It can handle billing, enquiries, services, stock operations, job cards, print/PDF, and WhatsApp sharing.

### Billing Staff

This role is intended for billing counter staff. It can create bills, record payments, manage customer/vehicle details, create quotations, handle job cards, print PDFs, and share documents.

### Stock Staff

This role is intended for inventory staff. It can view stock, manage items, add purchase stock, make adjustments, and manage suppliers.

The owner can create custom roles from the Users and Roles section.

## 3. First-Time Setup

### 3.1 Install The Windows App

1. Run the provided Autocare24 Billing installer.
2. Open the application from the Start Menu or desktop shortcut.
3. If Windows asks for permission, allow the application to run.

Recommended production installer name:

```text
Autocare24 Billing Setup 0.1.12.exe
```

### 3.2 Create Owner Account

On first use, create the owner account:

1. Enter the owner display name.
2. Enter a username.
3. Enter a strong password.
4. Save the account.

Important:

- Keep the owner password private.
- Do not share the owner login with staff.
- Create separate staff accounts for daily work.

### 3.3 Configure Business Settings

Open Settings and review:

- Business name
- Phone number
- Address
- GSTIN, if applicable
- Invoice prefix
- Logo
- Signature
- Watermark
- Bank details
- UPI and QR details
- Invoice footer and terms
- Job-card checklist settings

### 3.4 Create Staff Users

Open Settings, then Users and Roles:

1. Create a staff user.
2. Assign a suitable role.
3. Use custom permissions only if needed.
4. Keep inactive old staff accounts disabled.

## 4. Daily Navigation

The application is organized into these main areas:

- Dashboard
- New Bill
- Invoices
- Quotations
- Job Cards
- Customers
- Services
- Enquiries
- Stock
- Reports
- Settings
- About

The exact visible menu depends on the logged-in user's role and permissions.

## 5. Dashboard

The Dashboard gives a quick business overview.

It normally shows:

- Today's collected revenue
- Current month collected revenue
- Pending dues
- Today's invoice count
- Recent invoices
- Top services
- Enquiry follow-ups
- Job-card summary

Important:

- Dashboard revenue is based on payments received.
- Pending dues are based on unpaid balances of active invoices.
- Cancelled invoices are excluded from active revenue and dues.

## 6. Billing And Invoices

### 6.1 Create A New Bill

Use New Bill for a fresh customer bill.

Typical steps:

1. Select or enter customer details.
2. Select or enter vehicle details.
3. Choose GST invoice or simple invoice.
4. Select intra-state or inter-state tax scope if using GST.
5. Add service or inventory items.
6. Enter quantity, unit price, GST rate, and SAC code if required.
7. Apply discount if needed.
8. Enter paid amount and payment mode if payment is received.
9. Save as draft or finalize, depending on the business process.

Important:

- A final invoice must have a valid customer name and vehicle number.
- At least one item is required.
- Discount cannot be greater than subtotal.
- Paid amount cannot exceed grand total.
- If stock is linked to an item or service recipe, stock availability is checked before final billing.

### 6.2 Draft Invoice

Use draft invoices when:

- The customer has not confirmed yet.
- The final invoice number should not be issued yet.
- Cloud is temporarily unavailable and the app saves the bill as draft.

Drafts should be reviewed and finalized later.

### 6.3 Final Invoice

A final invoice is the official bill.

After finalization:

- An official invoice number is assigned.
- Stock is deducted for linked inventory and service consumables.
- Payment is recorded if paid amount was entered.
- The invoice can be printed, saved as PDF, or shared by WhatsApp.

### 6.4 Record Payment

Use invoice payment when the customer pays later.

Steps:

1. Open Invoices.
2. Select the invoice.
3. Choose Record Payment.
4. Enter payment amount.
5. Select payment mode.
6. Add reference if available.
7. Save.

Rules:

- Cancelled invoices cannot receive payments.
- Payment amount is limited to the current balance due.
- If full balance is paid, payment status becomes Paid.

### 6.5 Print, PDF, And WhatsApp

Invoices can be:

- Printed
- Saved as PDF
- Shared through WhatsApp

Before sharing:

- Check customer phone number.
- Check invoice number.
- Check totals and payment status.
- Confirm logo, signature, bank details, UPI, and QR details are correct in settings.

### 6.6 Invoice Correction And Add-On

Use correction or add-on when work must be added to the same invoice.

Expected behavior:

- The selected invoice is updated.
- Existing paid amount is preserved.
- New total is recalculated.
- New balance due is recalculated.
- Added inventory or consumables are deducted from stock.

Do not create a duplicate invoice when the business decision is to add work to the same invoice.

### 6.7 Invoice Cancellation

Cancel an invoice only when it should no longer count in business totals.

Cancellation effects:

- Invoice status becomes Cancelled.
- Balance due becomes zero.
- Cancelled invoice is excluded from sales revenue.
- Cancelled invoice is excluded from profit revenue.
- Stock used by that invoice is restored when stock movements exist.

Important:

- Enter a clear cancellation reason.
- Use cancellation carefully because it changes reports and stock.
- Do not cancel only to correct spelling or small customer information. Use edit/correction options where available.

## 7. Quotations

Quotations are used before final billing.

Common quotation workflow:

1. Create quotation with customer and vehicle details.
2. Add services or inventory items.
3. Apply discount if needed.
4. Save quotation.
5. Share PDF or WhatsApp copy with customer.
6. Update quotation status.
7. Convert quotation to invoice when customer accepts.

Quotation statuses include:

- Draft
- Sent
- Accepted
- Rejected
- Expired
- Converted

Conversion rules:

- Only suitable open statuses can be converted.
- Converted quotation links to the generated invoice.
- Stock is checked at invoice conversion time.
- Invoice numbering happens during final invoice creation, not quotation creation.

## 8. Job Cards

Job cards are used for vehicle service work tracking.

Common job-card workflow:

1. Create job card with customer and vehicle details.
2. Add job date and expected delivery details.
3. Enter odometer, fuel level, key received status, and belongings note if needed.
4. Add service/work items.
5. Use checklist for inspection and quality steps.
6. Add photo proof where required.
7. Move status as work progresses.
8. Convert to invoice after approval or completion.

Common job-card statuses:

- Draft
- Estimate Pending
- Approved
- In Progress
- Quality Check
- Ready Delivery
- Delivered
- Billed
- Cancelled

Important:

- Draft, estimate-pending, and cancelled job cards are not normally converted to invoice.
- Once converted, the job card links to the invoice.
- Job-card photo proof and checklist help avoid delivery disputes.

## 9. Customers And Vehicles

The customer and vehicle module stores customer history.

Customer details may include:

- Name
- Phone
- Email
- Address
- GSTIN

Vehicle details may include:

- Registration number
- Vehicle type
- Make
- Model
- Color
- Customer link

Good practice:

- Use correct phone numbers for WhatsApp sharing.
- Keep vehicle registration number consistent.
- Avoid duplicate customers where possible.
- Update customer address and GSTIN before issuing GST invoices.

## 10. Services And Packages

Services are reusable billing items.

Use services for:

- Detailing packages
- Washing services
- Ceramic coating work
- Add-on services
- Labor/service charges

Each service can have:

- Name
- Price
- GST rate
- SAC code
- Active/inactive status
- Consumable recipe, if stock should reduce automatically

Service consumables are used when one service consumes inventory stock. Example:

```text
One foam wash uses 0.5 litre shampoo.
If invoice quantity is 3, stock deduction is 1.5 litres.
```

Keep service recipes updated so stock reports remain accurate.

## 11. Stock Management

Stock management controls inventory quantity, cost, and movement history.

### 11.1 Inventory Items

Inventory items may be:

- Retail items sold directly to customers
- Consumables used by services

Item details may include:

- Name
- Type
- Unit
- Low-stock level
- Active status

### 11.2 Suppliers

Suppliers store vendor details such as:

- Name
- Phone
- GSTIN
- Address

### 11.3 Stock Purchase

Use stock purchase when actual inventory is added.

Purchase details include:

- Item
- Supplier
- Batch number
- Purchase date
- Bill number
- Quantity purchased
- Unit cost
- GST rate
- Expiry date, if applicable

Effects:

- A purchase batch is created.
- Quantity remaining starts as purchased quantity.
- A purchase stock movement is recorded.
- Stock value increases.

### 11.4 Purchase Records And Documents

Purchase records are for storing supplier bill references and documents.

They may include:

- Vendor
- Date
- Amount
- Payment mode
- Notes
- PDF or image document

Important:

- Purchase records are reference-only.
- They do not increase stock.
- They do not change expenses.
- They do not change profit.
- To increase stock, use Stock Purchase.
- To record business expense, use Expenses.

### 11.5 Stock Deduction

Stock reduces when:

- A retail inventory item is sold on an invoice.
- A service with consumable recipe is billed.
- A manual usage or damage movement is recorded.

Stock increases when:

- A stock purchase is added.
- A return or adjustment adds quantity.
- A cancelled invoice restores previously deducted stock.

### 11.6 Low Stock And Expiry

Use stock reports to check:

- Current stock quantity
- Stock value
- Low-stock items
- Expiring batches
- Recent stock movements

Good practice:

- Add stock purchase before billing stock-linked services.
- Keep low-stock levels realistic.
- Check expiring batches regularly.
- Avoid manual adjustments unless there is a real stock-count reason.

## 12. Enquiries And Follow-Ups

Use enquiries for leads before customer conversion.

Enquiry details may include:

- Customer name
- Phone
- Email
- Address
- Vehicle type
- Vehicle number
- Interested service
- Expected budget
- Source
- Status
- Follow-up date
- Notes

Common statuses:

- New
- Contacted
- Follow Up
- Visited
- Converted
- Lost

Use follow-up dates to track pending customer calls or visits.

## 13. Reports

Reports help owners understand sales, tax, dues, collections, stock, expenses, profit, enquiries, and job-card performance.

### 13.1 Sales Report

Sales report normally includes:

- Billed value
- Collected amount
- Balance due
- Invoice count
- Cancelled count
- Payment modes
- Sales trend
- Top services

Important:

- Billed value uses invoice date.
- Collected amount uses payment date.
- Cancelled invoices are excluded from active sales totals.

### 13.2 GST Report

GST report includes:

- Taxable value
- CGST
- SGST
- IGST
- Total tax

GST report is based on non-cancelled GST invoices in the selected date range.

### 13.3 Dues Report

Dues report shows invoices where balance due is greater than zero.

Use it for:

- Customer follow-up
- Payment collection
- Pending bill review

### 13.4 Stock Report

Stock report includes:

- Current stock
- Stock value
- Low-stock items
- Expiring batches
- Recent movements
- Batch details

### 13.5 Enquiry Report

Enquiry report includes:

- Total leads
- Converted leads
- Lost leads
- Open leads
- Status split
- Source split

### 13.6 Job-Card Report

Job-card report includes:

- Total job cards
- Open job cards
- Approval pending
- In-progress count
- Completed count
- Cancelled count
- Billed job cards
- Average turnaround days

## 14. Profit And Expenses

Profit report is based on collected money, not only billed invoices.

It normally uses:

- Paid revenue
- Stock cost
- Expenses
- Cash profit
- Profit margin
- Expense categories

Important:

- If an invoice is billed today but paid tomorrow, profit revenue appears on the payment date.
- Stock cost comes from invoice sale/usage movements.
- Expenses are separate records entered in the expense module.
- Purchase records do not automatically become expenses.

For exact formulas, see [BILLING_CALCULATIONS.md](BILLING_CALCULATIONS.md).

## 15. Backup And Restore

Backup is one of the most important owner responsibilities.

### 15.1 What Backup Protects

Backup protects business data such as:

- Invoices
- Customers
- Vehicles
- Quotations
- Job cards
- Stock records
- Services
- Enquiries
- Settings
- Users and roles
- Invoice assets
- Job-card photos
- Purchase documents

### 15.2 Local Backup

Use local backup before:

- Major billing changes
- App update
- Restore operation
- Data import
- Computer service or Windows reinstall

Store backup copies outside the main computer whenever possible.

### 15.3 Google Drive Backup

If configured, Google Drive backup can store backup copies in the connected Drive account.

Good practice:

- Use a business-controlled Google account.
- Confirm backup upload success.
- Periodically download and test backup availability.

### 15.4 Restore

Restore replaces current app data with backup data.

Before restore:

1. Take a fresh safety backup of current data.
2. Confirm the backup file belongs to the correct business.
3. Confirm the backup date and time.
4. Restore only from trusted files.

After restore:

- Reopen the app.
- Check invoices.
- Check settings.
- Check stock.
- Check users and roles.
- Check cloud sync status if used.

## 16. Cloud Sync

Cloud sync is optional but recommended for multi-PC operation and official shared invoice numbering.

### 16.1 What Cloud Sync Does

Cloud sync can handle:

- Multi-PC record sync
- Device registration
- Owner approval for new devices
- Official cloud invoice numbering
- Cloud stock validation for final invoice
- File upload metadata
- Sync conflict tracking

### 16.2 First PC

For the first PC:

1. Open Settings.
2. Open Cloud Sync.
3. Enter Cloud URL.
4. Enter device name.
5. Enter registration key.
6. Connect device.
7. Run Sync Now.

The first PC can be approved automatically when the cloud has no existing owner/users, depending on setup.

### 16.3 Additional PCs

For each additional PC:

1. Install the app.
2. Select **Staff / Existing Business PC** on the first-run screen.
3. Enter the same Cloud URL.
4. Enter a unique device name.
5. Enter registration key.
6. Submit connection request.
7. Wait for owner approval.
8. On an already approved owner PC, open Cloud Devices and approve the pending device.
9. Click **Check approval**, then login with the staff account.

Important:

- Registration key only requests access.
- After owner/users exist, a new device must be approved by an owner.
- Revoke unknown devices immediately.

### 16.4 Cloud Unavailable

If the cloud server or internet is unavailable:

- The app should show a clear cloud unavailable or connection error.
- Local app areas may still be usable.
- Final cloud invoice numbering may be blocked.
- A bill may be kept as draft until cloud is available.

If this happens:

1. Check internet.
2. Check the Cloud URL.
3. Check hosting/API health.
4. Try Sync Now after connection returns.
5. Contact support if final invoice creation is blocked.

### 16.5 Cloud Safety Rules

- Use HTTPS Cloud URL in production.
- Do not share the registration key publicly.
- Revoke unused or suspicious devices.
- Keep cloud database credentials private.
- Keep upload storage private and outside public web folders.
- Do not manually create invoice numbers in cloud database.

## 17. Android Reports App

If the Android reports app is included in your deployment, use the standalone release APK.

Development handoff path:

```text
E:\PROJECT WORKS\Billingsoftwarewindows\android\release\Autocare24-Reports-standalone.apk
```

Important:

- Use the standalone APK for normal installation.
- Do not use a debug/dev-client APK for customer installation.
- If Android app login or reports do not load, check server/cloud connection and app configuration.

## 18. Settings

Settings controls important business behavior.

Common settings:

- Business profile
- Invoice prefix
- GST and tax-related fields
- Logo, signature, and watermark
- Bank details
- UPI details and QR
- Invoice terms and footer
- Template customization
- Job-card checklist
- Users and access roles
- Backup and restore
- Cloud sync

Only owners or trusted managers should change settings.

## 19. Security And Access Control

The app supports permission groups:

- Dashboard
- Billing and Invoices
- Customers and Vehicles
- Job Cards
- Enquiries
- Services and Packages
- Stock
- Reports, Profit, and Expenses
- Documents and Sharing
- System

Security rules:

- Every staff member should have a separate login.
- Staff should not use the owner account.
- Inactive users should be disabled.
- Owner password should be changed if shared accidentally.
- Developer tools should remain owner-only.
- Backup and restore should remain owner-only.
- Cloud device approval should remain owner-only.

## 20. Recommended Daily Workflow

### Morning

1. Open the app.
2. Confirm login.
3. Check Dashboard.
4. Check pending follow-ups.
5. Check open job cards.
6. Check low-stock alerts if stock-linked services are used.

### During Work

1. Create enquiries for new leads.
2. Create job cards for vehicles entering service.
3. Create quotations for estimates.
4. Convert accepted quotations or job cards to invoices.
5. Record payments immediately.
6. Print/PDF/WhatsApp documents after verifying totals.

### End Of Day

1. Check today's invoices.
2. Check payments collected.
3. Check pending dues.
4. Record expenses.
5. Review stock movements if stock was used.
6. Run or confirm backup.
7. Sync cloud if cloud is used.

## 21. Common Troubleshooting

### Cannot Login

Check:

- Correct username
- Correct password
- User is active
- Correct role assigned

If owner password is lost, contact technical support.

### Menu Option Is Missing

The logged-in user may not have permission.

Ask owner to check:

- User role
- Role permissions
- User active status

### Invoice Cannot Be Finalized

Possible reasons:

- Cloud sync is required but unavailable.
- Customer name is missing.
- Vehicle number is missing.
- No items were added.
- Discount is greater than subtotal.
- Stock is not available for linked item or service consumable.

### Stock Not Available

Possible reasons:

- Purchase batch not added.
- Wrong inventory item selected.
- Service recipe uses a consumable that has no stock.
- Quantity entered is higher than available stock.

Fix:

1. Check stock dashboard.
2. Add stock purchase if stock was actually purchased.
3. Correct service recipe if it is wrong.
4. Reopen the invoice and try again.

### PDF Or Print Looks Wrong

Check Settings:

- Logo
- Signature
- Watermark
- Business details
- Bank details
- UPI/QR
- Invoice footer
- Terms

Then regenerate PDF.

### WhatsApp Sharing Fails

Check:

- Customer phone number
- Internet connection
- WhatsApp availability on the machine
- PDF generation status

### Reports Do Not Match Cash In Hand

Remember:

- Sales billed value uses invoice date.
- Collection uses payment date.
- Profit uses collected payments, stock cost, and expenses.
- Cancelled invoices are excluded from active revenue.
- Purchase records are not expenses unless entered as expenses.

### Cloud Device Is Pending

This is expected for additional devices.

Owner must approve the device from an already approved owner PC.

### Restore Shows Old Data

The selected backup may be old.

Check:

- Backup file date
- Business name
- Last invoice number
- Recent customer records
- Recent stock entries

## 22. Information To Share With Support

When asking for support, provide:

- App version
- Windows version
- Screenshot of the problem
- Exact error message
- Invoice number, quotation number, or job-card number
- Customer name and vehicle number, if relevant
- What action was clicked
- Whether cloud sync is enabled
- Whether internet was working
- Last backup date/time
- Whether issue happens for one record or all records

Do not share:

- Owner password
- Cloud database password
- Registration key
- Private backup files unless support specifically requests them through a trusted channel

## 23. Customer Safety Checklist

Use this checklist before live production use:

- Owner account created.
- Staff users created with correct roles.
- Business profile checked.
- GSTIN checked, if GST billing is used.
- Invoice prefix checked.
- Logo, signature, bank details, UPI, and QR checked.
- Services and prices checked.
- Stock items and starting stock checked.
- Service consumable recipes checked.
- Test quotation created.
- Test job card created.
- Test invoice created.
- Test payment recorded.
- Test PDF generated.
- Test WhatsApp sharing checked.
- Backup created and stored safely.
- Cloud sync tested, if used.
- Second device approval tested, if multi-PC is used.
- Reports checked against sample invoices.

## 24. Important Business Rules

- Final invoice numbers should not be edited manually.
- Cancelled invoices should not be used for active sales reporting.
- Purchase records are document references, not automatic expenses.
- Stock purchase increases inventory.
- Invoice sale or service recipe reduces inventory.
- Expenses must be entered separately for profit reporting.
- Backup before restore.
- Keep owner login private.
- Use the standalone Android APK for customer installation.

## 25. Related Documents

- [BILLING_CALCULATIONS.md](BILLING_CALCULATIONS.md): mathematical formula sheet for billing, GST, stock, reports, and profit.
- `cloud-api/README.md`: cloud sync API setup guide for hosting/server deployment.
- `cloud-api/schema.sql`: cloud database schema for technical deployment.
