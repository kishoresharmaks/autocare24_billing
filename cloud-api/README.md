# Autocare24 Cloud Sync API - Shared Hosting Setup

This is the server-side API for offline-first multi-PC sync. The Windows desktop app continues to use its local SQLite database. The desktop connects only to this HTTPS API, and this API writes to MySQL/MariaDB on the shared host.

## 1. Node Version To Select

Select **Node.js 24 LTS** if your hosting panel offers it.

If Node.js 24 is not available, select **Node.js 22 LTS**.

Do **not** choose Node.js 20 for production now. As of May 5, 2026, Node.js 20 has reached end-of-life. The API package requires Node.js `>=22`.

Avoid odd-numbered Node versions such as 23 or 25 for production shared hosting.

## 2. What You Need From Hosting

- Node.js app support
- MySQL or MariaDB database
- HTTPS domain or subdomain
- File storage outside public web root, if available
- Terminal or SSH access to run `npm install` and migration commands

Recommended server URL:

```text
https://sync.yourdomain.com
```

Using a subdomain is cleaner than using a subfolder path.

## 3. Create MySQL Database

In cPanel or your hosting panel:

1. Open **MySQL Databases**.
2. Create a database, for example:

```text
cpaneluser_autocare24_sync
```

3. Create a database user, for example:

```text
cpaneluser_autocare24_user
```

4. Set a strong password.
5. Add the user to the database with all privileges.

Keep these values ready:

```text
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cpaneluser_autocare24_sync
DB_USER=cpaneluser_autocare24_user
DB_PASSWORD=your-strong-password
```

On most shared hosts, `DB_HOST` is `localhost`. If your host gives a different MySQL hostname, use that.

## 4. Upload API Files

Upload the full `cloud-api` folder to your hosting account.

Recommended location:

```text
/home/cpaneluser/autocare24-cloud-api
```

Do not place uploads inside `public_html`.

## 5. Configure Node App In Hosting Panel

In cPanel this is usually **Setup Node.js App**.

Use values like this:

```text
Node version: Node.js 24 LTS, or Node.js 22 LTS
Application mode: Production
Application root: /home/cpaneluser/autocare24-cloud-api
Application URL: https://sync.yourdomain.com
Application startup file: src/server.js
```

If your hosting panel asks only for a relative app root, enter the folder name your host expects, for example:

```text
autocare24-cloud-api
```

## 6. Environment Variables

Create these environment variables in the Node app panel, or create a `.env` file if your host supports it.

```text
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cpaneluser_autocare24_sync
DB_USER=cpaneluser_autocare24_user
DB_PASSWORD=your-strong-password
SYNC_REGISTRATION_KEY=make-a-long-private-device-key
UPLOAD_DIR=/home/cpaneluser/autocare24-sync-uploads
TOKEN_HASH_SECRET=make-a-different-long-private-token-hash-secret
MAX_BODY_BYTES=25165824
AUTH_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_WINDOW_MS=900000
DEVICE_REGISTRATION_RATE_LIMIT_MAX=10
DEVICE_REGISTRATION_RATE_LIMIT_WINDOW_MS=900000
TRUSTED_PROXY_IPS=
GITHUB_RELEASE_TOKEN=github_pat_private_release_read_token
GITHUB_RELEASE_OWNER=kishoresharmaks
GITHUB_RELEASE_REPO=autocare24_billing
GITHUB_RELEASE_TAG=
INVOICE_PREFIX=AUTOCARE24
WHATSAPP_ENABLED=false
WHATSAPP_GRAPH_VERSION=v20.0
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_DISPLAY_PHONE_NUMBER=
WHATSAPP_DOCUMENT_MAX_BYTES=18874368
```

Important:

- If your hosting panel automatically sets `PORT`, leave `PORT` unset. If it asks you for a port, use the panel-assigned port. For local testing, the API defaults to `8080`.
- `SYNC_REGISTRATION_KEY` is what you enter in the desktop app when connecting a PC.
- Use a long private value, not a simple password.
- `UPLOAD_DIR` should be outside `public_html`.
- `TOKEN_HASH_SECRET` protects stored device token hashes. Keep it stable after deployment.
- `MAX_BODY_BYTES` defaults to 24 MB so the 18 MB WhatsApp PDF limit still has room for base64 JSON overhead.
- Auth and device registration rate limits default to 10 attempts per 15 minutes per IP.
- Loopback proxies (`127.0.0.1` and `::1`) are trusted for `X-Forwarded-For`/`X-Real-IP` so local hosting panels can show the real client IP instead of `127.0.0.1`.
- Add only known reverse proxy IPs to `TRUSTED_PROXY_IPS`; the API trusts forwarded IP headers only from loopback or those configured proxy IPs.
- `GITHUB_RELEASE_TOKEN` is server-only. Use a GitHub fine-grained token for the private `autocare24_billing` repository with **Contents: Read-only** for update downloads. Do not put this token in the desktop app.
- Leave `GITHUB_RELEASE_TAG` empty to serve the latest published GitHub Release, or set it to a fixed tag like `v0.1.14` for controlled rollout.
- `INVOICE_PREFIX` is optional. The desktop also sends its configured invoice prefix during finalization.
- WhatsApp Business API is optional. Set `WHATSAPP_ENABLED=true` only after adding the Meta access token, phone number ID, business account ID, webhook verify token, and app secret.
- Invoice/job-card PDF sharing uses Meta media upload and requires approved document-header templates named `invoice_pdf_ready` and `job_card_pdf_ready`.
- Configure the Meta webhook callback URL as `https://sync.yourdomain.com/api/v1/whatsapp/webhook`.
- Keep HTTPS enabled through the hosting panel or a TLS-terminating reverse proxy. The desktop app rejects normal HTTP except for local development.

## 7. Install Dependencies

Open Terminal or SSH in the API folder:

```bash
cd /home/cpaneluser/autocare24-cloud-api
npm install --omit=dev --no-audit --no-fund
```

If your hosting panel has an **NPM Install** button, you can use that instead.

## 8. Run Database Migration

Run this once after setting the environment variables:

```bash
npm run migrate
```

This creates:

- `businesses`
- `devices`
- `business_records`
- `sync_revisions`
- `number_sequences`
- `file_metadata`
- `idempotency_keys`
- `sync_conflicts`
- `audit_log`
- `whatsapp_settings`
- `whatsapp_conversations`
- `whatsapp_messages`
- `whatsapp_message_events`
- `whatsapp_templates`

It also seeds the first business and number sequences for invoices, quotations, and job cards.

## 9. Start Or Restart The Node App

In your hosting panel, click:

```text
Restart
```

Or from terminal:

```bash
npm start
```

On shared hosting, prefer the hosting panel restart button because the panel manages the background process.

## 10. Test The API

Open this URL in a browser:

```text
https://sync.yourdomain.com/api/v1/health
```

Expected result:

```json
{
  "data": {
    "ok": true,
    "version": "v1",
    "serverTime": "..."
  }
}
```

If this URL does not work, do not connect the desktop app yet.

## 11. Private App Updates

The Windows app checks:

```text
https://sync.yourdomain.com/updates/win/latest.yml
```

That endpoint is public, but the GitHub token stays only on this server. The API reads release assets from the private GitHub repository and streams `latest.yml`, the installer, and the blockmap to installed apps.

To publish a Windows update from your build PC:

```powershell
npm.cmd version patch --no-git-tag-version
$env:GH_TOKEN="your-github-token-with-contents-read-write"
npm.cmd run release:windows
Remove-Item Env:\GH_TOKEN
```

The publish token on the build PC needs **Contents: Read and write** for the private repository. The server token can be read-only.

Important first-time note: any already-installed app version that still points directly to GitHub Releases cannot update from the private repo. Install the new generic-feed installer once manually; after that, future updates can come through **Check for updates**.

## 12. Connect First Desktop PC

In the Windows billing app:

1. Open **Settings**.
2. Open **Cloud Sync**.
3. Enter Cloud URL:

```text
https://sync.yourdomain.com
```

Do not add `/api/v1` in the desktop Cloud URL.

4. Enter Device Name, for example:

```text
Office PC 1
```

5. Enter the same `SYNC_REGISTRATION_KEY`.
6. Click **Connect Device**.
7. Click **Sync Now** if it does not start automatically.

The first PC will seed local records to the cloud.

## 13. Connect Second Desktop PC

On the second PC:

1. Install/open the billing app.
2. Go to **Settings > Cloud Sync**.
3. Use the same Cloud URL.
4. Use a different Device Name, for example:

```text
Office PC 2
```

5. Enter the same registration key.
6. Click **Connect Device**.
7. The device will show **Waiting for owner approval**.
8. On an already approved owner PC, open **Settings > Cloud Status > Cloud Devices**.
9. Enter the cloud owner username/password and approve the pending device.
10. On the second PC, click **Check approval**, then run **Import local data** if needed.

The registration key only requests access. After owner/users exist, it does not give business-data access until an owner approves the device.

## 14. Device Approval Security

Device states are stored in the `devices` table:

- `APPROVED`: device token can read/sync business data.
- `PENDING`: token is saved, but it can only check its own approval status.
- `REVOKED`: token cannot access data.

Existing non-revoked devices are migrated as `APPROVED`, so current PCs are not locked out by this update.

If the registration key is suspected stolen:

1. Change `SYNC_REGISTRATION_KEY` in cPanel.
2. Restart the Node app.
3. Open **Settings > Cloud Status > Cloud Devices** from a trusted approved PC.
4. Revoke unknown pending/approved devices.

If an active device token is suspected stolen, revoke that device from **Cloud Devices**.

Emergency phpMyAdmin fallback:

```sql
UPDATE devices
SET is_revoked = TRUE,
    token_hash = '',
    approval_status = 'REVOKED'
WHERE business_id = 1;
```

After revoking every device, at least one trusted PC must be approved again from phpMyAdmin or by temporarily using a still-approved PC. Change the registration key before reconnecting trusted PCs.

Manual migration SQL if terminal access is not available. Run the full `UPDATE devices SET approval_status...` line only during the first upgrade, before approving new devices:

```sql
ALTER TABLE devices ADD COLUMN approval_status ENUM('APPROVED','PENDING','REVOKED') NOT NULL DEFAULT 'APPROVED';
ALTER TABLE devices ADD COLUMN approval_requested_at DATETIME DEFAULT NULL;
ALTER TABLE devices ADD COLUMN approved_at DATETIME DEFAULT NULL;
ALTER TABLE devices ADD COLUMN approved_by_user_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE devices ADD COLUMN registration_ip VARCHAR(45) DEFAULT NULL;

UPDATE devices
SET approval_status = CASE WHEN is_revoked THEN 'REVOKED' ELSE 'APPROVED' END;

UPDATE devices
SET approval_requested_at = COALESCE(approval_requested_at, created_at)
WHERE approval_requested_at IS NULL;

UPDATE devices
SET approved_at = COALESCE(approved_at, last_seen_at, created_at)
WHERE approval_status = 'APPROVED' AND approved_at IS NULL;

UPDATE devices
SET is_revoked = FALSE
WHERE approval_status = 'PENDING';
```

If phpMyAdmin says a column already exists, skip that `ALTER TABLE` line and run the remaining lines.

## 15. Final Invoice Rule

Final invoices are cloud-issued now.

- The desktop saves offline work as an invoice draft.
- The desktop calls `POST /api/v1/invoices/finalize` before creating a final invoice.
- The API checks synced stock batches, reserves stock, and assigns the official invoice number inside one MySQL transaction.
- Before assigning a number, the desktop sends the highest invoice sequence already used on that PC. The API aligns `number_sequences.last_number` so it does not reuse existing local numbers.
- If the API is unreachable, the desktop keeps the bill as a draft and shows: `Internet required to create final invoice number. Saved as draft.`
- Print, PDF, and WhatsApp sharing stay blocked for old `LOCAL-...` invoices until they are repaired.
- Old temporary invoices can be repaired in the desktop by choosing **Finalize with cloud** or **Move back to draft**.

Do not create final invoice numbers directly in MySQL or in the desktop app.

## 16. File Uploads

Synced files use this API:

- Invoice logo
- Signature
- Watermark
- Job-card photos
- Purchase-record PDF/image documents

Purchase records are synced as the `purchase_records` business-record entity. They are reference documents only and are not used by the stock, expense, profit, or invoice-total calculations.

Quick cash stock sales use `inventory_movements` with `type: "stock_sale"`, `saleAmount`, `saleUnitPrice`, and `paymentMode`. They deduct stock without creating a tax invoice, and reports include them separately from invoice sales.

Files are stored under:

```text
UPLOAD_DIR=/home/cpaneluser/autocare24-sync-uploads
```

Make sure this folder is writable by the Node app.

## 17. WhatsApp Business API

The desktop app uses the cloud API for WhatsApp Connect. Meta credentials stay on the server, and the desktop never receives the WhatsApp access token.

Authenticated desktop endpoints:

- `GET /api/v1/whatsapp/status`
- `GET /api/v1/whatsapp/conversations`
- `GET /api/v1/whatsapp/conversations/:id/messages`
- `POST /api/v1/whatsapp/messages`
- `GET /api/v1/whatsapp/templates`
- `POST /api/v1/whatsapp/templates/sync`

Public Meta webhook endpoints:

- `GET /api/v1/whatsapp/webhook`
- `POST /api/v1/whatsapp/webhook`

Approved templates are required for first contact and notifications. Freeform text replies are allowed only after an inbound customer message opens the WhatsApp customer-service window.

## 18. Production Checklist

Before using this with real billing data:

- Health URL returns OK over HTTPS.
- Update feed URL returns `latest.yml` after a private release is published.
- MySQL migration completed without errors.
- `UPLOAD_DIR` is writable and not public.
- First PC can connect and sync.
- Second PC becomes pending first, then can sync only after owner approval.
- Unknown devices can be revoked from **Cloud Devices**.
- Offline invoice work stays as a draft.
- Final invoice creation fails clearly if the cloud API is not reachable.
- Final invoice receives an official cloud number before it is stored as official locally.
- Print/PDF/WhatsApp stay blocked for any old `LOCAL-...` invoice until repaired.
- Two PCs do not create duplicate invoice numbers.

## 19. Troubleshooting

### Health URL shows 404

Check the Node app root and startup file. The startup file must be:

```text
src/server.js
```

### Database connection fails

Check:

```text
DB_HOST
DB_NAME
DB_USER
DB_PASSWORD
```

On cPanel, database and user names usually include your cPanel username prefix.

### Desktop says Cloud URL invalid

Use HTTPS:

```text
https://sync.yourdomain.com
```

Do not use plain `http://` on production hosting.

### Device connect fails

Check that the registration key entered in desktop exactly matches:

```text
SYNC_REGISTRATION_KEY
```

### Device says waiting for owner approval

This is expected for a new PC after the cloud owner account exists. Approve it from an already approved owner PC in **Settings > Cloud Status > Cloud Devices**.

### File upload fails

Check that `UPLOAD_DIR` exists or can be created by Node, and that it is writable.

### Shared hosting does not support long-running Node apps

Keep the same `/api/v1` API contract and implement the backend in PHP later. The desktop app does not need to change if endpoints and response formats stay the same.
