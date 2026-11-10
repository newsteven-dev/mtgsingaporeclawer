// Shared Supabase Auth client for the login and captured-searches pages.
// supabase-js is loaded by <script src="/vendor/supabase.js"> (served from node_modules).
const { createClient } = window.supabase;

let clientPromise = null;

/** Returns a Supabase client, or null when sign-in isn't configured on this server. */
export function getClient() {
  if (!clientPromise) {
    clientPromise = fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) =>
        cfg.enabled
          ? createClient(cfg.supabaseUrl, cfg.publishableKey, {
              auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
            })
          : null,
      );
  }
  return clientPromise;
}

export async function signInWithGitHub() {
  const supabase = await getClient();
  if (!supabase) throw new Error('Sign-in is not configured on this server.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${location.origin}/searches.html` },
  });
  if (error) throw error;
}

export async function getSession() {
  const supabase = await getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signOut(redirectTo = '/login.html') {
  const supabase = await getClient();
  try {
    if (supabase) await supabase.auth.signOut();
  } finally {
    location.href = redirectTo;
  }
}
