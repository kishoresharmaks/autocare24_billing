# Autocare24 Billing Quick Start Guide

This guide helps a new customer start using Autocare24 Billing safely on the first day.

## 1. Before You Start

Keep these ready:

- Windows computer where the billing app will be installed
- Business name, address, phone number, and GSTIN if applicable
- Invoice prefix to use, such as `INV` or `AUTOCARE24`
- Business logo, signature image, and UPI QR image if available
- Owner username and password to create during setup
- Staff names and roles
- Current service price list
- Current stock list, if stock tracking will be used
- Cloud URL and registration key, only if cloud sync is enabled

## 2. Install The Windows App

1. Run the provided installer:

```text
Autocare24 Billing Setup 0.1.12.exe
```

2. Complete the installation wizard.
3. Open Autocare24 Billing from the desktop shortcut or Start Menu.
4. If Windows shows a security prompt, allow the application only if the installer came from the trusted project handover.

## 3. Create The Owner Account

On first launch:

1. Enter owner display name.
2. Enter owner username.
3. Enter a strong password.
4. Save the account.

Important:

- Do not share the owner password with staff.
- Owner account controls settings, users, roles, backup, restore, and cloud approvals.
- Create separate staff accounts for daily work.

## 4. Configure Business Details

Open Settings and update:

- Business name
- Phone number
- Address
- GSTIN
- Invoice prefix
- Logo
- Signature
- Watermark, if required
- Bank details
- UPI ID and QR
- Invoice footer and terms

After saving settings, create one test PDF to confirm the invoice design is correct.

## 5. Create Staff Users

Open Settings > Users and Roles.

Recommended first roles:

- Owner: full access
- Billing Staff: billing, customers, quotations, job cards, print/PDF, WhatsApp
- Stock Staff: stock items, purchases, adjustments, suppliers
- Staff Operations: billing, enquiries, services, stock operations, and job cards

For each staff member:

1. Create a separate login.
2. Assign the correct role.
3. Set an initial password.
4. Ask the staff member to change it if required.

## 6. Add Services

Open Services.

Add common services such as:

- Foam wash
- Detailing package
- Ceramic coating
- Interior cleaning
- Polish work
- Add-on labor/service charges

For each service, check:

- Name
- Selling price
- GST rate
- SAC code
- Active status
- Consumable recipe, if stock should reduce automatically

## 7. Add Starting Stock

Open Stock.

For every tracked stock item:

1. Add inventory item.
2. Set item type: retail or consumable.
3. Set unit, such as bottle, litre, piece, or packet.
4. Set low-stock level if needed.
5. Add purchase batch with quantity and unit cost.

Important:

- Stock Purchase increases inventory.
- Purchase Record only stores supplier document reference.
- Expense must be entered separately in Expenses if it should affect profit.

## 8. Create First Test Bill

Open New Bill.

1. Enter customer name.
2. Enter phone number.
3. Enter vehicle number.
4. Select invoice mode: GST or Simple.
5. Add one or more items.
6. Check quantity, price, discount, tax, and grand total.
7. Enter paid amount if payment is received.
8. Save or finalize.
9. Generate PDF.
10. Confirm printed layout.

Do this with a test customer first so the owner can confirm settings and layout.

## 9. Record First Payment

Open Invoices.

1. Select an invoice.
2. Record payment.
3. Enter amount.
4. Select mode: Cash, UPI, Card, Bank Transfer, or Other.
5. Enter payment reference if available.
6. Save.

Confirm that:

- Paid amount increased.
- Balance due reduced.
- Payment status changed correctly.

## 10. Create First Quotation

Open Quotations.

1. Create quotation with customer and vehicle details.
2. Add services/items.
3. Save as draft or sent.
4. Generate PDF.
5. Share through WhatsApp if needed.
6. Convert to invoice only when customer approves.

## 11. Create First Job Card

Open Job Cards.

1. Create job card for a customer vehicle.
2. Add expected delivery date/time.
3. Add work items.
4. Use checklist.
5. Add photos if needed.
6. Move status as work progresses.
7. Convert to invoice after approval or completion.

## 12. Connect Cloud Sync, If Used

Open Settings > Cloud Sync.

1. Enter Cloud URL.
2. Enter device name, such as `Office PC 1`.
3. Enter registration key.
4. Connect device.
5. Run Sync Now.

For additional PCs:

1. Install and open the app.
2. Select **Staff / Existing Business PC** on the first-run screen.
3. Enter Cloud URL, unique device name, and registration key.
4. Wait for pending approval.
5. Owner approves from an already approved PC.
6. Click **Check approval**, then login with the staff account.

Important:

- Use HTTPS Cloud URL in production.
- Do not share the registration key publicly.
- Revoke unknown devices.

## 13. Take First Backup

Open Settings > Backup.

1. Create local backup.
2. Save a copy outside the billing computer.
3. If Google Drive backup is configured, upload backup there also.
4. Note the backup date and time.

Before real billing starts, confirm that at least one backup exists.

## 14. End-Of-Day Routine

Every day:

- Check today's invoices.
- Check collected payments.
- Check pending dues.
- Record expenses.
- Check low stock.
- Review open job cards.
- Review pending enquiries and follow-ups.
- Run backup.
- Sync cloud, if enabled.

## 15. First-Day Success Checklist

- App installed.
- Owner account created.
- Business settings saved.
- Logo/signature/UPI checked.
- Staff users created.
- Services added.
- Starting stock added, if required.
- Test bill created.
- Test PDF checked.
- Test payment recorded.
- Test quotation created.
- Test job card created.
- Backup completed.
- Cloud sync connected, if required.
