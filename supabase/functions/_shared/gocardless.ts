import { requireEnv } from './cors.ts';

const baseUrl = 'https://bankaccountdata.gocardless.com/api/v2';

export async function gocardlessToken() {
  const response = await fetch(`${baseUrl}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      secret_id: requireEnv('GOCARDLESS_SECRET_ID'),
      secret_key: requireEnv('GOCARDLESS_SECRET_KEY'),
    }),
  });

  if (!response.ok) throw new Error(`GoCardless token failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<{ access: string; refresh: string }>;
}

export async function gcFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) throw new Error(`GoCardless ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}
