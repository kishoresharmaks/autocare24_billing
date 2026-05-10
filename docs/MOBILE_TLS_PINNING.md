# Mobile TLS Pinning Notes

## Purpose

TLS public-key pinning is used by the mobile owner app to make sure cloud API calls go only to the expected HTTPS hosts. It protects device approval, owner login, invoices, reports, dues, stock, and device tokens from fake network interception.

Normal HTTPS is still required. Strict pinning adds one more check: the server certificate public key must match one of the approved SHA-256 hashes built into the APK.

## Allowed Cloud API Domains

The mobile app is configured to allow these cloud API hosts:

```text
sync.autocare24.in
sync.nexusnation.in
```

These hosts cover API endpoints such as:

```text
https://sync.autocare24.in/api/v1/health
https://sync.autocare24.in/api/v1/auth/devices
https://sync.autocare24.in/api/v1/reports
https://sync.autocare24.in/api/v1/invoices
https://sync.autocare24.in/api/v1/inventory/dashboard
```

The same paths also work when the base URL is `https://sync.nexusnation.in`.

## Current Pin Values

Recorded on: 2026-05-10

```powershell
$env:EXPO_PUBLIC_CLOUD_API_PINNED_HOSTS="sync.autocare24.in,sync.nexusnation.in"
$env:EXPO_PUBLIC_CLOUD_API_PUBLIC_KEY_HASHES="8Wtl5po3Sp+GtUK/FT0CxkM5EqGhVbt+Nel3AclIkvE=,kZwN96eHtZftBWrOZUsd6cA4es80n3NzSk/XtYz2EqQ=,PG9X5IuFPYOpqWmqVEzKKutJuVZXx6h6Gjqxea9ifOk=,kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4="
$env:EXPO_PUBLIC_REQUIRE_TLS_PINNING="1"
```

Pin source:

```text
sync.autocare24.in leaf certificate:
8Wtl5po3Sp+GtUK/FT0CxkM5EqGhVbt+Nel3AclIkvE=

sync.autocare24.in Let's Encrypt R12 intermediate:
kZwN96eHtZftBWrOZUsd6cA4es80n3NzSk/XtYz2EqQ=

sync.nexusnation.in leaf certificate:
PG9X5IuFPYOpqWmqVEzKKutJuVZXx6h6Gjqxea9ifOk=

sync.nexusnation.in Google Trust Services WE1 intermediate:
kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=
```

These values are also stored in `mobile/eas.json` for the `preview` and `production` build profiles.

## When To Regenerate

You do not need to generate pins for every normal code change.

Regenerate or verify pins:

- Before a production APK release.
- Before the current SSL certificate expires or renews.
- After changing hosting, CDN, SSL provider, or cloud API domain.
- If the app shows a TLS pinning failure.

The `sync.autocare24.in` certificate observed on 2026-05-10 expires on 2026-08-04. Check the live certificate again before building a release after that date.

## How To Regenerate

Use OpenSSL to fetch the chain:

```powershell
"Q" | openssl s_client -servername sync.autocare24.in -connect sync.autocare24.in:443 -showcerts
"Q" | openssl s_client -servername sync.nexusnation.in -connect sync.nexusnation.in:443 -showcerts
```

For each certificate to pin, calculate the SPKI SHA-256 base64 hash:

```powershell
openssl x509 -in cert.pem -pubkey -noout -out pubkey.pem
openssl pkey -pubin -in pubkey.pem -outform DER -out spki.der
openssl dgst -sha256 -binary -out spki.sha256.bin spki.der
openssl base64 -A -in spki.sha256.bin
```

Keep at least two valid hashes. The current setup keeps four hashes because two domains are allowed.

## Build Reminder

After changing pin values, rebuild and reinstall the APK:

```powershell
npm.cmd --prefix mobile run build:android:preview
```

If hashes are wrong and `EXPO_PUBLIC_REQUIRE_TLS_PINNING="1"` is enabled, the mobile app will block cloud API access.
