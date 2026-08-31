// ============================================================
// LuBisMe — dashboard.html page logic
// Loads the logged-in user's profile, wallets, and subscription
// status, and renders them into the static markup from
// dashboard.html (replacing the hardcoded demo data).
// ============================================================

import { supabase, getCurrentUser } from './supabase-client.js';

async function initDashboard() {
  const user = await getCurrentUser();

  if (!user) {
    // Not logged in — bounce to auth
    window.location.href = 'auth.html';
    return;
  }

  const [{ data: profile }, { data: wallets }, { data: subscriptions }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('wallet_addresses').select('*').eq('user_id', user.id),
    supabase.from('subscriptions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
  ]);

  if (!profile) {
    console.error('No profile found for logged-in user.');
    return;
  }

  renderIdentity(profile);
  renderGiftLink(profile);
  renderPlanPill(profile);
  renderWallets(wallets || []);
  renderSubscription(profile, subscriptions?.[0]);
  wireUpgradeButton(profile);
}

// ------------------------------------------------------------
function renderIdentity(profile) {
  const initials = profile.display_name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  document.querySelector('.avatar-sm').textContent = initials;
  document.querySelector('h1').textContent = `Welcome back, ${profile.display_name.split(' ')[0]}`;
}

// ------------------------------------------------------------
function renderGiftLink(profile) {
  const url = `lubisme.com/${profile.is_premium_slug ? '' : 'u/'}${profile.slug}`;
  const urlEl = document.querySelector('.link-card-url');
  urlEl.textContent = url;

  document.querySelector('.link-card-actions .btn-ghost').onclick = () => {
    navigator.clipboard.writeText(`https://${url}`);
    alert('Link copied!');
  };

  document.querySelector('.link-card-actions .btn-gold').href = `profile.html?slug=${profile.slug}`;
}

// ------------------------------------------------------------
function renderPlanPill(profile) {
  const pill = document.querySelector('.plan-pill');
  const isPremium = profile.plan === 'premium' && profile.plan_status === 'active';
  pill.textContent = isPremium ? 'Premium plan' : 'Regular plan';
  pill.classList.toggle('premium', isPremium);

  // Hide the upgrade banner entirely for existing premium users
  if (isPremium) {
    document.querySelector('.upgrade-banner')?.remove();
  }
}

// ------------------------------------------------------------
const CHAIN_META = {
  BTC: { icon: '₿', label: 'Bitcoin (BTC)', cls: 'btc' },
  ETH: { icon: 'Ξ', label: 'Ethereum (ETH)', cls: 'eth' },
  SOL: { icon: '◎', label: 'Solana (SOL)', cls: 'sol' },
  USDT: { icon: '₮', label: 'USDT (TRC-20)', cls: 'usdt' },
};

function renderWallets(wallets) {
  const container = document.querySelector('.wallets');
  container.innerHTML = '';

  const byChain = Object.fromEntries(wallets.map(w => [w.chain, w]));

  for (const chain of ['BTC', 'ETH', 'SOL', 'USDT']) {
    const meta = CHAIN_META[chain];
    const wallet = byChain[chain];

    const row = document.createElement('div');
    row.className = 'wallet-item';
    row.innerHTML = `
      <div class="chain-badge ${meta.cls}">${meta.icon}</div>
      <div class="wallet-info">
        <div class="wallet-chain-name">${meta.label}</div>
        <div class="wallet-address ${wallet ? '' : 'empty'}">
          ${wallet ? wallet.address : 'Not added yet'}
        </div>
      </div>
      <button class="wallet-edit">${wallet ? 'Edit' : 'Add'}</button>
    `;
    row.querySelector('.wallet-edit').onclick = () => openWalletEditor(chain, wallet);
    container.appendChild(row);
  }
}

function openWalletEditor(chain, existingWallet) {
  const newAddress = prompt(
    `Enter your ${chain} address:`,
    existingWallet?.address || ''
  );
  if (newAddress === null || newAddress.trim() === '') return;
  saveWalletAddress(chain, newAddress.trim());
}

async function saveWalletAddress(chain, address) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('wallet_addresses')
    .upsert(
      { user_id: user.id, chain, address },
      { onConflict: 'user_id,chain' }
    );

  if (error) {
    alert('Could not save that address. Please try again.');
    return;
  }
  initDashboard(); // simplest way to re-render with fresh data
}

// ------------------------------------------------------------
function renderSubscription(profile, subscription) {
  const statusEl = document.querySelector('.status-active');
  const isActive = profile.plan_status === 'active';
  statusEl.textContent = isActive ? '● Active' : `● ${profile.plan_status}`;
  statusEl.style.color = isActive ? 'var(--green)' : 'var(--coral)';

  const planLine = document.querySelectorAll('.sub-info-item strong')[1];
  if (planLine) {
    const price = profile.plan === 'premium' ? '₦8,500/mo' : profile.plan === 'regular' ? '₦3,500/mo' : '—';
    planLine.textContent = `${capitalize(profile.plan)} — ${price}`;
  }

  const dateLine = document.querySelectorAll('.sub-info-item strong')[2];
  if (dateLine && subscription?.current_period_end) {
    dateLine.textContent = new Date(subscription.current_period_end).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------
function wireUpgradeButton(profile) {
  const btn = document.querySelector('.upgrade-banner .btn-gold');
  if (!btn) return;
  btn.onclick = () => {
    // See paystack-integration.md — this triggers the Paystack
    // inline popup; premium is unlocked by the webhook, not here.
    window.upgradeToPremium(profile.email, profile.id);
  };
}

// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', initDashboard);
