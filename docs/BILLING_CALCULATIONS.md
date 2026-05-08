# Autocare24 Mathematical Billing Formula Sheet

This document explains the actual mathematical calculations used for invoices, payments, stock, reports, GST, and profit.

It is written as formulas, not as programming logic.

## 1. Notation

```text
R(x) = round x to 2 decimal places
SUM(...) = sum of all matching values
COUNT(...) = number of matching records
MIN(a, b) = smaller value
MAX(a, b) = larger value
```

For an invoice with `n` items:

```text
i = item number, from 1 to n
q_i = quantity of item i
p_i = unit price of item i
g_i = GST rate percentage of item i
s_i = subtotal of item i before discount and tax
D = invoice discount
B = taxable base after discount
t_i = tax amount of item i
l_i = final line total of item i
T = total tax
G = grand total
P = paid amount
U = unpaid balance / due amount
```

## 2. Money Rounding

Every money value is rounded to 2 decimal places:

```text
R(x) = round(x * 100) / 100
```

Examples:

```text
R(100.456) = 100.46
R(100.454) = 100.45
R(0.005) = 0.01
```

## 3. Item Subtotal

For each item:

```text
s_i = R(q_i * p_i)
```

Invoice subtotal:

```text
S = R(s_1 + s_2 + ... + s_n)
```

Example:

```text
Item 1: q_1 = 2, p_1 = 100
s_1 = R(2 * 100) = 200

Item 2: q_2 = 1, p_2 = 50
s_2 = R(1 * 50) = 50

S = R(200 + 50) = 250
```

## 4. Discount

Discount must satisfy:

```text
0 <= D <= S
```

Taxable base after discount:

```text
B = R(S - D)
```

Example:

```text
S = 250
D = 25
B = R(250 - 25) = 225
```

## 5. Proportional Discount Allocation

Discount is distributed across invoice items by each item's share of subtotal.

For each item:

```text
itemShare_i = s_i / S
discountedBase_i ~= B * itemShare_i
```

Because money must be exact to 2 decimals, final item taxable bases are adjusted by cents so:

```text
discountedBase_1 + discountedBase_2 + ... + discountedBase_n = B
```

This prevents one-paise rounding mismatches between line totals and invoice total.

Example:

```text
S = 250
B = 225

Item 1 share = 200 / 250 = 0.80
discountedBase_1 = 225 * 0.80 = 180

Item 2 share = 50 / 250 = 0.20
discountedBase_2 = 225 * 0.20 = 45

180 + 45 = 225
```

## 6. GST Invoice Tax

For GST invoices:

```text
t_i = R(discountedBase_i * g_i / 100)
l_i = R(discountedBase_i + t_i)
```

Total tax:

```text
T = R(t_1 + t_2 + ... + t_n)
```

Grand total:

```text
G = R(B + T)
```

Required equality:

```text
l_1 + l_2 + ... + l_n = G
```

Example with 18% GST:

```text
discountedBase_1 = 180
g_1 = 18
t_1 = R(180 * 18 / 100) = 32.40
l_1 = R(180 + 32.40) = 212.40

discountedBase_2 = 45
g_2 = 18
t_2 = R(45 * 18 / 100) = 8.10
l_2 = R(45 + 8.10) = 53.10

T = R(32.40 + 8.10) = 40.50
G = R(225 + 40.50) = 265.50

Line total check:
212.40 + 53.10 = 265.50
```

## 7. Intra-State GST Split

For intra-state GST:

```text
CGST = R(T / 2)
SGST = R(T - CGST)
IGST = 0
```

Example:

```text
T = 40.50
CGST = R(40.50 / 2) = 20.25
SGST = R(40.50 - 20.25) = 20.25
IGST = 0
```

Required equality:

```text
CGST + SGST + IGST = T
```

## 8. Inter-State GST Split

For inter-state GST:

```text
CGST = 0
SGST = 0
IGST = T
```

Example:

```text
B = 100
GST rate = 18%
T = 18

CGST = 0
SGST = 0
IGST = 18
G = 118
```

## 9. Simple Invoice Without GST

For a simple invoice:

```text
t_i = 0
T = 0
CGST = 0
SGST = 0
IGST = 0
G = B
```

Example:

```text
q_1 = 2
p_1 = 150
D = 25

S = R(2 * 150) = 300
B = R(300 - 25) = 275
T = 0
G = 275
```

## 10. Paid Amount And Balance Due

Paid amount is never allowed to exceed grand total.

```text
P = R(MIN(MAX(inputPaidAmount, 0), G))
U = R(G - P)
```

Payment status:

```text
If P >= G: status = Paid
If 0 < P < G: status = Partial
If P = 0: status = Unpaid
```

Example:

```text
G = 265.50
inputPaidAmount = 100

P = R(MIN(MAX(100, 0), 265.50)) = 100
U = R(265.50 - 100) = 165.50
status = Partial
```

Overpayment example:

```text
G = 275
inputPaidAmount = 999

P = R(MIN(999, 275)) = 275
U = R(275 - 275) = 0
status = Paid
```

## 11. Extra Payment On Existing Invoice

For a later payment:

```text
oldPaid = P_old
oldDue = U_old
paymentInput = A
```

Actual accepted payment:

```text
A_final = R(MIN(MAX(A, 0), oldDue))
P_new = R(oldPaid + A_final)
U_new = R(G - P_new)
```

If:

```text
A_final = 0
```

then no payment is accepted.

Example:

```text
G = 118
oldPaid = 0
oldDue = 118
paymentInput = 999

A_final = R(MIN(999, 118)) = 118
P_new = R(0 + 118) = 118
U_new = R(118 - 118) = 0
status = Paid
```

## 12. Adding An Item To Existing Invoice

When adding one new item:

```text
New item list = old items + new item
New subtotal S_new = SUM(all new item subtotals)
New discount D_new = old discount
New taxable base B_new = R(S_new - D_new)
New tax T_new = SUM(new line taxes)
New grand total G_new = R(B_new + T_new)
```

Paid amount does not change:

```text
P_new = P_old
U_new = R(G_new - P_new)
```

Example:

```text
Old grand total = 472
Old paid = 472
New item final total = 236

G_new = 472 + 236 = 708
P_new = 472
U_new = R(708 - 472) = 236
status = Partial
```

## 13. Invoice Cancellation

For cancelled invoices:

```text
Invoice is excluded from sales revenue
Invoice is excluded from profit revenue
Invoice is excluded from stock cost
U = 0
```

If stock was deducted, the same quantity is added back:

```text
restoredQuantity = soldQuantity
newBatchRemaining = oldBatchRemaining + restoredQuantity
```

Example:

```text
Invoice sold 3 bottles
Stock before cancellation = 2 bottles

Restored quantity = 3
Stock after cancellation = 2 + 3 = 5 bottles
```

## 14. Purchase Batch Calculation

For inventory purchase:

```text
Q = purchase quantity
C = unit cost
r = purchase GST rate
```

Purchase subtotal:

```text
purchaseSubtotal = R(Q * C)
```

Purchase GST:

```text
purchaseGst = R(purchaseSubtotal * r / 100)
```

Total purchase cost:

```text
purchaseTotal = R(purchaseSubtotal + purchaseGst)
```

Initial stock remaining:

```text
quantityRemaining = Q
```

Example:

```text
Q = 5
C = 120
r = 18

purchaseSubtotal = R(5 * 120) = 600
purchaseGst = R(600 * 18 / 100) = 108
purchaseTotal = R(600 + 108) = 708
quantityRemaining = 5
```

## 15. Stock Deduction

For a retail item on invoice:

```text
requiredStock = invoiceQuantity
```

For a service consumable:

```text
requiredStock = serviceConsumableQuantity * invoiceServiceQuantity
```

Total available stock:

```text
availableStock = R(SUM(batchQuantityRemaining))
```

The invoice can proceed only if:

```text
availableStock >= requiredStock
```

When stock is used:

```text
newBatchRemaining = oldBatchRemaining - usedQuantity
```

Stock cost for that movement:

```text
movementCost = R(usedQuantity * batchUnitCost)
```

Example:

```text
Invoice sells 2 bottles
Batch unit cost = 120

usedQuantity = 2
movementCost = R(2 * 120) = 240
```

## 16. Service Consumable Stock Formula

If a service uses consumables:

```text
c = consumable quantity needed for 1 service
q = invoice service quantity
```

Then:

```text
totalConsumableUsed = R(c * q)
```

Example:

```text
One wash uses 0.5 litre shampoo
Invoice quantity = 3 washes

totalConsumableUsed = R(0.5 * 3) = 1.5 litres
```

## 17. Stock Value

For each inventory item:

```text
currentQuantity = R(SUM(batchQuantityRemaining))
stockValue = R(SUM(batchQuantityRemaining * batchUnitCost))
```

Example:

```text
Batch 1: 2 units remaining, unit cost 100
Batch 2: 3 units remaining, unit cost 120

currentQuantity = R(2 + 3) = 5
stockValue = R((2 * 100) + (3 * 120)) = 560
```

Total stock value:

```text
totalStockValue = R(SUM(itemStockValue))
```

## 18. Dashboard Calculations

Dashboard collection is based on payment date, not invoice date.

```text
todayRevenue = R(SUM(paymentAmount where paymentDate = today and invoice is not cancelled))
```

```text
monthRevenue = R(SUM(paymentAmount where paymentDate >= first day of current month and invoice is not cancelled))
```

Pending due:

```text
pendingDues = R(SUM(balanceDue of non-cancelled invoices))
```

Today's invoice count:

```text
todayInvoices = COUNT(non-cancelled invoices where invoiceDate = today)
```

## 19. Sales Report Calculations

Sales report separates billed value and collected value.

Billed value uses invoice date:

```text
billedValue = R(SUM(grandTotal where invoiceDate is inside selected range and invoice is not cancelled))
```

Collected value uses payment date:

```text
collected = R(SUM(paymentAmount where paymentDate is inside selected range and invoice is not cancelled))
```

Pending due uses invoice date:

```text
pendingDue = R(SUM(balanceDue where invoiceDate is inside selected range and invoice is not cancelled))
```

Invoice count:

```text
invoiceCount = COUNT(non-cancelled invoices where invoiceDate is inside selected range)
```

Cancelled count:

```text
cancelledCount = COUNT(cancelled invoices where invoiceDate is inside selected range)
```

Payment mode total:

```text
paymentModeTotal_m = R(SUM(paymentAmount where paymentDate is inside selected range and paymentMode = m))
```

Important date example:

```text
Invoice date = 05-05-2026
Payment date = 06-05-2026

In 05-05-2026 report:
Invoice amount appears in billed value.

In 06-05-2026 report:
Payment amount appears in collected value.
```

## 20. Daily Sales Trend

For each date `d`:

```text
trendBilled_d = R(SUM(grandTotal where invoiceDate = d and invoice is not cancelled))
trendCollected_d = R(SUM(paymentAmount where paymentDate = d and invoice is not cancelled))
trendDue_d = R(SUM(balanceDue where invoiceDate = d and invoice is not cancelled))
```

## 21. GST Report Calculations

GST report uses invoice date.

```text
taxableValueReport = R(SUM(taxableValue of non-cancelled invoices in selected invoice-date range))
```

```text
cgstReport = R(SUM(CGST of non-cancelled invoices in selected invoice-date range))
sgstReport = R(SUM(SGST of non-cancelled invoices in selected invoice-date range))
igstReport = R(SUM(IGST of non-cancelled invoices in selected invoice-date range))
```

```text
totalTaxReport = R(SUM(totalTax of non-cancelled invoices in selected invoice-date range))
```

Required equality:

```text
cgstReport + sgstReport + igstReport = totalTaxReport
```

## 22. Profit Report Calculations

Profit uses collected money, not billed money.

Paid revenue:

```text
paidRevenue = R(SUM(paymentAmount where paymentDate is inside selected range and invoice is not cancelled))
```

Stock cost:

```text
stockCost = R(SUM(usedQuantity * batchUnitCost for invoice sale/usage movements))
```

Expenses:

```text
expenseTotal = R(SUM(expenseAmount where expenseDate is inside selected range))
```

Cash profit:

```text
cashProfit = R(paidRevenue - stockCost - expenseTotal)
```

Profit margin:

```text
if paidRevenue > 0:
  profitMargin = R((cashProfit / paidRevenue) * 100)

if paidRevenue = 0:
  profitMargin = 0
```

Example:

```text
paidRevenue = 286
stockCost = 80
expenseTotal = 500

cashProfit = R(286 - 80 - 500) = -294
profitMargin = R((-294 / 286) * 100) = -102.80%
```

## 23. Profit Trend

For each date `d`:

```text
dailyPaidRevenue_d = R(SUM(paymentAmount where paymentDate = d))
dailyStockCost_d = R(SUM(stock movement cost where movementDate = d))
dailyExpenses_d = R(SUM(expenseAmount where expenseDate = d))
dailyCashProfit_d = R(dailyPaidRevenue_d - dailyStockCost_d - dailyExpenses_d)
```

## 24. Expense Category Calculation

For each expense category `c`:

```text
categoryExpense_c = R(SUM(expenseAmount where category = c and expenseDate is inside selected range))
```

## 25. Top Services Calculation

For each service or item name:

```text
serviceQuantity = R(SUM(invoiceItemQuantity for non-cancelled invoices))
serviceRevenue = R(SUM(invoiceItemLineTotal for non-cancelled invoices))
```

Top services are ordered by:

```text
highest serviceRevenue first
```

## 26. Enquiry Conversion Calculation

For selected date range:

```text
totalLeads = COUNT(enquiries)
convertedLeads = COUNT(enquiries where status = converted)
lostLeads = COUNT(enquiries where status = lost)
openLeads = COUNT(enquiries where status is not converted and not lost)
```

Conversion percentage:

```text
if totalLeads > 0:
  conversionRate = round((convertedLeads / totalLeads) * 100)

if totalLeads = 0:
  conversionRate = 0
```

## 27. Job Card Calculations

For selected date range:

```text
totalJobCards = COUNT(job cards)
openJobCards = COUNT(job cards with open status)
completedJobCards = COUNT(job cards with delivered or billed status)
cancelledJobCards = COUNT(job cards with cancelled status)
billedJobCards = COUNT(job cards with billed status)
```

Job-card billed revenue:

```text
jobCardBilledRevenue = R(SUM(grandTotal of non-cancelled invoices linked to job cards))
```

Average turnaround:

```text
turnaroundDays = actualDeliveryDate - jobDate
averageTurnaroundDays = R(SUM(turnaroundDays) / COUNT(completed job cards with delivery date))
```

## 28. Date Range Mathematics

For preset reports:

```text
7d range starts at today - 6 days
30d range starts at today - 29 days
90d range starts at today - 89 days
all range has no start or end limit
```

For custom report:

```text
fromDate <= selectedDate <= toDate
```

If entered dates are reversed:

```text
actualFromDate = earlier date
actualToDate = later date
```

## 29. Mathematical Validation Examples

GST invoice example:

```text
Items:
2 x 100 = 200
1 x 50 = 50

Subtotal S = 250
Discount D = 25
Taxable base B = 225
GST 18% tax T = 40.50
CGST = 20.25
SGST = 20.25
IGST = 0
Grand total G = 265.50
Paid P = 100
Due U = 165.50
Status = Partial
```

Simple invoice example:

```text
Items:
2 x 150 = 300

Discount D = 25
Tax = 0
Grand total G = 275
Paid input = 999
Accepted paid amount P = 275
Due U = 0
Status = Paid
```

Profit example:

```text
Collected payment = 286
Stock cost = 80
Expenses = 500

Cash profit = 286 - 80 - 500 = -294
Profit margin = (-294 / 286) * 100 = -102.80%
```

