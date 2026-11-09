import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { admin } from '../_lib/supabaseAdmin.js';
import { exchangeCode, getRedirectUri } from '../_lib/google.js';
import { checkState, clearStateCookie, cookieIsSecure } from '../_lib/oauthState.js';

// Google redirects here with ?code&state. We exchange it and store the tokens.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const redirectUri = getRedirectUri(req);
  const state = checkState(req.headers.cookie, req.query.state);
  res.setHeader('Set-Cookie', clearStateCookie(cookieIsSecure(redirectUri)));
  if (state !== 'ok') {
    res.status(state === 'missing' ? 400 : 403).send('Invalid OAuth state.');
    return;
  }
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }
  try {
    const tokens = await exchangeCode(code, redirectUri);
    const sb = admin();
    const { data: existing } = await sb
      .from('calendar_accounts')
      .select('id')
      .eq('provider', 'google')
      .maybeSingle();

    const row = {
      provider: 'google',
      access_token: tokens.access_token,
      expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? null,
      // refresh_token only comes back on first consent; keep the old one otherwise
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    };

    if (existing) await sb.from('calendar_accounts').update(row).eq('id', existing.id);
    else await sb.from('calendar_accounts').insert(row);

    res.redirect('/calendar');
  } catch (e) {
    res.status(500).send(`OAuth callback failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
