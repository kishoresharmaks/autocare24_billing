const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const tempRoot = path.join(__dirname, "..", ".codex-temp", `profit-flow-${Date.now()}`);
fs.mkdirSync(tempRoot, { recursive: true });

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        isPackaged: false,
        getPath(name) {
          const dir = path.join(tempRoot, name);
          fs.mkdirSync(dir, { recursive: true });
          return dir;
        }
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { AppDatabase } = require("../dist-electron/electron/database.js");

const money = (value) => Math.round(value * 100) / 100;
const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const oldDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 120);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const closeToMoney = (actual, expected, label) => {
  assert.equal(money(actual), money(expected), `${label}: expected ${money(expected)}, got ${money(actual)}`);
};

const customer = (suffix) => ({
  name: `Profit Test ${suffix}`,
  phone: "9000000000",
  email: "",
  gstin: "",
  address: "Salem"
});

const vehicle = (suffix) => ({
  vehicleType: "bike",
  registrationNumber: `TN30PROFIT${suffix}`,
  make: "Test",
  model: "Model",
  color: "Black"
});

const invoiceInput = (overrides = {}) => ({
  invoiceMode: "gst",
  taxScope: "intra",
  invoiceDate: todayLocal(),
  customer: customer(overrides.suffix || "A"),
  vehicle: vehicle(overrides.suffix || "A"),
  items: [{ description: "Profit Service", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }],
  discount: 0,
  paidAmount: 0,
  paymentMode: "Cash",
  paymentReference: "",
  notes: "",
  ...overrides
});

const run = async () => {
  const db = new AppDatabase();
  await db.init();
  const owner = db.setupOwner({ displayName: "Owner", username: "owner", password: "Strongpass123" });
  const date = todayLocal();

  const tempExpense = db.saveExpense({
    expenseDate: date,
    category: "Temp",
    amount: 100,
    paymentMode: "Cash",
    vendor: "Test vendor",
    reference: "TEMP-1",
    notes: "temporary"
  }, owner.id);
  const editedExpense = db.saveExpense({ ...tempExpense, amount: 125, notes: "updated" }, owner.id);
  closeToMoney(editedExpense.amount, 125, "Edited expense amount");
  assert.equal(db.deleteExpense(tempExpense.id), true, "Expense delete returns true");
  assert.equal(db.listExpenses("all").some((expense) => expense.id === tempExpense.id), false, "Deleted expense removed");

  db.saveExpense({
    expenseDate: date,
    category: "Rent",
    amount: 500,
    paymentMode: "UPI",
    vendor: "Landlord",
    reference: "RENT-1",
    notes: "Monthly rent"
  }, owner.id);
  db.saveExpense({
    expenseDate: oldDate(),
    category: "Old",
    amount: 2000,
    paymentMode: "Cash",
    vendor: "Old vendor",
    reference: "OLD-1",
    notes: "Outside current preset"
  }, owner.id);

  const retail = db.saveInventoryItem({
    name: "Profit Wax",
    type: "retail",
    unit: "bottle",
    category: "Retail",
    retailPrice: 100,
    gstRate: 18,
    active: true
  });
  db.addInventoryPurchase({
    itemId: retail.id,
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "P1",
    expiryDate: "",
    purchaseDate: date,
    billNumber: "P-PUR-1",
    quantity: 10,
    unitCost: 40,
    gstRate: 0
  });

  const activeInvoice = db.createInvoice(invoiceInput({
    suffix: "A",
    items: [{ inventoryItemId: retail.id, description: "Profit Wax", quantity: 2, unitPrice: 100, gstRate: 18, sacCode: "3405" }],
    paidAmount: 236
  }));
  closeToMoney(activeInvoice.grandTotal, 236, "Active invoice total");

  const cancelledInvoice = db.createInvoice(invoiceInput({
    suffix: "B",
    items: [{ inventoryItemId: retail.id, description: "Cancelled Wax", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "3405" }],
    paidAmount: 118
  }));
  db.cancelInvoice({ invoiceId: cancelledInvoice.id, reason: "Profit test cancel" }, owner.id);

  const oldUnpaidInvoice = db.createInvoice(invoiceInput({
    suffix: "OLDPAY",
    invoiceDate: oldDate(),
    items: [{ description: "Old invoice paid today", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }],
    paidAmount: 0
  }));
  db.recordPayment({
    invoiceId: oldUnpaidInvoice.id,
    amount: 50,
    mode: "Card",
    reference: "OLD-DUE",
    paymentDate: date
  });

  const report = db.getProfitReport("30d");
  closeToMoney(report.paidRevenue, 286, "Paid revenue uses payment date and excludes cancelled invoices");
  closeToMoney(report.stockCost, 80, "Stock cost excludes cancelled invoices");
  closeToMoney(report.expenseTotal, 500, "Current expenses");
  closeToMoney(report.cashProfit, -294, "Cash profit formula");
  closeToMoney(report.profitMargin, money((-294 / 286) * 100), "Profit margin");
  assert.equal(report.expenses.length, 1, "Current preset expenses count");
  assert.equal(report.expensesByCategory[0].category, "Rent", "Category summary");
  assert.ok(report.trend.some((item) => item.date === date && item.paidRevenue === 286 && item.stockCost === 80 && item.expenses === 500), "Trend contains combined daily values");

  const dashboard = db.getDashboard();
  closeToMoney(dashboard.todayRevenue, 286, "Dashboard today revenue uses payment date");
  closeToMoney(dashboard.monthRevenue, 286, "Dashboard month revenue uses payment date");

  const salesReport = db.getReports({ fromDate: date, toDate: date });
  closeToMoney(salesReport.revenue, 236, "Sales report billed value uses invoice date");
  closeToMoney(salesReport.paidAmount, 286, "Sales report collected uses payment date");
  closeToMoney(salesReport.paymentModes.reduce((sum, item) => sum + item.amount, 0), 286, "Payment mode totals use payment date");
  assert.ok(
    salesReport.salesTrend.some((item) => item.date === date && item.billedValue === 236 && item.paidAmount === 286),
    "Sales trend combines billed-by-invoice-date and collected-by-payment-date"
  );

  const allReport = db.getProfitReport("all");
  closeToMoney(allReport.expenseTotal, 2500, "All-time expenses include old expenses");

  const dashboardBeforePurchaseRecord = db.getInventoryDashboard();
  const retailBeforePurchaseRecord = dashboardBeforePurchaseRecord.items.find((item) => item.id === retail.id);
  const movementCountBeforePurchaseRecord = db.listInventoryMovements().length;
  const expenseCountBeforePurchaseRecord = db.listExpenses("all").length;
  const profitBeforePurchaseRecord = db.getProfitReport("all");
  db.runWrite(
    `INSERT INTO purchase_records
      (id, purchaseDate, supplierId, supplierName, vendorName, billNumber, amount, paymentMode, notes, documents, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "purchase-record-profit-isolation",
      date,
      "",
      "",
      "Reference Vendor",
      "PR-ISO-1",
      9999,
      "UPI",
      "Reference-only purchase document",
      JSON.stringify([{ id: "doc-1", fileId: "doc-1", originalName: "bill.pdf", mimeType: "application/pdf", sizeBytes: 512, sha256: "abc", uploadedAt: date }]),
      date,
      date
    ]
  );
  const dashboardAfterPurchaseRecord = db.getInventoryDashboard();
  const retailAfterPurchaseRecord = dashboardAfterPurchaseRecord.items.find((item) => item.id === retail.id);
  const profitAfterPurchaseRecord = db.getProfitReport("all");
  closeToMoney(retailAfterPurchaseRecord.currentQuantity, retailBeforePurchaseRecord.currentQuantity, "Purchase record does not change stock quantity");
  closeToMoney(retailAfterPurchaseRecord.stockValue, retailBeforePurchaseRecord.stockValue, "Purchase record does not change stock value");
  assert.equal(db.listInventoryMovements().length, movementCountBeforePurchaseRecord, "Purchase record does not create stock movement");
  assert.equal(db.listExpenses("all").length, expenseCountBeforePurchaseRecord, "Purchase record does not create expense");
  closeToMoney(profitAfterPurchaseRecord.paidRevenue, profitBeforePurchaseRecord.paidRevenue, "Purchase record does not change profit revenue");
  closeToMoney(profitAfterPurchaseRecord.stockCost, profitBeforePurchaseRecord.stockCost, "Purchase record does not change profit stock cost");
  closeToMoney(profitAfterPurchaseRecord.expenseTotal, profitBeforePurchaseRecord.expenseTotal, "Purchase record does not change profit expenses");
  closeToMoney(profitAfterPurchaseRecord.cashProfit, profitBeforePurchaseRecord.cashProfit, "Purchase record does not change cash profit");

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "electron", "main.ts"), "utf8");
  assert.match(mainSource, /ipcMain\.handle\("expenses:list", permitted\("expenses\.manage"/, "expenses:list requires expense permission");
  assert.match(mainSource, /ipcMain\.handle\("expenses:save", permitted\("expenses\.manage"/, "expenses:save requires expense permission");
  assert.match(mainSource, /ipcMain\.handle\("expenses:delete", permitted\("expenses\.manage"/, "expenses:delete requires expense permission");
  assert.match(mainSource, /ipcMain\.handle\("profit:get", permitted\("reports\.view"/, "profit:get requires report permission");
  assert.match(mainSource, /ipcMain\.handle\("reports:exportCsv", permitted\("reports\.export"/, "report export requires export permission");

  console.log("Profit flow verification passed (10 cases):");
  console.log("- expense create/edit/delete");
  console.log("- permission-based IPC wiring");
  console.log("- dashboard, report, and profit paid revenue by payment date");
  console.log("- sales report billed-vs-collected date semantics");
  console.log("- expense totals by expense date");
  console.log("- cancelled invoices excluded from revenue and stock cost");
  console.log("- cash profit formula");
  console.log("- profit trend and category summaries");
  console.log("- date preset all vs current range");
  console.log("- purchase records excluded from stock, expense, and profit calculations");
  console.log(`Temporary database: ${tempRoot}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
