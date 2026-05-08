# Simple Calculation Guide

This file explains how Autocare24 calculates invoice totals, GST, payments, stock, reports, and profit in simple words.

Use this guide for staff training or owner review. For the full mathematical formula sheet, see `BILLING_CALCULATIONS.md`.

## 1. Basic Rule

All money values are rounded to 2 decimal places.

Example:

```text
Rs. 100.456 becomes Rs. 100.46
Rs. 100.454 becomes Rs. 100.45
```

## 2. Item Amount

Each invoice item is calculated like this:

```text
Item amount = Quantity x Unit price
```

Example:

```text
Interior cleaning
Quantity: 2
Price: Rs. 500

Item amount = 2 x 500 = Rs. 1,000
```

## 3. Invoice Subtotal

Subtotal is the total of all item amounts before discount and GST.

Example:

```text
Interior cleaning = Rs. 1,000
Polish = Rs. 500

Subtotal = Rs. 1,500
```

## 4. Discount

Discount is reduced from the subtotal before GST is calculated.

```text
Amount after discount = Subtotal - Discount
```

Example:

```text
Subtotal = Rs. 1,500
Discount = Rs. 100

Amount after discount = Rs. 1,400
```

Important:

- Discount cannot be negative.
- Discount cannot be more than the subtotal.
- The app internally shares the discount across all items so item totals and final invoice total match correctly.

## 5. Simple Invoice Calculation

A simple invoice does not calculate GST.

```text
Grand total = Subtotal - Discount
```

Example:

```text
Subtotal = Rs. 1,500
Discount = Rs. 100
GST = Rs. 0

Grand total = Rs. 1,400
```

## 6. GST Invoice Calculation

For a GST invoice, GST is calculated after discount.

```text
Taxable amount = Subtotal - Discount
GST amount = Taxable amount x GST rate
Grand total = Taxable amount + GST amount
```

Example with 18 percent GST:

```text
Subtotal = Rs. 1,500
Discount = Rs. 100

Taxable amount = Rs. 1,400
GST = 18 percent of Rs. 1,400 = Rs. 252

Grand total = Rs. 1,400 + Rs. 252 = Rs. 1,652
```

If different items have different GST rates, each item tax is calculated separately and then added together.

## 7. CGST, SGST, and IGST

For GST invoices, the app follows the selected tax type.

### Intra-state

Use this when CGST and SGST are required.

```text
Total GST = CGST + SGST
CGST = half of total GST
SGST = remaining half of total GST
IGST = Rs. 0
```

Example:

```text
Total GST = Rs. 252
CGST = Rs. 126
SGST = Rs. 126
IGST = Rs. 0
```

### Inter-state

Use this when IGST is required.

```text
CGST = Rs. 0
SGST = Rs. 0
IGST = Total GST
```

Example:

```text
Total GST = Rs. 252
IGST = Rs. 252
```

## 8. Paid Amount and Balance Due

Paid amount is the amount received from the customer.

```text
Balance due = Grand total - Paid amount
```

Example:

```text
Grand total = Rs. 1,652
Paid amount = Rs. 1,000

Balance due = Rs. 652
```

Payment status:

```text
Paid amount is Rs. 0          -> Unpaid
Paid amount is less than total -> Partial
Paid amount equals total       -> Paid
```

Important:

- Paid amount cannot be more than the grand total.
- Later payments reduce the balance due.
- A payment cannot be more than the current balance due.

## 9. Adding Extra Item to Existing Invoice

When an extra item is added to the same invoice:

- The new item is added to the invoice.
- The old discount remains the same.
- The old paid amount remains the same.
- Grand total is recalculated.
- Balance due is recalculated.
- Stock is deducted for the newly added item if it uses stock.

Example:

```text
Old grand total = Rs. 1,652
Old paid amount = Rs. 1,000

Extra item total = Rs. 300
New grand total = Rs. 1,952

New balance due = Rs. 1,952 - Rs. 1,000 = Rs. 952
```

## 10. Cancelling an Invoice

When an invoice is cancelled:

- The invoice status becomes Cancelled.
- Balance due becomes Rs. 0.
- Stock deducted for that invoice is restored.
- The cancelled invoice is not counted in active sales, dues, GST, or profit reports.

Cancellation does not delete the invoice. It keeps the record for history and audit.

## 11. Stock Calculation

Stock purchases add quantity.

```text
Stock added = Purchase quantity
Stock value = Quantity remaining x Purchase unit cost
```

When an invoice uses a stock item:

- Stock is deducted from available batches.
- The app prefers batches with earlier expiry dates first.
- Stock cost for profit uses the purchase unit cost, not the selling price.

Example:

```text
Item sold: 2 bottles
Purchase cost per bottle: Rs. 80

Stock cost = 2 x 80 = Rs. 160
```

Supplier purchase records with attached bills are reference documents only. They do not change stock or profit unless stock purchase or expense entries are also created.

## 12. Sales Report

Sales report uses invoice date.

It counts only non-cancelled invoices.

```text
Sales revenue = Total of grand totals from non-cancelled invoices in the selected date range
Balance due = Total of pending balances from non-cancelled invoices
```

Example:

```text
Invoice 1 total = Rs. 1,652
Invoice 2 total = Rs. 2,000

Sales revenue = Rs. 3,652
```

## 13. Payment Report

Payment report uses payment date.

This means:

- If invoice is created today but paid tomorrow, payment appears tomorrow.
- Paid revenue is based on money received, not only invoice created.

Example:

```text
Invoice date = 10 May
Payment date = 11 May

Sales report shows invoice on 10 May.
Payment/profit revenue shows payment on 11 May.
```

## 14. GST Report

GST report uses invoice date and non-cancelled invoices.

It totals:

- Taxable value
- CGST
- SGST
- IGST
- Total tax

Cancelled invoices are not included.

## 15. Profit Calculation

Profit report is cash based.

```text
Cash profit = Paid revenue - Stock cost - Expenses
```

Example:

```text
Paid revenue = Rs. 5,000
Stock cost = Rs. 1,200
Expenses = Rs. 800

Cash profit = Rs. 5,000 - Rs. 1,200 - Rs. 800
Cash profit = Rs. 3,000
```

Profit margin:

```text
Profit margin = Cash profit / Paid revenue x 100
```

Example:

```text
Cash profit = Rs. 3,000
Paid revenue = Rs. 5,000

Profit margin = 60 percent
```

Important:

- Expenses affect profit only when entered in Expenses.
- Stock cost affects profit when stock is consumed or sold through invoices.
- Cancelled invoices are excluded from profit revenue.

## 16. Quotations and Job Cards

Quotations are estimates until converted to invoices.

Job cards are service work records until converted to invoices.

They affect sales, GST, dues, and profit only after invoice conversion.

## 17. Dashboard Numbers

Dashboard shows quick business totals.

Common dashboard calculations:

```text
Today revenue = Payments received today
Month revenue = Payments received this month
Pending dues = Balance due from non-cancelled invoices
Today invoices = Non-cancelled invoices created today
```

## 18. Quick Example

Customer invoice:

```text
Ceramic wash: 1 x Rs. 1,000 = Rs. 1,000
Interior cleaning: 1 x Rs. 500 = Rs. 500

Subtotal = Rs. 1,500
Discount = Rs. 100
Taxable amount = Rs. 1,400
GST 18 percent = Rs. 252

Grand total = Rs. 1,652
Paid amount = Rs. 1,000
Balance due = Rs. 652
Payment status = Partial
```

If it is intra-state GST:

```text
CGST = Rs. 126
SGST = Rs. 126
IGST = Rs. 0
```

If it is simple invoice:

```text
GST = Rs. 0
Grand total = Rs. 1,400
```

## 19. Simple Staff Checklist

Before finalizing an invoice, check:

1. Customer name is correct.
2. Vehicle number is correct.
3. Item quantity and unit price are correct.
4. GST or Simple mode is selected correctly.
5. GST rate is correct for each item if using GST.
6. Discount is correct.
7. Paid amount is correct.
8. Payment mode and reference are correct.
9. Balance due is acceptable.
10. Invoice preview total matches the customer amount.
