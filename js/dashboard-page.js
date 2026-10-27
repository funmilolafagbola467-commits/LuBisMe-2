// ============================================================
// LuBisMe — dashboard.html page logic
// Loads the logged-in user's profile, wallets, and subscription
// status, and renders them into the static markup from
// dashboard.html (replacing the hardcoded demo data).
// ============================================================

import { supabase, getCurrentUser } from './supabase-client.js?v=2';

async function initDashboard() {
  const user = await getCurrentUser();

  if (!user) {
    // Not logged in — bounce to auth
    window.location.href = 'auth.html';
    return;
  }

  const [{ data: profile }, { data: wallets }, { data: subscriptions }, { data: giftNotes }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('wallet_addresses').select('*').eq('user_id', user.id),
    supabase.from('subscriptions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
    supabase.from('gift_notes').select('*').eq('recipient_id', user.id).order('created_at', { ascending: false }).limit(20),
  ]);

  if (!profile) {
    console.error('No profile found for logged-in user.');
    return;
  }

  renderIdentity(profile);
  renderGiftLink(profile);
  renderPlanPill(profile);
  renderWallets(wallets || []);
  renderGiftNotes(giftNotes || []);
  renderSubscription(profile, subscriptions?.[0]);
  // profiles has no email column (Supabase Auth keeps email on the
  // auth.users side) — pass the real authenticated user here instead
  // of profile, which would always have .email === undefined.
  wireUpgradeButton(user, profile.id);
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
  const url = `lubisme.com/${profile.slug}`;
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
  const isActive = profile.plan_status === 'active';
  const isPremium = profile.plan === 'premium' && isActive;
  const isRegular = profile.plan === 'regular' && isActive;

  pill.textContent = isPremium ? 'Premium plan' : isRegular ? 'Regular plan' : 'Free (unsubscribed)';
  pill.classList.toggle('premium', isPremium);

  // A free/unsubscribed user sees both banners (subscribe to Regular,
  // or go straight to Premium). A Regular subscriber no longer needs
  // the Regular banner, only the Premium upsell. A Premium subscriber
  // needs neither — they already have everything.
  if (isRegular || isPremium) {
    document.getElementById('regular-banner')?.remove();
  }
  if (isPremium) {
    document.querySelectorAll('.upgrade-banner').forEach(b => b.remove());
  }
}

// ------------------------------------------------------------
const CHAIN_META = {
  BTC: { icon: '₿', label: 'Bitcoin (BTC)', cls: 'btc' },
  ETH: { icon: 'Ξ', label: 'Ethereum (ETH)', cls: 'eth' },
  SOL: { icon: '◎', label: 'Solana (SOL)', cls: 'sol' },
  USDT_TRC20: { icon: '₮', label: 'USDT (TRC-20)', cls: 'usdt' },
  USDT_ERC20: { icon: '₮', label: 'USDT (ERC-20)', cls: 'usdt' },
};

function renderWallets(wallets) {
  const container = document.querySelector('.wallets');
  container.innerHTML = '';

  const byChain = Object.fromEntries(wallets.map(w => [w.chain, w]));

  for (const chain of ['BTC', 'ETH', 'SOL', 'USDT_TRC20', 'USDT_ERC20']) {
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

function renderGiftNotes(notes) {
  const container = document.getElementById('gift-notes-list');
  if (!container) return;

  if (notes.length === 0) {
    container.innerHTML = '<p class="gift-notes-empty">No notes yet — they\'ll show up here once a fan leaves one on your gift page.</p>';
    return;
  }

  container.innerHTML = '';
  notes.forEach(note => {
    const chainLabel = CHAIN_META[note.chain]?.label || note.chain;
    const when = formatRelativeTime(note.created_at);

    const item = document.createElement('div');
    item.className = 'gift-note-item';

    // Built with DOM methods + textContent rather than innerHTML for
    // the fan-supplied fields, since this is user-generated content
    // from an unauthenticated public form — never trust it as safe
    // HTML.
    const top = document.createElement('div');
    top.className = 'gift-note-top';
    const senderEl = document.createElement('div');
    senderEl.className = 'gift-note-sender';
    senderEl.textContent = note.sender_name || 'Anonymous fan';
    const chainEl = document.createElement('div');
    chainEl.className = 'gift-note-chain';
    chainEl.textContent = chainLabel;
    top.append(senderEl, chainEl);

    item.appendChild(top);

    if (note.message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'gift-note-message';
      msgEl.textContent = note.message;
      item.appendChild(msgEl);
    }

    const meta = document.createElement('div');
    meta.className = 'gift-note-meta';
    const txEl = document.createElement('span');
    txEl.className = 'gift-note-tx';
    txEl.textContent = note.transaction_reference || '';
    const timeEl = document.createElement('span');
    timeEl.textContent = when;
    meta.append(txEl, timeEl);
    item.appendChild(meta);

    container.appendChild(item);
  });
}

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openWalletEditor(chain, existingWallet) {
  const label = CHAIN_META[chain]?.label || chain;
  const newAddress = prompt(
    `Enter your ${label} address (leave blank and tap OK to remove this wallet):`,
    existingWallet?.address || ''
  );

  if (newAddress === null) return; // user tapped Cancel — do nothing

  if (newAddress.trim() === '') {
    // Empty input is now a deliberate removal request, not a silent
    // no-op — but only ask to confirm if there was actually something
    // to remove.
    if (existingWallet) {
      const confirmed = confirm(`Remove your ${label} address? Fans won't be able to send you ${label} gifts until you add a new one.`);
      if (confirmed) removeWalletAddress(chain);
    }
    return;
  }

  saveWalletAddress(chain, newAddress.trim());
}

async function removeWalletAddress(chain) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('wallet_addresses')
    .delete()
    .eq('user_id', user.id)
    .eq('chain', chain);

  if (error) {
    alert('Could not remove that address. Please try again.');
    return;
  }
  initDashboard();
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
function wireUpgradeButton(user, profileId) {
  // Regular-plan button — only present if renderPlanPill() didn't
  // already remove the banner for an existing subscriber.
  const regularBtn = document.getElementById('regular-subscribe-btn');
  if (regularBtn) {
    regularBtn.onclick = () => {
      window.subscribeToRegular(user.email, profileId);
    };
  }

  const premiumBtn = document.getElementById('premium-upgrade-btn');
  if (!premiumBtn) return;
  premiumBtn.onclick = () => {
    // See paystack-integration.md — this triggers the Paystack
    // inline popup; premium is unlocked by the webhook, not here.
    // user.email comes from Supabase Auth (auth.users), not the
    // profiles table, which has no email column.
    window.upgradeToPremium(user.email, profileId);
  };
}

// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', initDashboard);
