import type { ApiRequest, ApiResponse } from '../_lib/types.js';
import { CALENDAR_SCOPE, getRedirectUri } from '../_lib/google.js';
import { verifyOwner } from '../_lib/webAuth.js';
import { cookieIsSecure, newState, stateCookie } from '../_lib/oauthState.js';

// Kicks off the Google OAuth consent flow: owner only, returns the consent URL as JSON.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!(await verifyOwner(req))) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(500).send('GOOGLE_CLIENT_ID not configured.');
    return;
  }
  const redirectUri = getRedirectUri(req);
  const state = newState();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token every time
    state,
  });
  res.setHeader('Set-Cookie', stateCookie(state, cookieIsSecure(redirectUri)));
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}
