export const CORE_SCHEMA_SQL = `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        displayName TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        accessRoleId TEXT,
        passwordHash TEXT NOT NULL,
        salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (accessRoleId) REFERENCES access_roles(id)
      );

      CREATE TABLE IF NOT EXISTS access_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        permissionsJson TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        gstin TEXT,
        address TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        vehicleType TEXT NOT NULL DEFAULT 'car',
        registrationNumber TEXT NOT NULL,
        make TEXT,
        model TEXT,
        color TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        defaultPrice REAL NOT NULL,
        gstRate REAL NOT NULL,
        sacCode TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoiceNumber TEXT NOT NULL UNIQUE,
        invoiceStatus TEXT NOT NULL DEFAULT 'finalized',
        cloudSyncStatus TEXT NOT NULL DEFAULT 'local_only',
        cloudRevision INTEGER NOT NULL DEFAULT 0,
        cloudSyncedAt TEXT,
        cloudConflictId TEXT,
        invoiceMode TEXT NOT NULL,
        taxScope TEXT NOT NULL,
        invoiceDate TEXT NOT NULL,
        customerId TEXT NOT NULL,
        vehicleId TEXT NOT NULL,
        subTotal REAL NOT NULL,
        discount REAL NOT NULL,
        taxableValue REAL NOT NULL,
        cgst REAL NOT NULL,
        sgst REAL NOT NULL,
        igst REAL NOT NULL,
        totalTax REAL NOT NULL,
        grandTotal REAL NOT NULL,
        paidAmount REAL NOT NULL,
        balanceDue REAL NOT NULL,
        paymentStatus TEXT NOT NULL,
        paymentMode TEXT NOT NULL,
        paymentReference TEXT,
        notes TEXT,
        jobCardId TEXT,
        cancelledAt TEXT,
        cancelledByUserId TEXT,
        cancelReason TEXT,
        replacementInvoiceId TEXT,
        sourceInvoiceId TEXT,
        sourceQuotationId TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id),
        FOREIGN KEY (vehicleId) REFERENCES vehicles(id)
      );

      CREATE TABLE IF NOT EXISTS invoice_drafts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sourceInvoiceId TEXT,
        correctionType TEXT NOT NULL DEFAULT 'normal',
        payloadJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        invoiceId TEXT NOT NULL,
        serviceId TEXT,
        inventoryItemId TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL,
        unitPrice REAL NOT NULL,
        gstRate REAL NOT NULL,
        sacCode TEXT,
        lineSubTotal REAL NOT NULL,
        lineTax REAL NOT NULL,
        lineTotal REAL NOT NULL,
        FOREIGN KEY (invoiceId) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        quotationNumber TEXT NOT NULL UNIQUE,
        quotationStatus TEXT NOT NULL DEFAULT 'draft',
        invoiceMode TEXT NOT NULL,
        taxScope TEXT NOT NULL,
        quotationDate TEXT NOT NULL,
        validUntil TEXT,
        customerId TEXT,
        vehicleId TEXT,
        customerName TEXT,
        customerPhone TEXT,
        customerEmail TEXT,
        customerGstin TEXT,
        customerAddress TEXT,
        vehicleType TEXT NOT NULL DEFAULT 'car',
        vehicleNumber TEXT,
        vehicleMake TEXT,
        vehicleModel TEXT,
        vehicleColor TEXT,
        subTotal REAL NOT NULL,
        discount REAL NOT NULL,
        taxableValue REAL NOT NULL,
        cgst REAL NOT NULL,
        sgst REAL NOT NULL,
        igst REAL NOT NULL,
        totalTax REAL NOT NULL,
        grandTotal REAL NOT NULL,
        notes TEXT,
        convertedInvoiceId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id),
        FOREIGN KEY (vehicleId) REFERENCES vehicles(id),
        FOREIGN KEY (convertedInvoiceId) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS quotation_items (
        id TEXT PRIMARY KEY,
        quotationId TEXT NOT NULL,
        serviceId TEXT,
        inventoryItemId TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL,
        unitPrice REAL NOT NULL,
        gstRate REAL NOT NULL,
        sacCode TEXT,
        lineSubTotal REAL NOT NULL,
        lineTax REAL NOT NULL,
        lineTotal REAL NOT NULL,
        FOREIGN KEY (quotationId) REFERENCES quotations(id)
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        gstin TEXT,
        address TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        unit TEXT NOT NULL,
        sku TEXT,
        category TEXT,
        retailPrice REAL NOT NULL DEFAULT 0,
        gstRate REAL NOT NULL DEFAULT 0,
        lowStockLevel REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_batches (
        id TEXT PRIMARY KEY,
        itemId TEXT NOT NULL,
        supplierId TEXT,
        batchNumber TEXT,
        expiryDate TEXT,
        purchaseDate TEXT NOT NULL,
        billNumber TEXT,
        quantityPurchased REAL NOT NULL,
        quantityRemaining REAL NOT NULL,
        unitCost REAL NOT NULL,
        gstRate REAL NOT NULL,
        subtotal REAL NOT NULL,
        gstAmount REAL NOT NULL,
        totalCost REAL NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (itemId) REFERENCES inventory_items(id),
        FOREIGN KEY (supplierId) REFERENCES suppliers(id)
      );

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        itemId TEXT NOT NULL,
        batchId TEXT,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        unitCost REAL NOT NULL,
        reference TEXT,
        notes TEXT,
        movementDate TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (itemId) REFERENCES inventory_items(id),
        FOREIGN KEY (batchId) REFERENCES inventory_batches(id)
      );

      CREATE TABLE IF NOT EXISTS service_consumables (
        id TEXT PRIMARY KEY,
        serviceId TEXT NOT NULL,
        inventoryItemId TEXT NOT NULL,
        quantity REAL NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (serviceId) REFERENCES services(id),
        FOREIGN KEY (inventoryItemId) REFERENCES inventory_items(id)
      );

      CREATE TABLE IF NOT EXISTS purchase_records (
        id TEXT PRIMARY KEY,
        purchaseDate TEXT NOT NULL,
        supplierId TEXT,
        supplierName TEXT,
        vendorName TEXT,
        billNumber TEXT,
        amount REAL NOT NULL DEFAULT 0,
        paymentMode TEXT NOT NULL,
        notes TEXT,
        documents TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS enquiries (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        customerName TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        vehicleType TEXT NOT NULL DEFAULT 'car',
        vehicleNumber TEXT,
        vehicleMake TEXT,
        vehicleModel TEXT,
        vehicleColor TEXT,
        interestedService TEXT,
        expectedBudget REAL NOT NULL DEFAULT 0,
        preferredVisitDate TEXT,
        followUpDate TEXT,
        notes TEXT,
        lostReason TEXT,
        customerId TEXT,
        vehicleId TEXT,
        convertedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id),
        FOREIGN KEY (vehicleId) REFERENCES vehicles(id)
      );

      CREATE TABLE IF NOT EXISTS enquiry_followups (
        id TEXT PRIMARY KEY,
        enquiryId TEXT NOT NULL,
        followupDate TEXT NOT NULL,
        note TEXT,
        nextFollowUpDate TEXT,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (enquiryId) REFERENCES enquiries(id)
      );

      CREATE TABLE IF NOT EXISTS job_cards (
        id TEXT PRIMARY KEY,
        jobNumber TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        jobDate TEXT NOT NULL,
        expectedDeliveryDate TEXT,
        expectedDeliveryTime TEXT,
        actualDeliveryDate TEXT,
        actualDeliveryTime TEXT,
        customerId TEXT NOT NULL,
        vehicleId TEXT NOT NULL,
        invoiceId TEXT,
        odometer TEXT,
        fuelLevel TEXT,
        keyReceived INTEGER NOT NULL DEFAULT 0,
        belongingsNote TEXT,
        approvalName TEXT,
        approvalDate TEXT,
        approvalNotes TEXT,
        workNotes TEXT,
        internalNotes TEXT,
        deliveryNotes TEXT,
        subTotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        taxableValue REAL NOT NULL DEFAULT 0,
        totalTax REAL NOT NULL DEFAULT 0,
        grandTotal REAL NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id),
        FOREIGN KEY (vehicleId) REFERENCES vehicles(id),
        FOREIGN KEY (invoiceId) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS job_card_items (
        id TEXT PRIMARY KEY,
        jobCardId TEXT NOT NULL,
        serviceId TEXT,
        inventoryItemId TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL,
        unitPrice REAL NOT NULL,
        gstRate REAL NOT NULL,
        sacCode TEXT,
        lineSubTotal REAL NOT NULL,
        lineTax REAL NOT NULL,
        lineTotal REAL NOT NULL,
        FOREIGN KEY (jobCardId) REFERENCES job_cards(id),
        FOREIGN KEY (serviceId) REFERENCES services(id),
        FOREIGN KEY (inventoryItemId) REFERENCES inventory_items(id)
      );

      CREATE TABLE IF NOT EXISTS job_card_photos (
        id TEXT PRIMARY KEY,
        jobCardId TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        caption TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (jobCardId) REFERENCES job_cards(id)
      );

      CREATE TABLE IF NOT EXISTS job_card_checklist_items (
        id TEXT PRIMARY KEY,
        jobCardId TEXT NOT NULL,
        label TEXT NOT NULL,
        checked INTEGER NOT NULL DEFAULT 0,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (jobCardId) REFERENCES job_cards(id)
      );

      CREATE TABLE IF NOT EXISTS job_card_status_history (
        id TEXT PRIMARY KEY,
        jobCardId TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (jobCardId) REFERENCES job_cards(id)
      );

      CREATE TABLE IF NOT EXISTS job_card_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        invoiceId TEXT NOT NULL,
        amount REAL NOT NULL,
        mode TEXT NOT NULL,
        reference TEXT,
        paymentDate TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (invoiceId) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        expenseDate TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        paymentMode TEXT NOT NULL,
        vendor TEXT,
        reference TEXT,
        notes TEXT,
        createdByUserId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (createdByUserId) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        cloudSnapshotIncluded INTEGER NOT NULL DEFAULT 0,
        cloudSnapshotAt TEXT,
        cloudSnapshotEntityCount INTEGER NOT NULL DEFAULT 0,
        cloudSnapshotRecordCount INTEGER NOT NULL DEFAULT 0,
        cloudSnapshotInvoiceCount INTEGER NOT NULL DEFAULT 0,
        cloudSnapshotError TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotencyKey TEXT NOT NULL UNIQUE,
        operationType TEXT NOT NULL,
        entity TEXT NOT NULL,
        localId TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        fileRefsJson TEXT,
        baseRevision INTEGER NOT NULL DEFAULT 0,
        attemptCount INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        createdAt TEXT NOT NULL,
        pushedAt TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING'
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        entity TEXT PRIMARY KEY,
        lastRevision INTEGER NOT NULL DEFAULT 0,
        lastSyncedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conflictId TEXT NOT NULL UNIQUE,
        entity TEXT NOT NULL,
        localId TEXT NOT NULL,
        localVersionJson TEXT NOT NULL,
        serverVersionJson TEXT NOT NULL,
        detectedAt TEXT NOT NULL,
        resolvedAt TEXT,
        resolution TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN'
      );

      CREATE TABLE IF NOT EXISTS sync_files (
        localPath TEXT PRIMARY KEY,
        fileId TEXT UNIQUE,
        entity TEXT,
        entityId TEXT,
        fileType TEXT,
        sha256 TEXT,
        sizeBytes INTEGER NOT NULL DEFAULT 0,
        uploadStatus TEXT NOT NULL DEFAULT 'PENDING',
        uploadedAt TEXT,
        lastError TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_device (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        deviceId TEXT NOT NULL,
        deviceName TEXT,
        deviceCode TEXT,
        cloudUrl TEXT,
        tokenCiphertext TEXT,
        connectedAt TEXT,
        lastPushAt TEXT,
        lastPullAt TEXT,
        lastError TEXT,
        approvalStatus TEXT NOT NULL DEFAULT 'APPROVED',
        lastStatus TEXT NOT NULL DEFAULT 'disconnected'
      );
`;

export const SCHEMA_COLUMNS = [
  { table: "users", column: "accessRoleId", definition: "TEXT" },
  { table: "invoice_items", column: "inventoryItemId", definition: "TEXT" },
  { table: "invoices", column: "jobCardId", definition: "TEXT" },
  { table: "invoices", column: "invoiceStatus", definition: "TEXT NOT NULL DEFAULT 'finalized'" },
  { table: "invoices", column: "cloudSyncStatus", definition: "TEXT NOT NULL DEFAULT 'local_only'" },
  { table: "invoices", column: "cloudRevision", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "invoices", column: "cloudSyncedAt", definition: "TEXT" },
  { table: "invoices", column: "cloudConflictId", definition: "TEXT" },
  { table: "invoices", column: "cancelledAt", definition: "TEXT" },
  { table: "invoices", column: "cancelledByUserId", definition: "TEXT" },
  { table: "invoices", column: "cancelReason", definition: "TEXT" },
  { table: "invoices", column: "replacementInvoiceId", definition: "TEXT" },
  { table: "invoices", column: "sourceInvoiceId", definition: "TEXT" },
  { table: "invoices", column: "sourceQuotationId", definition: "TEXT" },
  { table: "quotations", column: "customerName", definition: "TEXT" },
  { table: "quotations", column: "customerPhone", definition: "TEXT" },
  { table: "quotations", column: "customerEmail", definition: "TEXT" },
  { table: "quotations", column: "customerGstin", definition: "TEXT" },
  { table: "quotations", column: "customerAddress", definition: "TEXT" },
  { table: "quotations", column: "vehicleType", definition: "TEXT NOT NULL DEFAULT 'car'" },
  { table: "quotations", column: "vehicleNumber", definition: "TEXT" },
  { table: "quotations", column: "vehicleMake", definition: "TEXT" },
  { table: "quotations", column: "vehicleModel", definition: "TEXT" },
  { table: "quotations", column: "vehicleColor", definition: "TEXT" },
  { table: "quotation_items", column: "inventoryItemId", definition: "TEXT" },
  { table: "vehicles", column: "vehicleType", definition: "TEXT NOT NULL DEFAULT 'car'" },
  { table: "enquiries", column: "vehicleType", definition: "TEXT NOT NULL DEFAULT 'car'" },
  { table: "backups", column: "cloudSnapshotIncluded", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "backups", column: "cloudSnapshotAt", definition: "TEXT" },
  { table: "backups", column: "cloudSnapshotEntityCount", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "backups", column: "cloudSnapshotRecordCount", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "backups", column: "cloudSnapshotInvoiceCount", definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: "backups", column: "cloudSnapshotError", definition: "TEXT" },
  { table: "sync_device", column: "approvalStatus", definition: "TEXT NOT NULL DEFAULT 'APPROVED'" }
] as const;

export const INVOICES_JOB_CARD_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_jobCardId_unique ON invoices(jobCardId) WHERE jobCardId IS NOT NULL AND jobCardId <> ''";

export const DATA_TABLES = [
  "users",
  "access_roles",
  "settings",
  "customers",
  "vehicles",
  "services",
  "invoices",
  "invoice_drafts",
  "invoice_items",
  "quotations",
  "quotation_items",
  "payments",
  "expenses",
  "inventory_items",
  "inventory_batches",
  "inventory_movements",
  "suppliers",
  "service_consumables",
  "purchase_records",
  "enquiries",
  "enquiry_followups",
  "job_cards",
  "job_card_items",
  "job_card_photos",
  "job_card_checklist_items",
  "job_card_status_history",
  "backups",
  "sync_outbox",
  "sync_state",
  "sync_conflicts",
  "sync_files",
  "sync_device"
] as const;
