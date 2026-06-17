import { adminClient, getUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse, requireEnv } from '../_shared/cors.ts';

function trading212BaseUrl() {
  return Deno.env.get('TRADING212_ENV') === 'live'
    ? 'https://live.trading212.com/api/v0'
    : 'https://demo.trading212.com/api/v0';
}

async function t212Fetch(path: string) {
  const apiKey = requireEnv('TRADING212_API_KEY');
  const apiSecret = requireEnv('TRADING212_API_SECRET');
  const credentials = btoa(`${apiKey}:${apiSecret}`);
  const response = await fetch(`${trading212BaseUrl()}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
    },
  });

  if (!response.ok) throw new Error(`Trading 212 ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    const supabase = adminClient();
    const [summary, positions] = await Promise.all([
      t212Fetch('/equity/account/summary'),
      t212Fetch('/equity/portfolio'),
    ]);

    const { data: account, error: accountError } = await supabase
      .from('investment_accounts')
      .upsert({
        user_id: user.id,
        provider: 'trading212',
        account_name: summary?.accountId ? `Trading 212 ${summary.accountId}` : 'Trading 212',
        currency: summary?.currencyCode || 'GBP',
        cash_balance: Number(summary?.free || summary?.cash || 0),
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider,account_name' })
      .select()
      .single();
    if (accountError) throw accountError;

    const rows = (Array.isArray(positions) ? positions : []).map((position: Record<string, unknown>) => ({
      user_id: user.id,
      investment_account_id: account.id,
      ticker: String(position.ticker || position.instrumentCode || position.shortName || 'UNKNOWN'),
      quantity: Number(position.quantity || 0),
      average_price: Number(position.averagePrice || position.avgPrice || 0),
      current_price: Number(position.currentPrice || position.price || 0),
      pnl: Number(position.ppl || position.result || 0),
      raw: position,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length) {
      const { error } = await supabase
        .from('investment_positions')
        .upsert(rows, { onConflict: 'user_id,investment_account_id,ticker' });
      if (error) throw error;
    }

    return jsonResponse({ account: account.account_name, positions: rows.length });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
