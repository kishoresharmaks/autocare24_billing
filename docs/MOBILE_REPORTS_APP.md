# Autocare24 Reports Mobile App

The mobile app lives in `mobile/`. It is an owner-only Expo React Native app for reports, profit data, invoice viewing, and cloud device activity.

## What The App Can Do

- Request phone access with cloud URL, phone name, and registration key.
- Show pending, approved, and revoked device states clearly.
- Let the owner log in after the phone is approved.
- Display Reports, Profit & Expense, Invoices, and Cloud Devices.
- Search cloud invoices by invoice number, customer, phone, vehicle number, or vehicle type.
- Open invoice detail with customer, vehicle, item rows, tax summary, payments, notes, and cancellation status.
- Share a plain text invoice summary through the Android share sheet.
- Approve pending or revoked cloud devices.
- Revoke other approved cloud devices.

## What The App Cannot Do

- Create, edit, cancel, or record payments against invoices.
- Generate invoice PDFs or run WhatsApp invoice actions.
- Manage users or roles.
- Revoke the current phone from inside itself.
- Run backup or restore tools.
- Store the owner password permanently.

## Real Phone Testing

1. Install Expo Go on the Android phone.
2. Update Expo Go from the Play Store before scanning. Expo Go must support the same Expo SDK as the mobile app.
3. Connect the phone and PC to the same Wi-Fi.
4. Open PowerShell in `mobile/` and run `npm.cmd run start`.
5. Scan the QR code in Expo Go.
6. Enter `https://sync.autocare24.in`, phone name, and registration key.
7. Approve the phone from the desktop owner PC.
8. Tap Check approval on the phone.
9. Log in with the owner username and password.
10. Verify Reports, Profit & Expense, Invoices, Devices, Settings, and device approve/revoke actions.
11. Search invoices by invoice number, customer name, phone, and vehicle number.
12. Open an invoice detail page and confirm items, totals, tax, payments, notes, balance due, and cancel status render correctly.
13. Tap Share on the invoice detail page and confirm the Android share sheet opens with the visible invoice summary only.
14. Rotate/check the phone on narrow and wide layouts so cards, invoice rows, device rows, tabs, and long amounts stay readable without overlapping.

Use LAN mode by default because Expo tunnel depends on ngrok and can fail with `remote gone away`. If phone and PC cannot be on the same Wi-Fi, open PowerShell in `mobile/` and try `npm.cmd run start:tunnel`.

If Expo Go shows `incompatible SDK version`, update Expo Go first, or install the matching Android Expo Go build from `https://expo.dev/go` for SDK 55. Then stop the dev server and restart with `npm.cmd run start` from `mobile/` so Metro cache is cleared. If the phone cannot update Expo Go, use the final APK flow instead of Expo Go.

The mobile app is Android-only. Ignore the Expo web URL; web preview is disabled because this app is meant for real-phone Android testing.

## Final APK

Open PowerShell in `mobile/` and run `npm.cmd run build:android:preview` to build the Android preview APK through EAS. This uses `npx eas-cli@latest`, so EAS CLI is downloaded only for the APK build and is not installed with normal mobile dependencies.
