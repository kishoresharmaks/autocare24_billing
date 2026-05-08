# Autocare24 Reports Mobile

Owner-only React Native app for Autocare24 cloud reports, profit data, invoice viewing, and cloud device activity.

## Real Phone Testing

1. Install dependencies:
   `npm.cmd install --no-audit --no-fund`
2. Update Expo Go from the Play Store. It must support the current Expo SDK.
3. Connect the phone and PC to the same Wi-Fi.
4. Start Expo for a real phone:
   `npm.cmd run start`
5. Scan the QR code in Expo Go.
6. Use cloud URL `https://sync.autocare24.in`, enter a phone name, and enter the registration key.
7. Approve the phone from the desktop owner PC.
8. Log in with the owner account and verify Reports, Profit, Invoices, Devices, Settings, and device approve/revoke actions.

If Expo Go shows `incompatible SDK version`, update Expo Go first, or install the matching Android Expo Go build from `https://expo.dev/go` for SDK 55. Then stop the dev server and restart it so Metro cache is cleared. If the phone cannot update Expo Go, build and install the APK instead.

If LAN does not work, run `npm.cmd run start:tunnel` from this `mobile/` folder. Tunnel mode depends on ngrok, so `remote gone away` means the tunnel service failed and LAN or APK testing is the better path.

Use the QR code in Expo Go and ignore the web URL printed by Expo.

## APK Build

Use the preview APK profile:

`npm.cmd run build:android:preview`

## iOS Build

Use the preview iOS profile:

`npm.cmd run build:ios:preview`

EAS iOS builds need an Apple Developer account and Apple signing credentials. On Windows, the `.ipa` is built by EAS cloud, not locally.

To request Android APK and iOS builds together:

`npm.cmd run build:all:preview`

The mobile app does not create or edit invoices, users, or backups. Device approve/revoke is owner-only, and the current phone cannot revoke itself from inside the app.
