const assert = require("node:assert/strict");

const { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } = require("../dist-electron/shared/billing-math.js");
const {
  ALL_PERMISSIONS,
  DEFAULT_ACCESS_ROLES,
  OWNER_ACCESS_ROLE_ID,
  STAFF_OPERATIONS_ROLE_ID,
  PERMISSION_GROUPS,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  normalizePermissions
} = require("../dist-electron/shared/access-control.js");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const run = () => {
  const failures = [];
  tests.forEach(({ name, fn }) => {
    try {
      fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`✗ ${name}`);
      console.error(error);
    }
  });

  if (failures.length > 0) {
    console.error(`Shared logic check failed: ${failures.length}/${tests.length} tests failed.`);
    process.exit(1);
  }

  console.log(`Shared logic check passed (${tests.length} cases).`);
};

test("money rounds and safely handles non-finite values", () => {
  assert.equal(money(1.005), 1.01);
  assert.equal(money(2.675), 2.68);
  assert.equal(money(0.295), 0.3);
  assert.equal(money(10.005), 10.01);
  assert.equal(money(10.004), 10);
  assert.equal(money(Number.NaN), 0);
  assert.equal(money(Number.POSITIVE_INFINITY), 0);
});

test("SAC codes are normalized to numeric billing codes", () => {
  assert.equal(normalizeSacCode(" 330749 "), "330749");
  assert.equal(normalizeSacCode("bad-code"), DEFAULT_SAC_CODE);
  assert.equal(normalizeSacCode(""), DEFAULT_SAC_CODE);
});

test("simple invoice mode ignores GST and clamps discount to subtotal", () => {
  const totals = calculateInvoiceTotals(
    "simple",
    "intra",
    [{ description: "  Wash  ", quantity: 2, unitPrice: 150, gstRate: 18, sacCode: "" }],
    1000
  );
  assert.equal(totals.subTotal, 300);
  assert.equal(totals.discount, 300);
  assert.equal(totals.taxableValue, 0);
  assert.equal(totals.totalTax, 0);
  assert.equal(totals.grandTotal, 0);
  assert.equal(totals.items[0].lineTax, 0);
  assert.equal(totals.items[0].lineTotal, 0);
  assert.equal(totals.items[0].description, "Wash");
  assert.equal(totals.items[0].gstRate, 0);
  assert.equal(totals.items[0].sacCode, "9987");
});

test("GST intra-state totals split into CGST and SGST", () => {
  const totals = calculateInvoiceTotals(
    "gst",
    "intra",
    [
      { description: "Wash", quantity: 2, unitPrice: 100, gstRate: 18, sacCode: "9987" },
      { description: "Polish", quantity: 1, unitPrice: 50, gstRate: 18, sacCode: "9987" }
    ],
    25
  );
  assert.equal(totals.subTotal, 250);
  assert.equal(totals.discount, 25);
  assert.equal(totals.taxableValue, 225);
  assert.equal(totals.totalTax, 40.5);
  assert.equal(totals.cgst, 20.25);
  assert.equal(totals.sgst, 20.25);
  assert.equal(totals.igst, 0);
  assert.equal(totals.grandTotal, 265.5);
  assert.equal(money(totals.items.reduce((sum, item) => sum + item.lineTotal, 0)), totals.grandTotal);
});

test("GST inter-state totals use IGST only", () => {
  const totals = calculateInvoiceTotals(
    "gst",
    "inter",
    [{ description: "Service", quantity: 1, unitPrice: 100, gstRate: 18, sacCode: "9987" }],
    0
  );
  assert.equal(totals.taxableValue, 100);
  assert.equal(totals.totalTax, 18);
  assert.equal(totals.cgst, 0);
  assert.equal(totals.sgst, 0);
  assert.equal(totals.igst, 18);
  assert.equal(totals.grandTotal, 118);
});

test("GST odd paise are deterministic for intra and inter-state tax buckets", () => {
  const item = { description: "Rounding check", quantity: 1, unitPrice: 0.05, gstRate: 100, sacCode: "9987" };
  const intraTotals = calculateInvoiceTotals("gst", "intra", [item], 0);
  const interTotals = calculateInvoiceTotals("gst", "inter", [item], 0);

  assert.equal(intraTotals.totalTax, 0.05);
  assert.equal(intraTotals.cgst, 0.03);
  assert.equal(intraTotals.sgst, 0.02);
  assert.equal(intraTotals.igst, 0);
  assert.equal(interTotals.totalTax, 0.05);
  assert.equal(interTotals.cgst, 0);
  assert.equal(interTotals.sgst, 0);
  assert.equal(interTotals.igst, 0.05);
});

test("proportional cents allocation preserves rounded totals for tiny values", () => {
  const totals = calculateInvoiceTotals(
    "simple",
    "intra",
    [
      { description: "a", quantity: 1, unitPrice: 0.01, gstRate: 0, sacCode: "9987" },
      { description: "b", quantity: 1, unitPrice: 0.01, gstRate: 0, sacCode: "9987" },
      { description: "c", quantity: 1, unitPrice: 0.01, gstRate: 0, sacCode: "9987" }
    ],
    0.01
  );
  assert.equal(totals.subTotal, 0.03);
  assert.equal(totals.discount, 0.01);
  assert.equal(totals.grandTotal, 0.02);
  assert.equal(money(totals.items.reduce((sum, item) => sum + item.lineTotal, 0)), totals.grandTotal);
  assert.equal(totals.items.filter((item) => item.lineTotal === 0.01).length, 2);
  assert.equal(totals.items.filter((item) => item.lineTotal === 0).length, 1);
});

test("invalid numeric item fields are sanitized to zero", () => {
  const totals = calculateInvoiceTotals(
    "gst",
    "intra",
    [{ description: null, quantity: "NaN", unitPrice: "bad", gstRate: "bad", sacCode: "   " }],
    Number.NaN
  );
  assert.equal(totals.subTotal, 0);
  assert.equal(totals.discount, 0);
  assert.equal(totals.totalTax, 0);
  assert.equal(totals.grandTotal, 0);
  assert.equal(totals.items[0].description, "");
  assert.equal(totals.items[0].sacCode, "9987");
});

test("normalizePermissions removes duplicates and unknown values", () => {
  const normalized = normalizePermissions(["billing.view", "invalid", "billing.view", "reports.view", 12]);
  assert.deepEqual(normalized, ["billing.view", "reports.view"]);
  assert.deepEqual(normalizePermissions("not-array"), []);
});

test("permission checks handle owner bypass, staff permissions, and null users", () => {
  const owner = { role: "owner", permissions: [] };
  const staff = { role: "staff", permissions: ["billing.view", "customers.view"] };

  assert.equal(hasPermission(owner, "developer.access"), true);
  assert.equal(hasPermission(staff, "billing.view"), true);
  assert.equal(hasPermission(staff, "users.manage"), false);
  assert.equal(hasPermission(null, "billing.view"), false);

  assert.equal(hasAnyPermission(owner, ["users.manage", "reports.export"]), true);
  assert.equal(hasAnyPermission(staff, ["users.manage", "billing.view"]), true);
  assert.equal(hasAnyPermission(staff, ["users.manage", "reports.export"]), false);

  assert.equal(hasAllPermissions(owner, ["users.manage", "reports.export"]), true);
  assert.equal(hasAllPermissions(staff, ["billing.view", "customers.view"]), true);
  assert.equal(hasAllPermissions(staff, ["billing.view", "users.manage"]), false);
});

test("default access roles remain consistent and permission groups cover all keys", () => {
  const ownerRole = DEFAULT_ACCESS_ROLES.find((role) => role.id === OWNER_ACCESS_ROLE_ID);
  const staffOpsRole = DEFAULT_ACCESS_ROLES.find((role) => role.id === STAFF_OPERATIONS_ROLE_ID);
  assert.ok(ownerRole, "Owner role missing");
  assert.ok(staffOpsRole, "Staff operations role missing");
  assert.equal(ownerRole.locked, true);
  assert.equal(ownerRole.active, true);
  assert.equal(Object.isFrozen(ALL_PERMISSIONS), true);
  assert.notEqual(ownerRole.permissions, ALL_PERMISSIONS);
  assert.equal(new Set(ownerRole.permissions).size, ALL_PERMISSIONS.length);

  ALL_PERMISSIONS.forEach((permission) => assert.equal(ownerRole.permissions.includes(permission), true));
  assert.equal(staffOpsRole.permissions.includes("billing.create"), true);
  assert.equal(staffOpsRole.permissions.includes("reports.view"), false);

  const groupedPermissions = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));
  assert.equal(new Set(groupedPermissions).size, groupedPermissions.length, "Duplicate permission key in PERMISSION_GROUPS");
  assert.deepEqual(new Set(groupedPermissions), new Set(ALL_PERMISSIONS));
});

run();
