CREATE TABLE IF NOT EXISTS businesses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(36) PRIMARY KEY,
  business_id INT NOT NULL,
  name VARCHAR(100),
  device_code VARCHAR(32),
  token_hash VARCHAR(128) NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE,
  approval_status ENUM('APPROVED','PENDING','REVOKED') NOT NULL DEFAULT 'APPROVED',
  approval_requested_at DATETIME DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  approved_by_user_id VARCHAR(36) DEFAULT NULL,
  registration_ip VARCHAR(45) DEFAULT NULL,
  last_seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_devices_business FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE TABLE IF NOT EXISTS business_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,
  entity VARCHAR(50) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  data JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_business_record (business_id, entity, record_id),
  KEY idx_business_records_revision (business_id, revision)
);

CREATE TABLE IF NOT EXISTS sync_revisions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,
  device_id VARCHAR(36) NOT NULL,
  entity VARCHAR(50) NOT NULL,
  operation ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sync_revisions_business (business_id, id),
  CONSTRAINT fk_sync_revisions_device FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS number_sequences (
  business_id INT NOT NULL,
  sequence_key VARCHAR(50) NOT NULL,
  prefix VARCHAR(20),
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, sequence_key)
);

CREATE TABLE IF NOT EXISTS file_metadata (
  id VARCHAR(36) PRIMARY KEY,
  business_id INT NOT NULL,
  entity VARCHAR(50),
  entity_id VARCHAR(36),
  file_type ENUM('LOGO','SIGNATURE','WATERMARK','PHOTO','DOCUMENT') NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  size_bytes BIGINT,
  sha256 VARCHAR(64),
  storage_path VARCHAR(500),
  uploaded_by VARCHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(80) PRIMARY KEY,
  business_id INT NOT NULL,
  device_id VARCHAR(36) NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id VARCHAR(36) PRIMARY KEY,
  business_id INT NOT NULL,
  device_id VARCHAR(36) NOT NULL,
  entity VARCHAR(50) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  local_version JSON NOT NULL,
  server_version JSON NOT NULL,
  status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
  resolution ENUM('KEEP_LOCAL','KEEP_SERVER','MANUAL') DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  KEY idx_conflicts_device (business_id, device_id, status)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,
  device_id VARCHAR(36),
  user_label VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(50),
  entity_id VARCHAR(36),
  before_state JSON,
  after_state JSON,
  ip_address VARCHAR(45),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
