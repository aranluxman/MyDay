import { createClient } from '@supabase/supabase-js';

// Public, client-safe values (the publishable key is meant to ship in the
// browser). All data access is governed by per-user Row Level Security.
export const SUPABASE_URL = 'https://zciulgqkqusjxomyapcz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_t3LKmsyqW22dT4ZMlKWQkg_UIyTziIe';

// Web-push VAPID public key (private key lives server-side only).
export const VAPID_PUBLIC_KEY =
  'BCG4-N8HtYRYE3d7uiIGD9GN6nIMU_EgdSR1pxpisqEZAAl4q_MiTFqRLfEOm8Aj6yJYFBW696KsiQDdpWYUFho';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
