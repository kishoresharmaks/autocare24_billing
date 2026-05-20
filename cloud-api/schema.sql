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
  KEY idx_devices_token_hash (token_hash),
  KEY idx_devices_business_created (business_id, created_at),
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
  KEY idx_business_records_revision (business_id, revision),
  KEY idx_business_records_entity_active (business_id, entity, deleted_at, revision)
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
  KEY idx_sync_revisions_record (business_id, entity, record_id, id),
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_file_metadata_entity (business_id, entity, entity_id, created_at)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(80) NOT NULL,
  business_id INT NOT NULL,
  device_id VARCHAR(36) NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, idempotency_key),
  KEY idx_idempotency_business_created (business_id, created_at)
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
  KEY idx_conflicts_device (business_id, device_id, status),
  KEY idx_conflicts_device_created (business_id, device_id, status, created_at)
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_log_business_created (business_id, created_at),
  KEY idx_audit_log_entity (business_id, entity, entity_id, created_at)
);

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  business_id INT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  phone_number_id VARCHAR(80) NOT NULL DEFAULT '',
  business_account_id VARCHAR(80) NOT NULL DEFAULT '',
  display_phone_number VARCHAR(40) NOT NULL DEFAULT '',
  graph_version VARCHAR(20) NOT NULL DEFAULT '',
  webhook_verified_at DATETIME DEFAULT NULL,
  last_template_sync_at DATETIME DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_whatsapp_settings_business FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id VARCHAR(36) PRIMARY KEY,
  business_id INT NOT NULL,
  customer_id VARCHAR(36) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL,
  display_name VARCHAR(160) NOT NULL DEFAULT '',
  last_message_preview VARCHAR(500) NOT NULL DEFAULT '',
  last_message_at DATETIME DEFAULT NULL,
  last_inbound_at DATETIME DEFAULT NULL,
  unread_count INT NOT NULL DEFAULT 0,
  status ENUM('open','archived') NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_whatsapp_conversation_phone (business_id, phone),
  KEY idx_whatsapp_conversations_recent (business_id, last_message_at),
  KEY idx_whatsapp_conversations_customer (business_id, customer_id),
  CONSTRAINT fk_whatsapp_conversations_business FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id VARCHAR(36) PRIMARY KEY,
  business_id INT NOT NULL,
  conversation_id VARCHAR(36) NOT NULL,
  whatsapp_message_id VARCHAR(120) DEFAULT NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  message_type ENUM('text','template','image','document','unknown') NOT NULL DEFAULT 'text',
  status ENUM('queued','sent','delivered','read','failed','received') NOT NULL DEFAULT 'queued',
  phone VARCHAR(32) NOT NULL,
  text_body TEXT,
  template_name VARCHAR(120) NOT NULL DEFAULT '',
  source_type VARCHAR(40) NOT NULL DEFAULT '',
  source_id VARCHAR(80) NOT NULL DEFAULT '',
  error_message VARCHAR(500) NOT NULL DEFAULT '',
  payload JSON,
  timestamp DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_whatsapp_message_external (business_id, whatsapp_message_id),
  KEY idx_whatsapp_messages_conversation (business_id, conversation_id, timestamp),
  KEY idx_whatsapp_messages_status (business_id, status),
  CONSTRAINT fk_whatsapp_messages_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_whatsapp_messages_conversation FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_message_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,
  message_id VARCHAR(36) DEFAULT NULL,
  whatsapp_message_id VARCHAR(120) NOT NULL DEFAULT '',
  event_type VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT '',
  payload JSON,
  occurred_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_whatsapp_events_message (business_id, whatsapp_message_id),
  CONSTRAINT fk_whatsapp_events_business FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  business_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  language_code VARCHAR(20) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT '',
  category VARCHAR(40) NOT NULL DEFAULT '',
  components JSON,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, name, language_code),
  KEY idx_whatsapp_templates_status (business_id, status),
  CONSTRAINT fk_whatsapp_templates_business FOREIGN KEY (business_id) REFERENCES businesses(id)
);
