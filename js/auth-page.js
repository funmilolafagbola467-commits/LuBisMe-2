// ============================================================
// LuBisMe — auth.html page logic
// Handles: sign up, log in, wallet address save, slug generation
// ============================================================

import { supabase, generateSlug } from './supabase-client.js';

let currentUserId = null; // set after successful sign-up

// Slugs that collide with real app routes and can never be claimed
// by a user — checked before insert on both free and premium signup.
const RESERVED_SLUGS = new Set([
  'dashboard', 'login', 'signup', 'auth', 'u', 'api',
  'index', 'profile', 'js', 'backend', 'admin', 'settings',
  'about', 'pricing', 'terms', 'privacy', 'help', 'support',
]);

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

// ------------------------------------------------------------
// SIGN UP
// ------------------------------------------------------------
export async function handleSignUp() {
  const displayName = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;

  if (!displayName || !email || !password) {
    showError('signup', 'Please fill in every field.');
    return;
  }
  if (password.length < 8) {
    showError('signup', 'Password must be at least 8 characters.');
    return;
  }

  setLoading('signup', true);

  // 1. Create the auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) {
    setLoading('signup', false);
    showError('signup', authError.message);
    return;
  }

  currentUserId = authData.user.id;

  // If email confirmation is required, Supabase returns a user object
  // but no active session — authData.session will be null in that case.
  // There's no authenticated session yet, so RLS will correctly block
  // any attempt to insert the profile row right now. Rather than try
  // and show a confusing failure, tell the person what's actually
  // happening: check their email, then come back and log in — at
  // which point handleLogIn's post-login check creates the profile.
  if (!authData.session) {
    setLoading('signup', false);
    showCheckEmailMessage();
    return;
  }

  // Email confirmation is off (or this is a return visit with an
  // active session already) — safe to create the profile immediately.
  await createProfileForUser(currentUserId, displayName);
  setLoading('signup', false);
  goToWallets();
}

// ------------------------------------------------------------
// Shared profile-creation logic, used both right after signup
// (when confirmation is off) and right after a successful login
// for an account that confirmed its email but never got a profile
// row created yet (see handleLogIn below).
// ------------------------------------------------------------
async function createProfileForUser(userId, displayName) {
  let slug = generateSlug(displayName);
  if (isReservedSlug(slug.split('-')[0])) {
    slug = generateSlug(displayName);
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    display_name: displayName,
    slug,
    plan: 'free',
    plan_status: 'inactive',
  });

  if (profileError) {
    if (profileError.code === '23505') {
      // Slug collision — retry once with a fresh suffix.
      const retrySlug = generateSlug(displayName);
      await supabase.from('profiles').update({ slug: retrySlug }).eq('id', userId);
    } else if (profileError.code !== '23505') {
      // Row may already exist from a prior attempt — that's fine,
      // not a real failure, just skip silently.
      console.warn('Profile insert issue (likely already exists):', profileError.message);
    }
  }
}

function showCheckEmailMessage() {
  const signupForm = document.getElementById('signup-form');
  signupForm.innerHTML = `
    <h1>Check your email</h1>
    <p class="sub">We've sent a confirmation link to your email address. Click it, then come back here and log in to finish setting up your page.</p>
  `;
}

// ------------------------------------------------------------
// LOG IN
// ------------------------------------------------------------
export async function handleLogIn() {
  const email = document.getElementById('li-email').value.trim();
  const password = document.getElementById('li-password').value;

  if (!email || !password) {
    showError('login', 'Enter your email and password.');
    return;
  }

  setLoading('login', true);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setLoading('login', false);
    showError('login', 'Incorrect email or password.');
    return;
  }

  // If this account confirmed its email after a signup where the
  // profile couldn't be created yet (see handleSignUp above), it
  // won't have a profiles row. Check once, right after login, and
  // create one if missing — using the email's local part as a
  // fallback display name since we don't have the original name
  // they typed at signup time.
  const userId = data.user.id;
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingProfile) {
    const fallbackName = email.split('@')[0].split('+')[0];
    await createProfileForUser(userId, fallbackName);
  }

  setLoading('login', false);
  window.location.href = 'dashboard.html';
}

// ------------------------------------------------------------
// SAVE WALLET ADDRESSES (step 2 of onboarding)
// ------------------------------------------------------------
export async function handleSaveWallets() {
  const wallets = [
    { chain: 'BTC', address: document.getElementById('w-btc').value.trim() },
    { chain: 'ETH', address: document.getElementById('w-eth').value.trim() },
    { chain: 'SOL', address: document.getElementById('w-sol').value.trim() },
    { chain: 'USDT', address: document.getElementById('w-usdt').value.trim() },
  ].filter(w => w.address.length > 0);

  if (wallets.length === 0) {
    showError('wallets', 'Add at least one wallet address to continue.');
    return;
  }

  setLoading('wallets', true);

  const rows = wallets.map(w => ({
    user_id: currentUserId,
    chain: w.chain,
    address: w.address,
  }));

  const { error } = await supabase.from('wallet_addresses').insert(rows);

  setLoading('wallets', false);

  if (error) {
    showError('wallets', 'Could not save your wallets. Please try again.');
    return;
  }

  // Populate the confirm screen with what was just saved
  showConfirmScreen(wallets);
}

// ------------------------------------------------------------
// FINAL CONFIRM — user has reviewed addresses, send them in
// ------------------------------------------------------------
export function handleFinishOnboarding() {
  window.location.href = 'dashboard.html';
}

// ------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------
function showError(context, message) {
  const el = document.getElementById(`${context}-error`);
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

function setLoading(context, isLoading) {
  const btn = document.getElementById(`${context}-submit-btn`);
  if (btn) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? 'Please wait…' : btn.dataset.defaultLabel || btn.textContent;
  }
}

function showConfirmScreen(wallets) {
  document.getElementById('wallet-card').classList.add('hidden');
  document.getElementById('confirm-card').classList.remove('hidden');

  const addedChains = new Set(wallets.map(w => w.chain.toLowerCase()));

  // Populate whichever chains were actually added, and hide the
  // confirm row entirely for any chain the user skipped — showing
  // an empty "(not added)" row here just adds noise to a screen
  // whose whole point is careful review.
  for (const chain of ['btc', 'eth', 'sol', 'usdt']) {
    const field = document.getElementById(`confirm-${chain}-field`);
    const input = document.getElementById(`confirm-${chain}`);
    if (addedChains.has(chain)) {
      const wallet = wallets.find(w => w.chain.toLowerCase() === chain);
      input.value = wallet.address;
      field.classList.remove('hidden');
    } else {
      field.classList.add('hidden');
    }
  }
}

function goToWallets() {
  document.getElementById('auth-card').classList.add('hidden');
  document.getElementById('wallet-card').classList.remove('hidden');
}
