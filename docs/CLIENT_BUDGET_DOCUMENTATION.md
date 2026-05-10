# Autocare24 Billing Software Budget Documentation

Document date: 10 May 2026  
Prepared for: Client / Business Owner  
Prepared by: Software Developer / Implementation Team  
Project: Windows Billing Software, Cloud Sync API, and Android Owner Reports App  
Currency: INR  
Tax note: GST/taxes are extra if applicable.

## 1. Purpose

This document explains the estimated budget for delivering the complete billing software package to a client. It can be used as a quotation, project budget, approval note, or commercial handover document.

The budget covers software development value, deployment, documentation, training, optional cloud hosting, mobile app setup, support, and future maintenance.

## 2. Project Summary

The software is a production-ready billing and business management system for a vehicle detailing, service, or similar billing business.

The system includes:

- Windows desktop billing application
- Customer and vehicle management
- GST invoice and simple invoice billing
- Invoice drafts, final invoices, corrections, add-ons, cancellations, and payments
- PDF, print, and WhatsApp sharing support
- Quotations and quotation-to-invoice conversion
- Job cards with checklist, status tracking, photo proof, and invoice conversion
- Service and package setup
- Inventory, suppliers, purchases, stock batches, stock movement, low-stock tracking, and purchase documents
- Enquiries and follow-up management
- Sales, GST, dues, stock, enquiry, job-card, payment, profit, and expense reports
- Local backup, restore, Google Drive backup, and diagnostic export
- Owner/staff login, roles, and permission control
- Optional cloud sync API for multi-device/cloud operation
- Optional Android owner reports app
- Customer documentation, quick-start guide, training checklist, and calculation documentation

## 3. Delivery Scope

### 3.1 Windows Desktop Application

The Windows application is the main software used by the business for daily billing and operations.

Included modules:

- Dashboard
- New bill and invoice management
- Draft invoices and final invoices
- Invoice correction, add-on item flow, payment recording, and cancellation
- Customer and vehicle records
- Quotations
- Job cards
- Services and packages
- Enquiries and follow-ups
- Stock and inventory
- Purchase records and documents
- Reports and profit
- Settings and invoice template configuration
- User management and access roles
- Backup and restore
- Google Drive backup
- Developer diagnostics and repair tools, owner-only

### 3.2 Cloud API And Sync

The cloud API allows approved devices to share business records through a hosted MySQL/MariaDB database.

Included cloud features:

- Device registration
- Owner approval for devices
- Token-based device access
- Cloud record storage
- Sync revision tracking
- Official cloud invoice numbering
- Stock validation during cloud final billing
- File metadata support
- Conflict and audit tracking
- Rate-limit and security configuration through environment variables

### 3.3 Android Owner Reports App

The Android app is for owner-level business visibility, not daily invoice creation.

Included mobile features:

- Cloud device registration
- Pending, approved, and revoked status display
- Owner login after device approval
- Reports dashboard
- Profit data
- Invoice list and invoice detail view
- Inventory dashboard
- Cloud device list
- Approve or revoke other devices
- Android sharing for invoice summary
- HTTPS and TLS public-key pinning support for production builds

### 3.4 Documentation And Training

Included documentation:

- Customer documentation
- Quick-start guide
- Training checklist
- Billing calculation guide
- Simple calculation guide
- Mobile reports app guide
- Cloud API setup reference
- Budget documentation

Included training:

- Owner training
- Billing staff training
- Stock staff training
- Reports and profit training
- Backup and restore training
- Cloud sync training, if cloud is enabled
- Android app training, if mobile app is included

## 4. One-Time Project Budget

The following budget is for one business installation with one Windows desktop app package, optional cloud API setup, and optional Android owner reports app.

| No. | Work Item | Description | Amount |
| --- | --- | --- | ---: |
| 1 | Requirement analysis and project planning | Business flow understanding, module planning, invoice rules, reports, and setup checklist | INR 15,000 |
| 2 | Windows desktop application core | Electron desktop app, local database, navigation, dashboard, app shell, settings foundation | INR 45,000 |
| 3 | Billing and invoice module | GST/simple invoices, drafts, final invoices, payments, cancellations, corrections, add-ons, PDF/print/share flow | INR 65,000 |
| 4 | Customer, vehicle, services, and quotation module | Customer records, vehicle records, service setup, package setup, quotations, quotation conversion | INR 40,000 |
| 5 | Job-card and enquiry module | Job cards, checklist, status tracking, photo proof, enquiries, follow-ups, conversion workflows | INR 40,000 |
| 6 | Inventory and purchase module | Stock items, suppliers, purchase batches, stock movements, low stock, purchase documents | INR 45,000 |
| 7 | Reports, GST, dues, profit, and expense module | Sales, GST, dues, stock, enquiry, job-card, payment, profit, and expense reports | INR 45,000 |
| 8 | User roles and security controls | Owner/staff login, access roles, permissions, protected tools, security hardening | INR 30,000 |
| 9 | Backup, restore, Google Drive backup, diagnostics | Local backup, restore, Drive backup, repair tools, log/diagnostic export | INR 35,000 |
| 10 | Cloud sync API and database setup | Node.js API, MySQL/MariaDB schema, device approval, sync records, invoice numbering, deployment support | INR 75,000 |
| 11 | Android owner reports app | Expo Android app for reports, invoices, profit, inventory, and device approvals | INR 60,000 |
| 12 | Testing and quality assurance | Invoice calculation testing, stock validation, reports testing, build checks, packaging validation | INR 35,000 |
| 13 | Documentation and client training | Customer guide, quick-start guide, calculation guide, training checklist, handover support | INR 25,000 |
| 14 | Installation and handover | Windows installer handover, first setup support, sample data check, backup check, cloud/mobile setup if applicable | INR 25,000 |

Subtotal: INR 580,000  
Project discount / negotiated adjustment: INR 80,000  
Recommended client price: INR 500,000  
GST/taxes, if applicable: Extra  
Final payable amount: INR 500,000 plus applicable taxes

## 5. Package Options

Use one of these packages depending on the client requirement.

| Package | Includes | One-Time Price |
| --- | --- | ---: |
| Basic Desktop Package | Windows app, billing, customers, services, invoices, payments, PDF/print, basic reports, backup, setup, basic training | INR 250,000 |
| Professional Package | Basic package plus quotations, job cards, stock, expenses, profit, advanced reports, users/roles, Google Drive backup, full training | INR 380,000 |
| Complete Cloud Package | Professional package plus cloud API, multi-device approval, cloud invoice numbering, Android owner reports app, cloud/mobile setup | INR 500,000 |

Recommended package for complete client delivery: Complete Cloud Package.

## 6. Recurring Monthly Costs

These are operational costs after handover. They may be paid directly by the client or included in a monthly support plan.

| Item | Description | Estimated Monthly Cost |
| --- | --- | ---: |
| Cloud server/VPS | Hosting for cloud API | INR 800 to INR 3,000 |
| Managed database or MySQL hosting | MySQL/MariaDB database, if separate from server | INR 500 to INR 2,500 |
| Domain name | Domain renewal, billed yearly; monthly equivalent shown | INR 100 to INR 300 |
| SSL certificate | Usually free with Let's Encrypt; paid certificate optional | INR 0 to INR 1,000 |
| Cloud backup/storage | File uploads, backups, storage expansion | INR 200 to INR 1,500 |
| SMS/WhatsApp paid API | Only if official paid API is added later | As per provider |
| Google Drive storage | Only if backup storage exceeds free plan | As per Google plan |

Estimated normal monthly infrastructure cost: INR 1,500 to INR 7,000.

## 7. Annual Maintenance And Support

Maintenance is recommended because billing software contains business-critical data.

### 7.1 Free Support Period

The project includes 30 days of free support after final handover.

Free support includes:

- Installation support
- Minor bug fixes
- Basic usage support
- First backup/restore guidance
- First cloud/mobile connection support, if included

Free support does not include new modules, major design changes, new third-party integrations, or business rule changes after approval.

### 7.2 Paid Maintenance Plans

| Plan | Includes | Price |
| --- | --- | ---: |
| Basic Support | Bug fixes, remote support, minor guidance, up to 4 support hours/month | INR 8,000 per month |
| Standard Support | Basic support plus monthly health check, backup check, update assistance, up to 8 support hours/month | INR 15,000 per month |
| Priority Support | Standard support plus priority response, cloud monitoring support, up to 15 support hours/month | INR 25,000 per month |

Recommended maintenance: Standard Support.

Annual maintenance contract option: INR 150,000 per year.

## 8. Payment Schedule

Recommended payment schedule for complete delivery:

| Stage | Milestone | Payment |
| --- | --- | ---: |
| 1 | Project confirmation and booking | 30% |
| 2 | Windows desktop app demo and core billing approval | 30% |
| 3 | Cloud/mobile setup and full module verification | 25% |
| 4 | Final installer, documentation, training, and handover | 15% |

For recommended client price of INR 500,000:

| Stage | Amount |
| --- | ---: |
| Project confirmation | INR 150,000 |
| Core billing approval | INR 150,000 |
| Cloud/mobile verification | INR 125,000 |
| Final handover | INR 75,000 |

## 9. Delivery Timeline

For an already-built and verified product, client deployment can usually be completed quickly.

| Work | Estimated Time |
| --- | ---: |
| Client branding and business settings | 1 to 2 days |
| Windows installation and sample billing test | 1 day |
| Service/stock/customer starter data setup | 1 to 3 days |
| Cloud API deployment, if required | 1 to 2 days |
| Android app build/install, if required | 1 to 2 days |
| Client training and handover | 1 to 2 days |

Estimated deployment time: 5 to 10 working days after receiving all required business data, credentials, and approvals.

## 10. Client Inputs Required

The client must provide:

- Business name
- Business address
- Phone number
- Email address
- GSTIN, if applicable
- Invoice prefix
- Logo image
- Signature image
- UPI ID and UPI QR image
- Bank details
- Invoice terms and footer text
- Service list and prices
- GST rates for services/items
- Initial stock list, if stock is used
- Staff names and roles
- Cloud domain/server details, if cloud is enabled
- Google account for Drive backup, if Drive backup is enabled
- Android phone details for owner reports app setup, if included

## 11. Exclusions

The following are not included unless separately agreed:

- Hardware purchase, such as computer, printer, barcode scanner, or mobile phone
- Printer repair or printer driver troubleshooting outside basic setup
- Paid domain, hosting, SSL, SMS, WhatsApp API, Google storage, or third-party subscriptions
- Data entry of large historical records unless quoted separately
- Migrating old software data unless source data is provided in usable format and separately estimated
- Custom government filing integration
- Payment gateway integration
- Official WhatsApp Business API integration
- iOS App Store release
- Multi-branch accounting consolidation beyond the agreed cloud sync scope
- Custom accounting software integration such as Tally, Zoho, or QuickBooks

## 12. Optional Add-Ons

| Add-On | Description | Estimated Price |
| --- | --- | ---: |
| Historical data migration | Import customers, invoices, stock, or old records from Excel/CSV | INR 15,000 to INR 75,000 |
| Barcode billing | Barcode scan flow, labels, item lookup, printer setup | INR 25,000 to INR 75,000 |
| Tally/Zoho export | Accounting export format and mapping | INR 35,000 to INR 100,000 |
| Official WhatsApp API | Template messages, provider setup, API integration | INR 50,000 to INR 150,000 plus provider charges |
| Payment gateway | Razorpay/Stripe/payment link integration | INR 40,000 to INR 125,000 plus gateway charges |
| Multi-branch dashboard | Branch-wise reports and consolidated owner view | INR 75,000 to INR 250,000 |
| Custom mobile staff app | Staff billing/job-card app, separate from owner reports app | INR 150,000 to INR 400,000 |
| Web admin panel | Browser-based admin dashboard | INR 150,000 to INR 500,000 |

## 13. Handover Deliverables

At final delivery, the client receives:

- Windows installer file
- Installed and configured software on the agreed machine
- Owner account setup
- Staff role setup, if staff details are provided
- Business profile setup
- Invoice template setup
- Test invoice verification
- Test quotation verification
- Test job-card verification
- Test stock flow verification, if stock is used
- Backup verification
- Cloud API setup, if included
- Android app setup, if included
- Customer documentation
- Quick-start guide
- Training checklist
- Calculation documentation
- Basic support instructions

## 14. Warranty And Support Terms

The delivery includes a 30-day correction period for defects found in the agreed scope.

Covered during warranty:

- Calculation bugs
- Billing flow bugs
- Installation issues caused by the software package
- Report mismatch caused by software logic
- Cloud/mobile connection issue caused by delivered configuration

Not covered during warranty:

- Incorrect data entered by staff
- Deleted local files or backups
- Windows corruption or hardware failure
- Cloud server downtime from hosting provider
- Lost passwords
- Third-party service outage
- New feature requests
- Changed business rules after sign-off

## 15. Commercial Assumptions

This budget assumes:

- One business brand per installation/cloud API instance
- One primary Windows billing installation
- Cloud sync only if the Complete Cloud Package is selected
- Android app is owner reports only, not staff billing
- Client provides correct business data before deployment
- Client provides hosting/domain credentials if cloud is required
- Client approves final invoice and report formats before final handover
- Any major business flow change after sign-off is charged separately

## 16. Client Approval

Client name: ________________________________

Business name: ______________________________

Selected package: ___________________________

Final approved amount: INR ___________________

GST/tax applicable: Yes / No

Advance received: INR ________________________

Expected handover date: ______________________

Client signature: ____________________________

Developer signature: _________________________

Date: ________________________________________

## 17. Recommended Quote Summary

Recommended complete delivery amount: INR 500,000 plus applicable taxes.

Recommended support after handover: INR 15,000 per month or INR 150,000 per year.

Estimated monthly hosting/infrastructure: INR 1,500 to INR 7,000, depending on server, database, storage, and provider choices.

This quote is valid for 30 days from the document date.
