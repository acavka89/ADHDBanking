import { adminClient, getUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { gcFetch, gocardlessToken } from '../_shared/gocardless.ts';

function merchantName(tx: Record<string, unknown>) {
  return String(
    tx.remittanceInformationUnstructured ||
      tx.creditorName ||
      tx.debtorName ||
      tx.proprietaryBankTransactionCode ||
      'Bank transaction'
  );
}

function categoryFor(name: string, amount: number) {
  const lower = name.toLowerCase();
  if (amount > 0) return 'Income';
  if (lower.includes('rent') || lower.includes('mortgage')) return 'Housing';
  if (lower.includes('aldi') || lower.includes('tesco') || lower.includes('sainsbury')) return 'Food shopping';
  if (lower.includes('uber') || lower.includes('train') || lower.includes('fuel')) return 'Transport';
  if (lower.includes('netflix') || lower.includes('spotify') || lower.includes('subscription')) return 'Subscriptions';
  return 'Other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    const body = await req.json().catch(() => ({}));
    const supabase = adminClient();
    const { access } = await gocardlessToken();

    const connectionQuery = supabase
      .from('bank_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'gocardless')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    const { data: connection, error: connectionError } = await connectionQuery;
    if (connectionError || !connection) throw new Error('No GoCardless bank connection found');

    const requisitionId = body.requisitionId || connection.requisition_id;
    const requisition = await gcFetch(`/requisitions/${requisitionId}/`, access);
    const accountIds = requisition.accounts || [];
    let transactionCount = 0;

    for (const externalAccountId of accountIds) {
      const [details, balances, transactions] = await Promise.all([
        gcFetch(`/accounts/${externalAccountId}/details/`, access).catch(() => ({})),
        gcFetch(`/accounts/${externalAccountId}/balances/`, access).catch(() => ({})),
        gcFetch(`/accounts/${externalAccountId}/transactions/`, access),
      ]);

      const balance = Number(balances?.balances?.[0]?.balanceAmount?.amount || 0);
      const accountName = details?.account?.name || details?.account?.displayName || 'Bank account';
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .upsert({
          user_id: user.id,
          bank_connection_id: connection.id,
          external_account_id: externalAccountId,
          account_name: accountName,
          account_type: details?.account?.cashAccountType || 'current',
          current_balance: balance,
          available_balance: balance,
          currency: balances?.balances?.[0]?.balanceAmount?.currency || 'GBP',
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id,external_account_id' })
        .select()
        .single();
      if (accountError) throw accountError;

      const booked = transactions?.transactions?.booked || [];
      const rows = booked.map((tx: Record<string, unknown>) => {
        const amount = Number((tx.transactionAmount as Record<string, string>)?.amount || 0);
        const name = merchantName(tx);
        return {
          user_id: user.id,
          account_id: account.id,
          external_transaction_id: tx.transactionId || `${externalAccountId}:${tx.bookingDate}:${amount}:${name}`,
          merchant_name: name,
          merchant_group: name.replace(/\s+(uk|ltd|limited|marketplace|digital)$/i, ''),
          amount,
          transaction_date: tx.bookingDate || tx.valueDate,
          category: categoryFor(name, amount),
          user_classification: amount > 0 ? 'Essential' : 'Planned',
          raw: tx,
        };
      });

      if (rows.length) {
        const { error } = await supabase
          .from('transactions')
          .upsert(rows, { onConflict: 'user_id,account_id,external_transaction_id' });
        if (error) throw error;
        transactionCount += rows.length;
      }
    }

    await supabase.from('bank_connections').update({
      connection_status: requisition.status || 'linked',
      last_synced_at: new Date().toISOString(),
    }).eq('id', connection.id);

    return jsonResponse({ accounts: accountIds.length, transactions: transactionCount });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
