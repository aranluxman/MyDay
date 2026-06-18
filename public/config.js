// MyDay configuration.
// These are public, client-safe values (the publishable key is meant to ship
// in the browser). Access to data is governed by Row Level Security in Supabase.
export const SUPABASE_URL = 'https://hcvjiveloioftozvnbhe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_DGZFZUhnMLgFpdYzcHWRmw_wqOPu2Aq';

// Single patient for now. A real patients table can replace this constant later
// without touching the schema (every row already carries patient_id).
export const PATIENT_ID = '00000000-0000-0000-0000-000000000001';

// Web-push VAPID public key (set once the missed-dose notifications are wired up).
export const VAPID_PUBLIC_KEY = 'BCG4-N8HtYRYE3d7uiIGD9GN6nIMU_EgdSR1pxpisqEZAAl4q_MiTFqRLfEOm8Aj6yJYFBW696KsiQDdpWYUFho';
