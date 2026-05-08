# Autocare24 Billing POS

Production billing and reporting software for Autocare24 Bike & Car Detailing Studio.

## Project Structure

- `src/` - Electron desktop app, renderer UI, local database, cloud sync, billing, stock, settings, and reports.
- `cloud-api/` - Node.js MySQL/MariaDB sync API and database schema for shared cloud records.
- `mobile/` - Expo owner reports mobile app source.
- `scripts/` - Local verification scripts for invoice, profit, and backup flows.
- `docs/` - User, training, mobile, and calculation documentation.

## Common Commands

```bash
npm install
npm run build
npm run test:invoice
npm run test:profit
npm run test:shared
npm run package
```

Cloud API:

```bash
npm --prefix cloud-api install
npm --prefix cloud-api start
```

Mobile app:

```bash
npm --prefix mobile install
npm --prefix mobile run typecheck
npm --prefix mobile start
```

## Notes

- Private `.env` files, generated installers, build folders, dependency folders, and local agent caches are intentionally not tracked.
- Use `cloud-api/.env.example` as the starting point for cloud API configuration.
