# Autocare24 Billing User Manual

Complete end-user manual for owners, managers, billing staff, stock staff, and daily operators.

This manual explains what the software includes, how each feature works, how to use each feature, and how the modules connect to each other.

For exact billing formulas and report calculations, see [BILLING_CALCULATIONS.md](BILLING_CALCULATIONS.md).

## 1. Product Overview

Autocare24 Billing is a Windows billing and operations system for a vehicle detailing studio. It is used to manage billing, customers, vehicles, services, quotations, job cards, stock, reports, backups, access control, and optional cloud sync.

The software includes:

- GST invoices and simple receipts
- Draft bills and final invoices
- Invoice payments, dues, corrections, add-ons, cancellations, PDF, print, and WhatsApp sharing
- Customer and vehicle records
- Services, packages, prices, GST rates, SAC codes, and service consumable recipes
- Quotations with status tracking, PDF, WhatsApp sharing, and conversion to invoice
- Job cards with checklist, status, photo proof, delivery details, PDF, WhatsApp sharing, and conversion to invoice
- Enquiries and follow-ups
- Stock items, suppliers, purchase batches, purchase records, remove stock, quick cash stock sale, stock history, and stock reports
- Sales, GST, payment, dues, stock, enquiry, job-card, profit, and expense reports
- Report PDF and CSV exports
- Daily report backup
- Local backup, Google Drive backup, restore, and diagnostic export
- Owner and staff login with roles and permissions
- Optional cloud sync for multi-PC business data, cloud device approval, official invoice numbering, and file upload records
- Optional Android reports app, if included in the deployment package

## 2. Main Users And Roles

### Owner

The owner account has full access. The owner can manage billing, invoices, customers, services, stock, reports, expenses, settings, users, roles, backup, restore, cloud devices, and protected system tools.

Use the owner account only for trusted owner or manager work. Do not share the owner password with staff.

### Staff Operations

Staff Operations is a broad daily-use role. It is suitable for normal counter work, enquiries, billing, job cards, service management, stock operations, PDF, and WhatsApp sharing.

### Billing Staff

Billing Staff is intended for the billing counter. This role can create bills, manage customers and vehicles, create quotations, work with job cards, record payments, print PDFs, and share documents.

### Stock Staff

Stock Staff is intended for inventory work. This role can view stock, manage items, add purchased stock, remove or adjust stock, and manage suppliers.

### Custom Roles

The owner can create custom roles in Settings > Users & Roles. Menu items are shown or hidden based on the user's permissions.

## 3. First-Time Setup

### 3.1 Before You Start

Keep these details ready:

- Business name, address, phone number, and GSTIN if GST billing is used
- Invoice prefix, such as `INV` or `AUTOCARE24`
- Business logo, signature image, watermark image, UPI ID, and UPI QR image if available
- Owner username and password
- Staff names and role plan
- Current service price list
- Current stock list, if stock tracking is used
- Cloud URL and registration key, only if cloud sync is enabled

### 3.2 Install The Windows App

1. Run the provided installer.
2. Open Autocare24 Billing from the desktop shortcut or Start Menu.
3. If Windows asks for permission, allow the app only if the installer came from the trusted handover package.

The production installer name may look like:

```text
Autocare24 Billing Setup 0.1.12.exe
```

### 3.3 Create Owner Account

On the first launch, select New Owner / Main PC and create the owner account.

1. Enter owner name.
2. Enter username.
3. Enter password or PIN.
4. Confirm the password or PIN.
5. Click Create owner account.

Keep this password private. Create separate staff accounts for daily work.

### 3.4 Connect Existing Business PC

Use Staff / Existing Business PC only when this computer must connect to an already existing cloud business.

1. Enter the Cloud API URL.
2. Enter a unique device name, such as `Front Desk PC`.
3. Enter the registration key.
4. Click Connect device.
5. Wait for owner approval.
6. After the owner approves this PC, click Check approval.
7. Login with the staff username and password.

## 4. Login And Daily Navigation

After setup, open the app and login with your username and password.

The main navigation may include:

| Main Area | What It Is Used For |
| --- | --- |
| Overview | Today's business summary, workspaces, quick actions, and weekly activity |
| Billing | New bills, quotations, job cards, invoices, customers, WhatsApp, services |
| Stock Management | Stock overview, stock list, add stock, purchase records, remove stock, suppliers, stock history |
| Customer Enquiries | Follow-ups, new enquiries, open enquiries, converted leads, lost leads |
| Reports | Full business summary, sales, GST, payments, dues, stock, enquiries, job cards, profit, expenses |
| Settings | Business details, invoice template, users, roles, backup, cloud status, exports |
| About | App information, version, modules, and support details |

If a menu option is missing, the logged-in user probably does not have permission for that feature. Ask the owner to review Settings > Users & Roles.

## 5. How Everything Is Connected

The app is designed around connected business workflows. One entry can affect many later screens.

### 5.1 Customer Workflow

```text
Enquiry -> Customer and Vehicle -> Quotation or Job Card -> Invoice -> Payment -> Reports
```

- Enquiries capture leads and follow-ups.
- Converted enquiries can become real customer or job-card work.
- Customers and vehicles are reused in quotations, job cards, and invoices.
- Quotations and job cards can be converted into invoices.
- Invoices create sales, dues, payments, GST, and profit report data.

### 5.2 Billing And Stock Workflow

```text
Service or retail item -> Invoice -> Stock deduction -> Stock history -> Stock and profit reports
```

- Retail items sold on invoices reduce stock.
- Services can have consumable recipes. When billed, the linked consumables reduce automatically.
- Stock movements are recorded so stock reports and profit cost can be calculated.
- Cancelled invoices can restore stock when stock movement history exists.

### 5.3 Stock Purchase, Purchase Record, And Expense

These three features are different:

| Feature | What It Does | Affects Stock? | Affects Profit Expenses? |
| --- | --- | --- | --- |
| Stock Purchase | Adds real stock quantity and cost batches | Yes | No, unless separately entered as expense |
| Purchase Record | Stores supplier bill details and optional PDF/image | No | No |
| Expense | Records business cost such as rent, salary, utility, or vendor cost | No | Yes |

Use Stock Purchase to increase stock. Use Purchase Records to save supplier bill references. Use Expenses to affect profit.

### 5.4 Local Data, Cloud Sync, And Backups

The desktop app stores operational data on the computer and can sync with the cloud API when cloud sync is configured. Cloud sync is used for multi-PC business records, cloud device approval, official invoice numbering, and file upload records.

Backups protect the business from computer failure, accidental restore, Windows reinstall, or update problems. Cloud sync is not a replacement for backup. Always keep backups.

## 6. Overview Dashboard

The Overview page gives a quick picture of the business.

It can show:

- Today paid
- Pending dues
- Today bills
- Stock value
- Today follow-up calls
- Workspaces for Billing, Stock Management, and Customer Enquiries
- Quick actions such as Create Bill, Job Card, Add Stock, Add Lead, and View Reports
- Weekly sales and activity

Important rules:

- Today paid is based on money collected today.
- Pending dues are unpaid balances of active invoices.
- Cancelled invoices are excluded from active sales and dues.
- If cloud data is unavailable in a cloud-required setup, overview and business data screens may show a clear cloud unavailable message.

## 7. Billing And Invoices

### 7.1 GST Invoice And Simple Receipt

Use GST invoice when the customer requires GST tax details.

Use Simple receipt when GST is not needed for that sale.

For GST invoices:

- Intra-state tax shows CGST + SGST.
- Inter-state tax shows IGST.
- GST rate and SAC code can be stored on services and entered on bill lines.

For simple receipts:

- GST is not calculated.
- Tax fields are treated as zero.

### 7.2 Create A New Bill

Open Billing > New Bill.

1. Select GST invoice or Simple receipt.
2. Select tax type if GST is used.
3. Enter invoice date.
4. Select existing customer or enter new customer details.
5. Enter vehicle details.
6. Add service lines, retail stock lines, or custom bill lines.
7. Check quantity, unit price, GST rate, SAC code, and line total.
8. Enter discount if required.
9. Enter paid amount if payment is received.
10. Select payment mode: Cash, UPI, Card, Bank Transfer, or Other.
11. Enter payment reference if available.
12. Save draft or click Finalize invoice.

Before finalizing, check customer name, vehicle number, invoice type, item details, discount, paid amount, and total.

### 7.3 Draft Bills

Draft bills are editable bills before final invoice creation.

Use drafts when:

- The customer has not confirmed.
- You need to pause and finish the bill later.
- Cloud is unavailable and the final cloud invoice number cannot be created.
- You are preparing an add-on or replacement flow.

Drafts can be opened later from New Bill. Draft changes are saved so the work is not lost.

### 7.4 Final Invoices

A final invoice is the official bill.

After finalization:

- Official invoice number is assigned.
- Invoice history is locked for billing history.
- Stock is reduced for retail items and service consumables.
- Payment is recorded if paid amount was entered.
- Invoice appears in reports.
- PDF, print, and WhatsApp sharing become available when the invoice has its official number.

Important:

- Final invoice numbers should not be edited manually.
- At least one item is required.
- Customer name and vehicle number are required.
- Paid amount cannot be greater than grand total.
- Discount cannot be greater than subtotal.
- If cloud numbering is required and the cloud is unavailable, the bill should remain as draft until cloud is available.

### 7.5 Record Payment

Open Billing > Invoices, select an invoice, then use Record payment.

1. Enter amount.
2. Select payment mode.
3. Enter reference if available.
4. Click Save payment.

Rules:

- Payment amount cannot exceed the current balance due.
- Cancelled invoices cannot receive payments.
- When full balance is paid, payment status becomes Paid.
- Reports use payment dates for collected amount and profit revenue.

### 7.6 Print, Save PDF, And WhatsApp

From Invoices, select the invoice and use:

- Print
- Save PDF
- Send WhatsApp template
- Due reminder, if balance is pending

Before sharing:

- Confirm customer phone number is valid.
- Confirm invoice number is official.
- Confirm totals and payment status are correct.
- Confirm logo, signature, bank details, UPI, QR, terms, and footer in Settings.

WhatsApp sharing saves the invoice PDF locally and opens the WhatsApp message flow.

### 7.7 Add Extra Product Or Service To Same Invoice

Use Add extra product/service when extra work must be added to the same invoice.

1. Open Billing > Invoices.
2. Select the invoice.
3. Click Add extra product/service.
4. Choose a service, retail item, or custom line.
5. Enter description, quantity, unit price, GST, and SAC code.
6. Click Add to same invoice.

What happens:

- Existing invoice lines stay locked.
- New line is appended.
- Grand total is recalculated.
- Paid amount is preserved.
- Balance due is recalculated.
- Stock is deducted for the new retail item or service consumables.

### 7.8 Cancel And Make New Bill

Use Mistake? Cancel & Make New Bill only when the original invoice should no longer count as active business.

1. Open Billing > Invoices.
2. Select invoice.
3. Click Mistake? Cancel & Make New Bill.
4. Enter cancellation reason.
5. Confirm cancel and open replacement draft.

What happens:

- Old invoice status becomes Cancelled.
- Cancelled invoice balance becomes zero.
- Cancelled invoice is excluded from active sales and profit revenue.
- Stock used by the cancelled invoice is restored when stock movements exist.
- A replacement draft opens for the corrected bill.

Do not cancel an invoice just for small customer spelling changes unless the business owner approves that process.

### 7.9 Temporary Or Pending Cloud Invoice

If an invoice was created temporarily while cloud numbering failed, official print, PDF, and WhatsApp may be locked. Use Move back to draft if shown, then finalize again after the cloud is available.

## 8. Quotations

Quotations are estimates shared before final billing.

Open Billing > New Quotation or Billing > Quotations.

Common workflow:

1. Enter customer and vehicle details.
2. Add services, retail items, or custom lines.
3. Apply discount if required.
4. Save quotation.
5. Set status such as Draft, Sent, Accepted, Rejected, or Expired.
6. Save PDF or share by WhatsApp.
7. Convert to invoice only after customer approval.

Important:

- Quotation is not an official invoice.
- Quotation does not create final invoice number.
- Stock is checked and deducted only when converted to invoice.
- Converted quotation links to the generated invoice.

## 9. Job Cards

Job cards track vehicle work from intake to delivery.

Open Billing > Job Cards.

Job cards can include:

- Customer and vehicle details
- Job date
- Expected delivery date and time
- Actual delivery date and time
- Odometer
- Fuel level
- Key received status
- Belongings notes
- Work items
- Checklist
- Photo proof
- Status timeline
- Delivery notes
- PDF and WhatsApp sharing
- Conversion to invoice

Common statuses:

- Draft
- Estimate Pending
- Approved
- In Progress
- Quality Check
- Ready Delivery
- Delivered
- Billed
- Cancelled

### 9.1 Create And Use A Job Card

1. Open Job Cards.
2. Create a new job card.
3. Enter customer and vehicle details.
4. Add intake and delivery details.
5. Add services or work items.
6. Save the job card.
7. Use checklist for inspection and quality steps.
8. Add photo proof, such as before, after, damage, work progress, or delivery photos.
9. Update status as work progresses.
10. Save PDF or send WhatsApp status if required.
11. Convert to bill after approval or completion.

Important:

- Billed job cards are locked for billing changes.
- Photos and checklist help avoid delivery disputes.
- Draft, estimate-pending, and cancelled job cards should not normally be converted to invoice.
- Converted job cards link to their invoice.

## 10. Customers And Vehicles

Open Billing > Customers & Vehicles.

Use this module to manage customer and vehicle history.

Customer details can include:

- Name
- Phone
- Email
- Address
- GSTIN

Vehicle details can include:

- Registration number
- Vehicle type
- Make
- Model
- Color
- Linked customer

Good practice:

- Keep phone numbers correct for WhatsApp sharing.
- Use one consistent vehicle registration number.
- Avoid duplicate customers.
- Add GSTIN before creating GST invoices for business customers.

## 11. Services And Packages

Open Billing > Services & Packages.

Use services for common work such as washing, detailing, polishing, coating, interior cleaning, add-ons, and labor/service charges.

Each service can store:

- Name
- Selling price
- GST rate
- SAC code
- Active or inactive status
- Consumable recipe

### 11.1 Consumable Recipes

A consumable recipe connects a service to stock usage.

Example:

```text
One foam wash uses 0.5 litre shampoo.
Invoice quantity is 3 foam washes.
Stock deduction is 1.5 litres shampoo.
```

Keep recipes updated so stock and profit reports are correct.

## 12. Customer Enquiries

Open Customer Enquiries.

Use enquiries for leads before they become real work.

Enquiry details can include:

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

Common enquiry areas:

- Follow-ups
- New Enquiry
- Open Enquiries
- Converted
- Lost

Use follow-up dates for pending calls and visits. Mark leads as converted when they become real customers or work. Mark as lost only when the customer is no longer expected to continue.

## 13. Stock Management

Open Stock Management.

Stock Management includes:

- Stock Overview
- Stock List
- Add Stock
- Purchase Records
- Remove Stock
- Suppliers
- Stock History
- Reports

### 13.1 Stock Overview

Use Stock Overview to check current stock value, low-stock items, expiring batches, retail count, consumable count, and recent movements.

### 13.2 Stock List

Use Stock List to manage inventory items.

Inventory item details can include:

- Name
- Type: retail or consumable
- Unit, such as bottle, litre, piece, packet
- Retail price, if sold directly
- GST rate
- Low-stock level
- Active status

Retail items can be sold directly on invoices or quick stock sale. Consumables are normally used by service recipes.

### 13.3 Add Stock

Use Add Stock when real stock quantity is purchased or received.

1. Select item.
2. Select supplier or enter new supplier.
3. Enter bill number.
4. Enter purchase date.
5. Enter quantity.
6. Enter unit cost.
7. Enter GST rate if required.
8. Enter expiry date if applicable.
9. Save purchase.

What happens:

- A purchase batch is created.
- Item quantity increases.
- Stock value increases.
- A stock purchase movement is recorded.

### 13.4 Purchase Records

Use Purchase Records to store supplier bill references and optional PDF/image documents.

Purchase records can store:

- Vendor or supplier
- Date
- Bill number
- Amount
- Payment mode
- Notes
- Attached document

Important:

- Purchase Records do not increase stock.
- Purchase Records do not create expenses.
- Purchase Records do not change profit.
- To increase stock, use Add Stock.
- To affect profit, enter an Expense in reports/profit area.

### 13.5 Remove Stock

Use Remove Stock for stock movement outside normal invoicing.

Reasons include:

- Used in studio
- Stock sold
- Damaged or wasted

Steps:

1. Open Remove Stock.
2. Select item.
3. Enter quantity.
4. Choose reason.
5. Enter reference and notes if required.
6. Click Remove stock or Record stock sale.

For Stock sold:

- Sale amount is shown and can be edited.
- Sale amount is prefilled from quantity times retail price.
- Payment mode is shown and defaults to Cash.
- The sale is recorded separately from GST invoice billing.
- It appears in stock movement and sales/reporting areas as quick stock sale data.

### 13.6 Suppliers

Use Suppliers to manage vendor names, phone numbers, GSTIN, and address.

Using supplier records keeps Add Stock and Purchase Records easier and cleaner.

### 13.7 Stock History

Stock History shows movements such as:

- Purchase
- Invoice sale
- Service usage
- Stock sale
- Used in studio
- Damaged or wasted
- Cancellation restore

Use stock history to understand why stock quantity changed.

### 13.8 Stock Reports

Stock reports help review consumables, retail products, low stock, expiring stock, movement value, and usage or damage.

Good practice:

- Add stock purchases before billing stock-linked work.
- Review low-stock alerts daily.
- Review expiring batches regularly.
- Avoid manual stock removal unless there is a real reason.

## 14. Reports, Profit, And Expenses

Open Reports.

Report tabs include:

- Full Business Summary
- Sales Report
- GST / Tax Report
- Payment & Dues
- Stock Report
- Enquiry Report
- Job Card Report
- Profit & Expense

Reports can be filtered by date range. Users with export permission can save PDFs and CSV files.

### 14.1 Full Business Summary

Use this for an overall view of business performance across billing, payments, dues, stock, enquiries, job cards, and profit.

### 14.2 Sales Report

Sales Report shows billed value, quick stock sales, total sales, collected amount, due amount, invoice count, payment modes, sales trend, and top services.

Important:

- Billed value uses invoice date.
- Collected amount uses payment date.
- Quick stock sales are separate from invoice billing.
- Cancelled invoices are excluded from active sales totals.

### 14.3 GST / Tax Report

GST / Tax Report shows taxable value, CGST, SGST, IGST, and total tax for non-cancelled GST invoices in the selected date range.

Use this report for accountant review. Always verify with the accountant before filing taxes.

### 14.4 Payment & Dues

Payment & Dues shows pending balances and payment mode collections.

Use it for:

- Due follow-up
- Collection review
- Cash/UPI/Card/Bank Transfer checks

### 14.5 Stock Report

Stock Report shows stock value, consumables, retail products, low-stock items, expiring batches, and movements.

### 14.6 Enquiry Report

Enquiry Report shows total leads, converted leads, lost leads, open leads, source split, status split, and conversion rate.

### 14.7 Job Card Report

Job Card Report shows open job cards, completed job cards, billed job cards, cancelled job cards, job-card revenue, and turnaround details.

### 14.8 Profit & Expense

Profit & Expense uses collected money, stock cost, and expenses.

It can show:

- Paid revenue
- Stock cost
- Expenses
- Cash profit
- Profit margin
- Expense categories
- Profit trend

Important:

- Profit uses payment date, not only invoice date.
- Stock cost comes from sale or usage movements.
- Expenses must be entered separately.
- Purchase Records are not expenses.

### 14.9 Report Exports And Daily Backup

Users with report export permission can:

- Save the current report as PDF.
- Export current report CSV.
- Export full bundle CSV.
- Generate daily report backup.
- Open daily report backup folder.

## 15. Settings

Open Settings. Visible tabs depend on permissions.

Settings tabs include:

- Business
- Invoice
- Job Cards
- Users & Roles
- Backup
- Cloud Status
- Exports

Only owners or trusted managers should change settings.

### 15.1 Business Settings

Use Business settings for:

- Business name
- Phone
- Address
- GSTIN
- Invoice prefix
- Default GST rate
- Default tax scope

Check these before the first real invoice.

### 15.2 Invoice Template Settings

Invoice settings include:

- Brand
- Layout
- Fields
- Payment
- Text
- Preview

Use these settings to manage:

- Logo
- Signature
- Watermark
- Font style
- Text size
- Invoice density
- Logo size
- Visible invoice fields
- Bank details
- UPI ID
- UPI QR
- Payment instructions
- Terms and footer text
- Invoice preview

After changing invoice settings, generate one test PDF and confirm the layout.

### 15.3 Job Card Settings

Use Job Cards settings to manage the default checklist copied into new job cards.

Keep checklist steps practical, such as intake inspection, cleaning stage, quality check, photo proof, and delivery confirmation.

### 15.4 Users & Roles

Use Users & Roles to create staff logins and control access.

Good practice:

- Create one login per staff member.
- Do not share the owner login.
- Disable old staff accounts.
- Give only the permissions needed for the person's work.
- Reset passwords quickly when needed.

Permission groups include:

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

### 15.5 Backup Settings

Use Backup settings for:

- Local backup
- Restore
- Google Drive backup
- Diagnostic export

Take a backup before app updates, restore, data import, or computer service.

### 15.6 Cloud Status

Use Cloud Status to manage cloud connection, sync, device status, pending devices, revoked devices, and sync conflicts.

Cloud status can show:

- Not connected
- Waiting for owner approval
- Device approved
- Device revoked
- Cloud unavailable
- Pending sync count
- Failed sync count
- Conflict count

### 15.7 Exports

Use Exports to download CSV data when available to the user role.

CSV exports are useful for accountant review, owner review, and support checks.

## 16. Cloud Sync

Cloud sync is optional, but useful for multi-PC operation and official shared invoice numbering.

Cloud sync can handle:

- Device registration
- Owner approval for new PCs
- Staff PC login after approval
- Shared business records
- Sync push and pull
- Sync conflicts
- Official cloud invoice numbering
- Cloud stock validation
- File upload records

### 16.1 First PC

For the main owner PC:

1. Open Settings > Cloud Status.
2. Enter Cloud API URL.
3. Enter device name.
4. Enter registration key.
5. Connect device.
6. Run Sync Now.

Depending on setup, the first owner PC may be approved during initial cloud setup.

### 16.2 Additional Staff PC

For another PC:

1. Install the app.
2. Choose Staff / Existing Business PC.
3. Enter Cloud API URL.
4. Enter unique device name.
5. Enter registration key.
6. Click Connect device.
7. Wait for owner approval.
8. Owner approves from an already approved owner PC.
9. Click Check approval on the staff PC.
10. Login with staff username and password.

Important:

- Registration key requests access only.
- It does not replace owner approval.
- Revoke unknown devices immediately.

### 16.3 Sync Now

Use Sync Now after connection returns or when you want to push and pull latest business records.

If sync fails, check:

- Internet connection
- Cloud API URL
- Device approval status
- Hosting/API health
- Registration key and owner approval

### 16.4 Cloud Unavailable

If cloud or internet is unavailable:

- The app should show a clear cloud unavailable or connection error.
- Some cloud-required screens may not load.
- Final cloud invoice numbering may be blocked.
- A bill may stay as draft until cloud returns.
- PDF, print, or WhatsApp may be locked for invoices without official cloud number.

When this happens:

1. Check internet.
2. Check Cloud API URL.
3. Try Sync Now.
4. Check Cloud Status.
5. Contact support if final invoice creation remains blocked.

### 16.5 Sync Conflicts

Sync conflicts can happen when the same record is changed from more than one device.

Only the owner or trusted manager should resolve conflicts.

Before resolving:

- Check which PC made each change.
- Compare customer, invoice, stock, or setting values carefully.
- Keep the correct business value.
- Contact support if unsure.

### 16.6 Cloud Safety Rules

- Use HTTPS Cloud URL in production.
- Keep registration key private.
- Revoke unknown or unused devices.
- Keep cloud server passwords private.
- Do not manually edit invoice numbers in the cloud database.
- Do not upload private backups to public links.

## 17. Backup, Restore, Google Drive, And Diagnostic Export

Backup protects business data. Cloud sync does not replace backup.

Backup can protect:

- Invoices
- Drafts
- Customers
- Vehicles
- Quotations
- Job cards
- Services
- Stock
- Suppliers
- Purchase records
- Expenses
- Reports data
- Settings
- Users and roles
- Invoice assets
- Job-card photos
- Purchase documents

### 17.1 Local Backup

Use local backup:

- Before app update
- Before restore
- Before data import
- Before Windows reinstall
- Before computer service
- At end of day

Store a copy outside the main computer whenever possible.

### 17.2 Google Drive Backup

If configured, Google Drive backup can upload backup files to a connected Google account.

Good practice:

- Use a business-controlled Google account.
- Confirm upload success.
- Periodically check that backup files can be found.

### 17.3 Restore

Restore replaces current app data with backup data.

Before restore:

1. Take a fresh safety backup of current data.
2. Confirm backup business name.
3. Confirm backup date and time.
4. Restore only from trusted files.

After restore:

- Reopen the app.
- Check invoices.
- Check customers and vehicles.
- Check settings.
- Check stock.
- Check users and roles.
- Check cloud status if cloud sync is used.

### 17.4 Diagnostic Export

Use diagnostic export only when support asks for it.

Diagnostic export may include sensitive business records. Share it only through a trusted channel. Do not share owner password, cloud server password, registration key, or private backup files unless support specifically requests them through a secure process.

## 18. Android Reports App

If the Android reports app is included, it is intended for owner/manager report viewing from mobile.

Important:

- Install only the standalone release APK provided in the handover.
- Do not use debug or dev-client APKs for customer installation.
- If login or reports do not load, check cloud API URL, internet, device/app configuration, and cloud server status.

## 19. Recommended Daily Workflow

### Morning

1. Open the app.
2. Login.
3. Check Overview.
4. Check pending follow-ups.
5. Check open job cards.
6. Check low-stock alerts.
7. Check cloud status if multi-PC sync is used.

### During Work

1. Add enquiries for new leads.
2. Create job cards for incoming vehicles.
3. Create quotations for estimates.
4. Convert accepted quotations or job cards to invoices.
5. Create direct bills when needed.
6. Record payments immediately.
7. Share PDF or WhatsApp only after checking totals.
8. Add stock purchases when items arrive.
9. Remove stock only for real usage, stock sale, damage, wastage, or correction.

### End Of Day

1. Check today's invoices.
2. Check payments collected.
3. Check pending dues.
4. Record expenses.
5. Review stock movements.
6. Review open job cards.
7. Review pending follow-ups.
8. Generate or check daily report backup.
9. Take backup.
10. Sync cloud if used.

## 20. Go-Live Checklist

Before real production use:

- Owner account created.
- Staff accounts created.
- Roles and permissions checked.
- Business profile checked.
- GSTIN checked if GST billing is used.
- Invoice prefix checked.
- Logo checked.
- Signature checked.
- Watermark checked if used.
- Bank details checked.
- UPI ID and QR checked.
- Invoice terms and footer checked.
- Invoice PDF preview checked.
- Services and prices checked.
- Service consumable recipes checked.
- Stock items created.
- Starting stock added.
- Suppliers added if needed.
- Test quotation created.
- Test job card created.
- Test invoice created.
- Test payment recorded.
- Test PDF saved.
- Test print checked.
- Test WhatsApp flow checked.
- Test report checked.
- Backup created and stored safely.
- Cloud sync tested if used.
- Additional PC approval tested if multi-PC is used.
- Android reports app tested if included.

## 21. Troubleshooting

### Cannot Login

Check:

- Username
- Password or PIN
- User is active
- Correct role assigned

If owner password is lost, contact technical support.

### Menu Option Is Missing

The user role may not have permission. Ask the owner to check Settings > Users & Roles.

### Invoice Cannot Be Finalized

Possible reasons:

- Customer name is missing.
- Vehicle number is missing.
- No item was added.
- Discount is greater than subtotal.
- Paid amount is greater than grand total.
- Stock is not available.
- Service recipe uses consumable stock that is not available.
- Cloud is required for official invoice numbering but is unavailable.

### PDF, Print, Or WhatsApp Is Locked

Possible reasons:

- Invoice has no official cloud number yet.
- Invoice is cancelled.
- User does not have PDF/print permission.
- User does not have WhatsApp permission.
- Customer phone number is missing or invalid.

### Stock Is Wrong

Check:

- Stock purchases were entered correctly.
- Purchase Records were not mistaken for stock purchases.
- Service recipes are correct.
- Manual Remove Stock entries are correct.
- Cancelled invoice restored stock as expected.
- Stock History explains each movement.

### Reports Do Not Match Cash In Hand

Remember:

- Sales billed value uses invoice date.
- Collected amount uses payment date.
- Profit uses collected payments, stock cost, and expenses.
- Cancelled invoices are excluded from active revenue.
- Purchase Records are not expenses.
- Quick stock sales are separate from GST invoice billing.

### Cloud Device Is Pending

This is normal for additional PCs. The owner must approve the device from an already approved owner PC.

### Cloud Unavailable

Check:

- Internet connection
- Cloud API URL
- Hosting/API status
- Device approval
- Sync status

Try Sync Now after the connection returns.

### Restore Shows Old Data

Check:

- Backup file date
- Business name in backup
- Last invoice number
- Recent invoices
- Recent stock entries
- Recent customers

Restore again only after confirming the correct backup.

## 22. Information To Share With Support

When asking for support, share:

- App version
- Windows version
- Screenshot of the problem
- Exact error message
- Which button was clicked
- Invoice number, quotation number, job-card number, or customer name if relevant
- Whether cloud sync is enabled
- Whether internet is working
- Last backup date and time
- Whether the issue happens for one record or all records

Do not share:

- Owner password
- Staff password
- Cloud server password
- Registration key
- Private backup files through unsafe channels

## 23. Important Business Rules

- Final invoice numbers should not be manually edited.
- Drafts are editable; final invoices are locked for billing history.
- Add-on work should be appended to the same invoice when that is the business decision.
- Cancelled invoices are excluded from active sales, dues, and profit revenue.
- Cancelled invoices can restore stock when stock movement history exists.
- Stock purchase increases inventory.
- Purchase Records are only supplier document references.
- Expenses must be entered separately for profit.
- Retail invoice sale and service consumable recipes reduce stock.
- Quick stock sale is separate from GST invoice billing.
- Profit uses collected payments, stock cost, and expenses.
- Backup before restore.
- Keep owner login private.
- Use HTTPS for production cloud URL.
- Revoke unknown cloud devices.
- Use the standalone Android APK for customer installation.

## 24. Glossary

| Term | Meaning |
| --- | --- |
| Invoice | Official bill given to the customer |
| Draft bill | Editable bill before final invoice number is issued |
| Final invoice | Locked official invoice with invoice number |
| GST invoice | Invoice with GST tax details |
| Simple receipt | Non-GST bill or receipt |
| Quotation | Estimate shared before billing |
| Job card | Work tracking record for a vehicle service |
| Customer | Person or business receiving service |
| Vehicle | Customer vehicle linked to work and billing |
| Service | Reusable billing item such as wash, detailing, polish, or labor |
| Consumable recipe | Stock usage rule linked to a service |
| Retail item | Stock item sold directly to customer |
| Stock purchase | Entry that increases inventory quantity |
| Purchase record | Supplier bill reference that does not change stock or profit |
| Expense | Business cost used in profit calculation |
| Stock movement | History entry showing stock increase, decrease, sale, usage, damage, or restore |
| Quick stock sale | Direct cash sale from stock without creating GST invoice |
| Payment mode | Cash, UPI, Card, Bank Transfer, or Other |
| Due | Unpaid balance on an invoice |
| Cloud sync | Optional multi-PC record sync and cloud invoice numbering |
| Device approval | Owner approval required for another PC to access the cloud business |
| Backup | Copy of app data used for safety and restore |
| Diagnostic export | Support package generated when troubleshooting |

## 25. Related Documents

- [QUICK_START_GUIDE.md](QUICK_START_GUIDE.md): first-day setup guide.
- [CUSTOMER_DOCUMENTATION.md](CUSTOMER_DOCUMENTATION.md): non-technical customer-facing guide.
- [WIREFLOW_DIAGRAM.md](WIREFLOW_DIAGRAM.md): visual module, workflow, stock, cloud, backup, and reporting connection map.
- [BILLING_CALCULATIONS.md](BILLING_CALCULATIONS.md): detailed formulas for invoice, GST, stock, reports, and profit.
- [MOBILE_REPORTS_APP.md](MOBILE_REPORTS_APP.md): Android reports app guide, if mobile app is included.
- [../cloud-api/README.md](../cloud-api/README.md): cloud API setup guide for hosting and deployment.
