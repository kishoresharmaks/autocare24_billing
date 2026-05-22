const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const tempRoot = path.join(__dirname, "..", ".codex-temp", `invoice-flow-${Date.now()}`);
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
const sum = (rows, selector) => money(rows.reduce((total, row) => total + selector(row), 0));
const closeToMoney = (actual, expected, label) => {
  assert.equal(money(actual), money(expected), `${label}: expected ${money(expected)}, got ${money(actual)}`);
};

const customer = (suffix = "A") => ({
  name: `Billing Test ${suffix}`,
  phone: "9000000000",
  email: "",
  gstin: "",
  address: "Salem"
});

const vehicle = (suffix = "A") => ({
  vehicleType: "bike",
  registrationNumber: `TN30TEST${suffix}`,
  make: "Test",
  model: "Model",
  color: "Black"
});

const invoiceInput = (overrides = {}) => ({
  invoiceMode: "gst",
  taxScope: "intra",
  invoiceDate: "2026-05-03",
  customer: customer(overrides.suffix || "A"),
  vehicle: vehicle(overrides.suffix || "A"),
  items: [
    { description: "Base Service", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }
  ],
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
  const passed = [];

  const assertNoCriticalHealthIssues = (label) => {
    const health = db.scanDataHealth();
    const critical = health.issues.filter((issue) => issue.severity === "critical");
    assert.deepEqual(critical, [], `${label}: critical health issues found: ${JSON.stringify(critical)}`);
  };

  const gstInvoice = db.createInvoice(invoiceInput({
    suffix: "GST",
    items: [
      { description: "Wash", quantity: 2, unitPrice: 100, gstRate: 18, sacCode: "9987" },
      { description: "Polish", quantity: 1, unitPrice: 50, gstRate: 18, sacCode: "9987" }
    ],
    discount: 25,
    paidAmount: 100
  }));
  closeToMoney(gstInvoice.subTotal, 250, "GST subtotal");
  closeToMoney(gstInvoice.discount, 25, "GST discount");
  closeToMoney(gstInvoice.taxableValue, 225, "GST taxable value");
  closeToMoney(gstInvoice.totalTax, 40.5, "GST total tax");
  closeToMoney(gstInvoice.cgst + gstInvoice.sgst, gstInvoice.totalTax, "CGST + SGST");
  closeToMoney(gstInvoice.grandTotal, 265.5, "GST grand total");
  closeToMoney(gstInvoice.paidAmount, 100, "GST paid amount");
  closeToMoney(gstInvoice.balanceDue, 165.5, "GST balance due");
  assert.equal(gstInvoice.paymentStatus, "partial");
  closeToMoney(sum(gstInvoice.items, (item) => item.lineTotal), gstInvoice.grandTotal, "GST line total sum");
  passed.push("GST totals, discount, partial payment, and line sums");

  const simpleInvoice = db.createInvoice(invoiceInput({
    suffix: "SIMPLE",
    invoiceMode: "simple",
    items: [
      { description: "Simple Labour", quantity: 2, unitPrice: 150, gstRate: 18, sacCode: "9987" }
    ],
    discount: 25,
    paidAmount: 275
  }));
  closeToMoney(simpleInvoice.subTotal, 300, "Simple subtotal");
  closeToMoney(simpleInvoice.discount, 25, "Simple discount");
  closeToMoney(simpleInvoice.taxableValue, 0, "Simple taxable value");
  closeToMoney(simpleInvoice.totalTax, 0, "Simple total tax");
  closeToMoney(simpleInvoice.grandTotal, 275, "Simple grand total");
  closeToMoney(simpleInvoice.paidAmount, 275, "Simple exact paid amount");
  closeToMoney(simpleInvoice.balanceDue, 0, "Simple exact paid balance");
  assert.equal(simpleInvoice.paymentStatus, "paid");
  closeToMoney(sum(simpleInvoice.items, (item) => item.lineTotal), simpleInvoice.grandTotal, "Simple line total sum");
  assert.throws(
    () => db.createInvoice(invoiceInput({
      suffix: "OVERPAID",
      invoiceMode: "simple",
      items: [{ description: "Initial Overpayment Guard", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }],
      paidAmount: 999
    })),
    /Entered paid amount is greater than billed amount/
  );
  assert.throws(
    () => db.createInvoice(invoiceInput({
      suffix: "DISC",
      items: [{ description: "Discount Guard", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }],
      discount: 101
    })),
    /Discount cannot be greater than subtotal/
  );
  passed.push("Simple invoices ignore GST, accept exact payment, and reject initial overpayment/excess discount");

  const dueInvoice = db.createInvoice(invoiceInput({
    suffix: "PAY",
    items: [
      { description: "Payment Clamp", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }
    ],
    paidAmount: 0
  }));
  const paidDueInvoice = db.recordPayment({
    invoiceId: dueInvoice.id,
    amount: 999,
    mode: "UPI",
    reference: "OVERPAY",
    paymentDate: "2026-05-03"
  });
  closeToMoney(paidDueInvoice.grandTotal, 118, "Payment clamp invoice total");
  closeToMoney(paidDueInvoice.paidAmount, 118, "Manual overpayment clamps to balance due");
  closeToMoney(paidDueInvoice.balanceDue, 0, "Manual overpayment clears balance");
  assert.equal(paidDueInvoice.paymentStatus, "paid");
  closeToMoney(sum(paidDueInvoice.payments, (payment) => payment.amount), 118, "Stored payment amount is clamped");
  assert.throws(
    () => db.recordPayment({ invoiceId: paidDueInvoice.id, amount: 1, mode: "Cash", reference: "", paymentDate: "2026-05-03" }),
    /Payment amount must be greater than zero/
  );
  passed.push("Payment recording clamps overpayment and blocks collection beyond due");

  const emailInvoice = db.createInvoice(invoiceInput({
    suffix: "EMAIL",
    customer: { ...customer("EMAIL"), email: "billing.customer@example.com" },
    items: [
      { description: "Email Capture Service", quantity: 1, unitPrice: 125, gstRate: 18, sacCode: "9987" }
    ]
  }));
  assert.equal(emailInvoice.customer.email, "billing.customer@example.com");
  assert.equal(db.listCustomers().some((row) => row.email === "billing.customer@example.com"), true, "New bill email should be stored on customer");
  passed.push("New bill customer email is stored on the customer record");

  assert.throws(
    () => db.saveInventoryItem({ name: "Bad negative price", retailPrice: -1, gstRate: 18, lowStockLevel: 0, active: true }),
    /Selling price cannot be negative/
  );
  assert.throws(
    () => db.saveInventoryItem({ name: "Bad negative GST", retailPrice: 0, gstRate: -1, lowStockLevel: 0, active: true }),
    /GST rate cannot be negative/
  );
  assert.throws(
    () => db.saveInventoryItem({ name: "Bad negative low stock", retailPrice: 0, gstRate: 18, lowStockLevel: -1, active: true }),
    /Low stock level cannot be negative/
  );
  passed.push("Inventory item rejects negative selling price, GST rate, and low stock level");

  const retail = db.saveInventoryItem({
    name: "Retail Wax",
    type: "retail",
    unit: "bottle",
    sku: "RW-1",
    category: "Retail",
    retailPrice: 200,
    gstRate: 18,
    lowStockLevel: 1,
    active: true
  });
  db.addInventoryPurchase({
    itemId: retail.id,
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "B1",
    expiryDate: "",
    purchaseDate: "2026-05-01",
    billNumber: "PUR-1",
    quantity: 5,
    unitCost: 120,
    gstRate: 18
  });
  const quoteRetail = db.saveInventoryItem({
    name: "Quote Retail Kit",
    type: "retail",
    unit: "kit",
    sku: "QRK-1",
    category: "Retail",
    retailPrice: 300,
    gstRate: 18,
    lowStockLevel: 1,
    active: true
  });
  db.addInventoryPurchase({
    itemId: quoteRetail.id,
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "QB1",
    expiryDate: "",
    purchaseDate: "2026-05-01",
    billNumber: "QPUR-1",
    quantity: 2,
    unitCost: 150,
    gstRate: 18
  });
  const customersBeforeLooseDrafts = db.listCustomers().length;
  const looseQuotation = db.saveQuotation({
    invoiceMode: "gst",
    taxScope: "intra",
    quotationDate: "2026-05-03",
    validUntil: "",
    status: "draft",
    customer: {},
    vehicle: {},
    items: [
      { description: "", quantity: 1, unitPrice: 0, gstRate: 18, sacCode: "9987" }
    ],
    discount: 0,
    notes: ""
  });
  assert.equal(looseQuotation.customerId, "");
  assert.equal(looseQuotation.vehicleId, "");
  assert.equal(looseQuotation.items.length, 0, "Fully blank quotation item rows are dropped");
  assert.equal(db.listCustomers().length, customersBeforeLooseDrafts, "Loose quotation should not create a customer");
  assert.throws(() => db.convertQuotationToInvoice(looseQuotation.id), /Customer name is required/);
  assert.equal(db.listCustomers().length, customersBeforeLooseDrafts, "Failed loose quotation conversion should not create customer");

  const partialQuotation = db.saveQuotation({
    invoiceMode: "gst",
    taxScope: "intra",
    quotationDate: "2026-05-03",
    validUntil: "",
    customer: { name: "Partial Quote Customer", email: "partial.quote@example.com" },
    vehicle: {},
    items: [
      { description: "Partial quote service", quantity: 1, unitPrice: 0, gstRate: 18, sacCode: "9987" }
    ],
    discount: 0,
    notes: ""
  });
  assert.equal(partialQuotation.customerEmail, "partial.quote@example.com");
  assert.equal(partialQuotation.vehicleNumber, "");
  assert.equal(partialQuotation.items.length, 1, "Partially filled quotation rows save without blocking");
  assert.equal(db.listCustomers().length, customersBeforeLooseDrafts, "Partial quotation should not create a customer before conversion");
  assert.throws(() => db.convertQuotationToInvoice(partialQuotation.id), /Vehicle number is required/);
  assert.equal(db.listCustomers().length, customersBeforeLooseDrafts, "Failed partial quotation conversion should not create customer");
  passed.push("Loose and partial quotation drafts save without customer or vehicle records and validate on conversion");

  const quoteCustomer = { ...customer("QTE"), email: "quote.customer@example.com" };
  const quotation = db.saveQuotation({
    invoiceMode: "gst",
    taxScope: "intra",
    quotationDate: "2026-05-03",
    validUntil: "2026-05-10",
    customer: quoteCustomer,
    vehicle: vehicle("QTE"),
    items: [
      { inventoryItemId: quoteRetail.id, description: "Quote Retail Kit", quantity: 1, unitPrice: 300, gstRate: 18, sacCode: "9987" }
    ],
    discount: 0,
    notes: "Customer quote"
  });
  assert.match(quotation.quotationNumber, /^QT-\d{5}$/);
  assert.equal(quotation.quotationStatus, "draft");
  assert.equal(quotation.customerEmail, quoteCustomer.email);
  assert.equal(db.listCustomers().some((row) => row.email === quoteCustomer.email), false, "Quotation save should not create customer until conversion");
  closeToMoney(quotation.grandTotal, 354, "Quotation total");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === quoteRetail.id).currentQuantity, 2, "Quotation does not deduct stock");
  assert.equal(db.listInventoryMovements(quoteRetail.id).filter((row) => row.reference === quotation.quotationNumber).length, 0, "Quotation does not create stock movement");
  const sentQuotation = db.updateQuotationStatus({ quotationId: quotation.id, status: "sent" });
  assert.equal(sentQuotation.quotationStatus, "sent");
  const convertedFromQuote = db.convertQuotationToInvoice(quotation.id);
  assert.equal(convertedFromQuote.sourceQuotationId, quotation.id);
  assert.equal(convertedFromQuote.customer.email, quoteCustomer.email);
  assert.equal(convertedFromQuote.paymentStatus, "unpaid");
  closeToMoney(convertedFromQuote.balanceDue, 354, "Converted quote balance due");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === quoteRetail.id).currentQuantity, 1, "Converted quote deducts stock");
  closeToMoney(sum(db.listInventoryMovements(quoteRetail.id).filter((row) => row.reference === convertedFromQuote.invoiceNumber && row.type === "sale"), (row) => row.quantity), 1, "Converted quote sale movement quantity");
  const convertedQuotation = db.getQuotation(quotation.id);
  assert.equal(convertedQuotation.quotationStatus, "converted");
  assert.equal(convertedQuotation.convertedInvoiceId, convertedFromQuote.id);
  assert.throws(() => db.convertQuotationToInvoice(quotation.id), /already converted/);
  passed.push("Quotation saves without stock movement and converts once into a stock-deducting bill");

  const shortQuote = db.saveQuotation({
    invoiceMode: "gst",
    taxScope: "intra",
    quotationDate: "2026-05-03",
    customer: customer("QFAIL"),
    vehicle: vehicle("QFAIL"),
    items: [
      { inventoryItemId: quoteRetail.id, description: "Too Many Quote Kits", quantity: 99, unitPrice: 300, gstRate: 18, sacCode: "9987" }
    ],
    discount: 0,
    notes: ""
  });
  const quoteStockBeforeFailure = db.listInventoryItems(true).find((item) => item.id === quoteRetail.id).currentQuantity;
  const invoiceCountBeforeQuoteFailure = db.listInvoices("").length;
  assert.throws(() => db.convertQuotationToInvoice(shortQuote.id), /Insufficient stock/);
  assert.equal(db.listInvoices("").length, invoiceCountBeforeQuoteFailure, "Failed quote conversion must not create invoice");
  assert.equal(db.getQuotation(shortQuote.id).quotationStatus, "draft", "Failed quote conversion keeps quote open");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === quoteRetail.id).currentQuantity, quoteStockBeforeFailure, "Failed quote conversion preserves stock");
  passed.push("Insufficient-stock quotation conversion rolls back invoice and stock changes");

  const stockInvoice = db.createInvoice(invoiceInput({
    suffix: "STK",
    items: [
      { inventoryItemId: retail.id, description: "Retail Wax", quantity: 2, unitPrice: 200, gstRate: 18, sacCode: "3405" }
    ],
    paidAmount: 472
  }));
  closeToMoney(stockInvoice.grandTotal, 472, "Retail sale invoice total");
  assert.equal(stockInvoice.paymentStatus, "paid");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === retail.id).currentQuantity, 3, "Retail stock after invoice sale");
  closeToMoney(sum(db.listInventoryMovements(retail.id).filter((row) => row.reference === stockInvoice.invoiceNumber && row.type === "sale"), (row) => row.quantity), 2, "Retail sale movement quantity");
  passed.push("Retail invoice deducts stock and records sale movement");

  const appended = db.appendInvoiceItem({
    invoiceId: stockInvoice.id,
    item: { inventoryItemId: retail.id, description: "Retail Wax Add-on", quantity: 1, unitPrice: 200, gstRate: 18, sacCode: "3405" }
  });
  closeToMoney(appended.grandTotal, 708, "Append item grand total");
  closeToMoney(appended.paidAmount, 472, "Append keeps paid amount");
  closeToMoney(appended.balanceDue, 236, "Append creates balance for new item");
  assert.equal(appended.paymentStatus, "partial");
  closeToMoney(sum(appended.items, (item) => item.lineTotal), appended.grandTotal, "Append line total sum");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === retail.id).currentQuantity, 2, "Retail stock after append");
  closeToMoney(sum(db.listInventoryMovements(retail.id).filter((row) => row.reference === stockInvoice.invoiceNumber && row.type === "sale"), (row) => row.quantity), 3, "Retail sale movements after append");
  passed.push("Append item recalculates due amount and deducts only appended stock");

  const beforeRollbackTotal = appended.grandTotal;
  const beforeRollbackStock = db.listInventoryItems(true).find((item) => item.id === retail.id).currentQuantity;
  assert.throws(
    () => db.appendInvoiceItem({
      invoiceId: stockInvoice.id,
      item: { inventoryItemId: retail.id, description: "Too Much Retail Wax", quantity: 99, unitPrice: 200, gstRate: 18, sacCode: "3405" }
    }),
    /Insufficient stock/
  );
  const afterFailedAppend = db.getInvoice(stockInvoice.id);
  closeToMoney(afterFailedAppend.grandTotal, beforeRollbackTotal, "Failed append preserves grand total");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === retail.id).currentQuantity, beforeRollbackStock, "Failed append preserves stock");
  assert.equal(afterFailedAppend.items.length, appended.items.length, "Failed append preserves invoice lines");
  passed.push("Insufficient-stock append rolls back invoice and stock changes");

  const cancelled = db.cancelInvoice({ invoiceId: stockInvoice.id, reason: "Test cancellation" }, "test-user");
  assert.equal(cancelled.invoiceStatus, "cancelled");
  closeToMoney(cancelled.balanceDue, 0, "Cancelled invoice balance");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === retail.id).currentQuantity, 5, "Cancel restores retail stock");
  closeToMoney(sum(db.listInventoryMovements(retail.id).filter((row) => row.reference === stockInvoice.invoiceNumber && row.type === "invoice_cancel_reversal"), (row) => row.quantity), 3, "Cancel reversal quantity");
  assert.throws(
    () => db.appendInvoiceItem({
      invoiceId: stockInvoice.id,
      item: { description: "Blocked", quantity: 1, unitPrice: 1, gstRate: 18, sacCode: "9987" }
    }),
    /Cancelled invoices cannot be changed/
  );
  assert.throws(
    () => db.recordPayment({ invoiceId: stockInvoice.id, amount: 1, mode: "Cash", reference: "", paymentDate: "2026-05-03" }),
    /Cancelled invoices cannot receive payments/
  );
  passed.push("Cancellation reverses stock and blocks future add/payment");

  const scarce = db.saveInventoryItem({
    name: "Scarce Retail Item",
    type: "retail",
    unit: "piece",
    category: "Retail",
    retailPrice: 10,
    gstRate: 18,
    active: true
  });
  db.addInventoryPurchase({
    itemId: scarce.id,
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "B2",
    expiryDate: "",
    purchaseDate: "2026-05-01",
    billNumber: "PUR-2",
    quantity: 1,
    unitCost: 5,
    gstRate: 0
  });
  const invoiceCountBefore = db.listInvoices("").length;
  assert.throws(
    () => db.createInvoice(invoiceInput({
      suffix: "FAIL",
      items: [
        { inventoryItemId: scarce.id, description: "Scarce Retail Item", quantity: 2, unitPrice: 10, gstRate: 18, sacCode: "3405" }
      ]
    })),
    /Insufficient stock/
  );
  assert.equal(db.listInvoices("").length, invoiceCountBefore, "Failed create must not leave an invoice row");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === scarce.id).currentQuantity, 1, "Failed create preserves stock");
  passed.push("Insufficient-stock invoice creation rolls back fully");

  const consumable = db.saveInventoryItem({
    name: "Shampoo Test",
    type: "consumable",
    unit: "ltr",
    category: "Studio",
    retailPrice: 0,
    gstRate: 18,
    active: true
  });
  db.addInventoryPurchase({
    itemId: consumable.id,
    supplierId: "",
    supplier: { name: "" },
    batchNumber: "B3",
    expiryDate: "",
    purchaseDate: "2026-05-01",
    billNumber: "PUR-3",
    quantity: 10,
    unitCost: 50,
    gstRate: 18
  });
  const service = db.saveService({ name: "Recipe Wash", category: "Wash", defaultPrice: 100, gstRate: 18, sacCode: "9987", active: true });
  db.saveServiceConsumables(service.id, [{ inventoryItemId: consumable.id, quantity: 0.5 }]);
  const recipeInvoice = db.createInvoice(invoiceInput({
    suffix: "RCP",
    items: [
      { serviceId: service.id, description: "Recipe Wash", quantity: 3, unitPrice: 100, gstRate: 18, sacCode: "9987" }
    ],
    paidAmount: 0
  }));
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === consumable.id).currentQuantity, 8.5, "Service recipe deducts consumable stock");
  closeToMoney(sum(db.listInventoryMovements(consumable.id).filter((row) => row.reference === recipeInvoice.invoiceNumber && row.type === "usage"), (row) => row.quantity), 1.5, "Service recipe usage movement");
  db.cancelInvoice({ invoiceId: recipeInvoice.id, reason: "Recipe test cancellation" }, "test-user");
  closeToMoney(db.listInventoryItems(true).find((item) => item.id === consumable.id).currentQuantity, 10, "Cancel restores recipe consumable stock");
  passed.push("Service recipe consumes stock and cancellation restores it");

  const interState = db.createInvoice(invoiceInput({
    suffix: "IGST",
    taxScope: "inter",
    items: [
      { description: "Interstate GST Service", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }
    ]
  }));
  closeToMoney(interState.cgst, 0, "Interstate CGST");
  closeToMoney(interState.sgst, 0, "Interstate SGST");
  closeToMoney(interState.igst, 18, "Interstate IGST");
  passed.push("Interstate invoices use IGST only");

  const rounded = db.createInvoice(invoiceInput({
    suffix: "RND",
    items: [
      { description: "Tiny 1", quantity: 1, unitPrice: 1, gstRate: 18, sacCode: "9987" },
      { description: "Tiny 2", quantity: 1, unitPrice: 1, gstRate: 18, sacCode: "9987" },
      { description: "Tiny 3", quantity: 1, unitPrice: 1, gstRate: 18, sacCode: "9987" }
    ],
    discount: 1
  }));
  closeToMoney(sum(rounded.items, (item) => item.lineTotal), rounded.grandTotal, "Rounded discount line totals");
  closeToMoney(rounded.cgst + rounded.sgst, rounded.totalTax, "Rounded CGST + SGST");
  passed.push("Rounding keeps line totals and GST splits internally consistent");

  assertNoCriticalHealthIssues("Final health scan");
  passed.push("Data-health scan has no critical invoice/stock issues");

  console.log(`Invoice flow verification passed (${passed.length} cases):`);
  for (const item of passed) console.log(`- ${item}`);
  console.log(`Temporary database: ${tempRoot}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
