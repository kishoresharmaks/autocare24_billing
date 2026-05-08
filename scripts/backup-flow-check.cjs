const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const zlib = require("node:zlib");

const tempRoot = path.join(__dirname, "..", ".codex-temp", `backup-flow-${Date.now()}`);
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

const tarString = (buffer, start, length) =>
  buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "").trim();

const readBackupEntries = (filePath) => {
  const bytes = zlib.gunzipSync(fs.readFileSync(filePath));
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const sizeText = tarString(header, 124, 12);
    const size = Number.parseInt(sizeText || "0", 8) || 0;
    const entryName = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    entries.set(entryName, bytes.subarray(dataStart, dataStart + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
};

const writeFixture = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const timeToday = (hour, minute) => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
};

const run = async () => {
  const db = new AppDatabase();
  await db.init();
  const userData = path.join(tempRoot, "userData");

  writeFixture(path.join(userData, "invoice-assets", "logo.png"), Buffer.from("logo"));
  writeFixture(path.join(userData, "job-card-photos", "job-1", "before.jpg"), Buffer.from("photo"));
  writeFixture(path.join(userData, "purchase-record-documents", "purchase-1", "bill.pdf"), Buffer.from("%PDF-1.4"));
  const cloudSnapshotStatus = {
    included: true,
    exportedAt: new Date().toISOString(),
    entityCount: 3,
    recordCount: 5,
    invoiceCount: 1,
    error: ""
  };
  const cloudSnapshotData = Buffer.from(JSON.stringify({
    format: "autocare24-cloud-snapshot",
    version: 1,
    entities: {
      invoices: [{ recordId: "invoice-1", data: { id: "invoice-1", invoiceNumber: "INV-1" } }],
      invoice_items: [{ recordId: "item-1", data: { id: "item-1", invoiceId: "invoice-1" } }],
      payments: [{ recordId: "payment-1", data: { id: "payment-1", invoiceId: "invoice-1" } }]
    }
  }));

  const beforeSchedule = db.createScheduledBackupIfDue(timeToday(18, 59));
  assert.equal(beforeSchedule, "", "Scheduled backup should not run before 7 PM.");

  const firstBackup = db.createScheduledBackupIfDue(timeToday(19, 0), {
    cloudSnapshot: { data: cloudSnapshotData, status: cloudSnapshotStatus }
  });
  assert.ok(firstBackup.endsWith(".ac24backup"), "Scheduled backup should create an .ac24backup bundle at 7 PM.");
  assert.equal(fs.existsSync(firstBackup), true, "Scheduled backup bundle should exist on disk.");

  const duplicate = db.createScheduledBackupIfDue(timeToday(19, 30));
  assert.equal(duplicate, "", "Scheduled backup should not duplicate on the same local date.");

  const latest = db.getLatestBackup("auto");
  assert.equal(latest.ok, true, "Latest automatic backup should be available.");
  assert.equal(latest.path, firstBackup, "Latest automatic backup should be the scheduled bundle.");

  const entries = readBackupEntries(firstBackup);
  [
    "backup-manifest.json",
    "autocare24.sqlite",
    "invoice-assets/logo.png",
    "job-card-photos/job-1/before.jpg",
    "purchase-documents/purchase-1/bill.pdf",
    "cloud-data/cloud-snapshot.json"
  ].forEach((entry) => assert.ok(entries.has(entry), `Backup bundle is missing ${entry}.`));
  const manifest = JSON.parse(entries.get("backup-manifest.json").toString("utf8"));
  assert.equal(manifest.cloudSnapshot.included, true, "Backup manifest should mark the cloud snapshot as included.");
  assert.equal(manifest.cloudSnapshot.invoiceCount, 1, "Backup manifest should store invoice count.");
  const snapshot = JSON.parse(entries.get("cloud-data/cloud-snapshot.json").toString("utf8"));
  assert.equal(snapshot.entities.invoices.length, 1, "Cloud snapshot should contain invoice records.");

  const localOnly = db.createManualBackup({
    cloudSnapshotStatus: {
      included: false,
      exportedAt: "",
      entityCount: 0,
      recordCount: 0,
      invoiceCount: 0,
      error: "Cloud API is not reachable."
    }
  });
  assert.equal(localOnly.ok, true, "Local backup should still succeed when cloud snapshot export fails.");
  assert.equal(localOnly.cloudSnapshot.included, false, "Local-only backup should report missing cloud snapshot.");
  const localOnlyEntries = readBackupEntries(localOnly.path);
  assert.equal(localOnlyEntries.has("cloud-data/cloud-snapshot.json"), false, "Local-only backup should not contain a cloud snapshot file.");
  const localOnlyManifest = JSON.parse(localOnlyEntries.get("backup-manifest.json").toString("utf8"));
  assert.equal(localOnlyManifest.cloudSnapshot.error, "Cloud API is not reachable.", "Local-only manifest should store cloud snapshot error.");

  console.log("Backup flow check passed.");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
