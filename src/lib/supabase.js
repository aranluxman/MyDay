import { createClient } from '@supabase/supabase-js';

// Public, client-safe values (the publishable key is meant to ship in the
// browser). All data access is governed by per-user Row Level Security.
export const SUPABASE_URL = 'https://zciulgqkqusjxomyapcz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_t3LKmsyqW22dT4ZMlKWQkg_UIyTziIe';

// Web-push VAPID public key (private key lives server-side only).
export const VAPID_PUBLIC_KEY =
  'BCG4-N8HtYRYE3d7uiIGD9GN6nIMU_EgdSR1pxpisqEZAAl4q_MiTFqRLfEOm8Aj6yJYFBW696KsiQDdpWYUFho';

// Read BEFORE the client is created: detectSessionInUrl consumes the recovery
// hash and strips it from the address bar, so by the time React renders there
// is nothing left to look at. Capturing it here lets the reset screen show
// "choose a new password" immediately instead of flashing "link isn't active"
// while the tokens are still being exchanged.
export const CAME_FROM_RECOVERY_LINK =
  typeof window !== 'undefined' && /(^|[#&])type=recovery(&|$)/.test(window.location.hash || '');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Needed for the "I forgot my password" email: the recovery link comes back
    // carrying its tokens in the URL and they have to be picked up here.
    detectSessionInUrl: true,
    // Implicit rather than PKCE on purpose. PKCE keeps a verifier in the
    // browser that asked for the reset, so the email only works on that same
    // device — a bad trade for an older user who asks for the link on a tablet
    // and opens their email on a phone.
    flowType: 'implicit',
  },
});
