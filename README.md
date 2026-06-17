# SafeSpend ADHD Banking PWA

A mobile-first, local-first React PWA prototype based on the SafeSpend product brief.

## What is wired now

- Dashboard with calculated safe-to-spend guidance
- Current pay-cycle plan with protected allocations
- SafeSpend Score with component breakdown
- Recovery mode with three routes
- Possible-savings cards and user responses
- Purchase pause and wishlist delays
- Editable transaction categories and ADHD-friendly classifications
- Recurring-payment classifications
- Local JSON import/export
- LocalStorage persistence
- PWA manifest and offline service worker

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL in your browser.

## Build

```bash
npm run build
```

The production files will be generated in `dist/`.

## Important notes

This is a frontend prototype. It does **not** connect to Lloyds, Trading 212, Gmail, Proton, Open Banking, or any real financial account yet.

For real bank connections, the next stage should add Supabase authentication, database tables, Edge Functions and GoCardless Bank Account Data for Lloyds/supported UK banks. Do not put banking tokens or provider secrets directly in the frontend.

Information and budgeting support only. This is not financial advice.

## Suggested next wiring stages

1. Replace seed data with a small backend database.
2. Add user authentication.
3. Add Open Banking provider consent flow.
4. Add transaction categorisation rules.
5. Add notification/reminder logic for cooling-off items and upcoming bills.
6. Add Trading 212 portfolio import using their available API/export options.
7. Add encrypted personal data storage and backup/export.
