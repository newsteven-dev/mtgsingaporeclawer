// Account controls for the main page. Signed out, nothing is shown (the sign-in
// button stays hidden; sign in at /login.html). Signed in, "Captured searches" and
// "Log out" appear top right. Also gives app.js the sign-in token for the
// signed-in-only data (price history, recently tracked cards).
import { getSession, signOut } from './auth-client.js';

const $ = (s) => document.querySelector(s);

async function init() {
  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    console.warn('sign-in check failed', err);
  }

  if (session) {
    const meta = session.user.user_metadata || {};
    const name = meta.user_name || meta.preferred_username || '';
    $('#searches-btn').hidden = false;
    $('#searches-label').textContent = name ? `Captured searches (${name})` : 'Captured searches';
    $('#logout-btn').hidden = false;
  }

  $('#logout-btn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await signOut('/');
  });

  // app.js waits on this before loading signed-in-only data.
  window.__resolveAuth({
    signedIn: Boolean(session),
    token: async () => (await getSession())?.access_token || null,
  });
}

init();
