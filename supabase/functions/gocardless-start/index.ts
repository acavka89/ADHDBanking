import { adminClient, getUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse, requireEnv } from '../_shared/cors.ts';
import { gcFetch, gocardlessToken } from '../_shared/gocardless.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getUser(req);
    const body = await req.json().catch(() => ({}));
    const institutionId = body.institutionId || 'LLOYDSBANK_LLOYDSGB2L';
    const redirect = body.redirect || requireEnv('GOCARDLESS_REDIRECT_URL');
    const supabase = adminClient();
    const { access } = await gocardlessToken();

    const agreement = await gcFetch('/agreements/enduser/', access, {
      method: 'POST',
      body: JSON.stringify({
        institution_id: institutionId,
        max_historical_days: 90,
        access_valid_for_days: 90,
        access_scope: ['balances', 'details', 'transactions'],
      }),
    });

    const requisition = await gcFetch('/requisitions/', access, {
      method: 'POST',
      body: JSON.stringify({
        redirect,
        institution_id: institutionId,
        reference: crypto.randomUUID(),
        agreement: agreement.id,
        user_language: 'EN',
      }),
    });

    const { error } = await supabase.from('bank_connections').insert({
      user_id: user.id,
      provider: 'gocardless',
      institution_id: institutionId,
      requisition_id: requisition.id,
      connection_status: requisition.status || 'created',
      consent_expires_at: agreement.accepted ? null : undefined,
    });
    if (error) throw error;

    return jsonResponse({ link: requisition.link, requisitionId: requisition.id, institutionId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
