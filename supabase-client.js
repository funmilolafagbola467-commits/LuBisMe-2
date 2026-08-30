// ============================================================
// LuBisMe — Supabase client setup
// Include this on every page (via <script type="module">) before
// any page-specific logic that calls supabase.*
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Public anon key — safe to expose client-side. RLS policies in
// schema.sql are what actually enforce who can read/write what.
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_PUBLIC_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// Helper: get the currently logged-in user, or null.
// Use this at the top of dashboard.html to redirect to auth.html
// if nobody's logged in.
// ------------------------------------------------------------
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ------------------------------------------------------------
// Helper: generate a name-based slug with a random suffix,
// used for free-tier sign-ups. e.g. "Tobi Adekunle" -> "tobi-8f3k"
// ------------------------------------------------------------
export function generateSlug(displayName) {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 6); // 4 random chars
  return `${base}-${suffix}`;
}
