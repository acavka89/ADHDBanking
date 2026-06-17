# SafeSpend Supabase setup

## 1. Local environment

Copy `.env.example` to `.env.local` and fill the public browser values:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_AUTH_REDIRECT_URL=http://localhost:5173
```

Restart Vite after changing `.env.local`.

For Vercel, add the same values under:

```text
Project Settings -> Environment Variables
```

Add both variables for Production, Preview and Development as needed, then redeploy:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_AUTH_REDIRECT_URL=https://your-vercel-app.vercel.app
```

Also add the same live Vercel URL in Supabase:

```text
Supabase -> Authentication -> URL Configuration
```

Set **Site URL** to your production Vercel URL and add these **Redirect URLs**:

```text
https://your-vercel-app.vercel.app
http://localhost:5173
```

For Vercel preview deployments, add a wildcard redirect URL for your preview domain if you use previews.

## 2. Link the Supabase project

The Supabase CLI is not installed globally in this repo, so use `npx`:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

## 3. Set Edge Function secrets

Create `supabase/functions/.env` locally from `.env.example`, then set secrets:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

Required secrets:

- `GOCARDLESS_SECRET_ID`
- `GOCARDLESS_SECRET_KEY`
- `GOCARDLESS_REDIRECT_URL`
- `TRADING212_ENV` set to `demo` or `live`
- `TRADING212_API_KEY`
- `TRADING212_API_SECRET`

For a public product, do not store per-user Trading 212 API secrets as plain text. Use a proper encrypted secret store or a provider-side OAuth-style flow if Trading 212 offers one for your release model.

## 4. Deploy Edge Functions

```bash
npx supabase functions deploy gocardless-start
npx supabase functions deploy gocardless-sync
npx supabase functions deploy trading212-sync
```

## 5. Password login

The app now shows a login screen before SafeSpend loads.

In Supabase, make sure Email/Password auth is enabled:

```text
Authentication -> Providers -> Email
```

For a personal prototype, either create the user in Supabase Authentication manually, or use the app's "Create this account instead" option once. If Supabase requires email confirmation, confirm the user in the dashboard or disable email confirmations for this personal prototype.

## 6. Test the PWA flow

1. Open the app.
2. Sign in with your Supabase email/password.
3. Go to More.
4. Use Connect for GoCardless bank consent if a provider becomes available.
5. Use Sync bank transactions after consent returns.
6. Use Sync for Trading 212 after secrets are set.

## Notes

- GoCardless bank access and Trading 212 calls run only from Supabase Edge Functions.
- The PWA uses only Supabase public URL and anon/publishable key.
- Row Level Security is enabled for all user-owned tables.
- This is information and budgeting support only. It is not financial advice.
