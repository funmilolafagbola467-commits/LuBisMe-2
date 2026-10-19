// ============================================================
// LuBisMe — profile.html page logic (the public gift page)
// Reads the slug from the URL (?slug=tobi-8f3k or path routing
// via Vercel rewrites), loads that user's public profile and
// wallets — no login required, this is what fans see.
// ============================================================

import { supabase } from './supabase-client.js';

async function initProfilePage() {
  const slug = getSlugFromUrl();

  if (!slug) {
    showNotFound();
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('slug', slug)
    .single();

  if (profileError || !profile) {
    showNotFound();
    return;
  }

  const { data: wallets } = await supabase
    .from('wallet_addresses')
    .select('*')
    .eq('user_id', profile.id);

  if (!wallets || wallets.length === 0) {
    showNoWallets(profile);
    return;
  }

  renderProfile(profile);
  renderWalletTabs(wallets);
  selectChain(wallets[0].chain, wallets); // show the first available chain by default

  currentRecipientId = profile.id;
  wireNoteForm();

  // Beginner's guide is a premium-only feature the creator unlocks
  // for their fans — only shown on a premium creator's page.
  if (profile.plan === 'premium' && profile.plan_status === 'active') {
    document.getElementById('guide-card')?.classList.remove('hidden');
    wireGuideToggle();
  }
}

function wireGuideToggle() {
  const toggle = document.getElementById('guide-toggle');
  const content = document.getElementById('guide-content');
  toggle?.addEventListener('click', () => {
    content.classList.toggle('hidden');
  });
}

// The recipient's profile id, set once the page successfully loads —
// the note form needs this to know who the note is being left for.
let currentRecipientId = null;

// ------------------------------------------------------------
// Supports both query-string (?slug=x) and path-based routing.
// If deployed with a Vercel rewrite like /:slug -> /profile.html,
// pull the slug from the path instead.
// ------------------------------------------------------------
function getSlugFromUrl() {
  // 1. First, check if Vercel mapped it to a query parameter (?slug=xyz)
  const params = new URLSearchParams(window.location.search);
  if (params.get('slug')) return params.get('slug');

  // 2. Clean the path parts
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  
  // If the path is just 'profile.html', ignore it so it doesn't get used as a username
  if (pathParts[0] === 'profile.html') {
    return null;
  }

  // 3. Handle both /u/tobi-8f3k and /tobi formats if accessed directly
  if (pathParts[0] === 'u' && pathParts[1]) return pathParts[1];
  if (pathParts[0]) return pathParts[0];

  return null;
}

// ------------------------------------------------------------
function renderProfile(profile) {
  document.title = `${profile.display_name} — LuBisMe`;

  // Safely get initials even if the name has no spaces
  const nameParts = profile.display_name.split(' ');
  const initials = nameParts.length > 1 
    ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
    : profile.display_name.slice(0, 2).toUpperCase();

  document.querySelector('.avatar').textContent = initials;
  document.querySelector('h1').textContent = profile.display_name;
  
  // Safe string splitting fallback for bio prompts
  const firstWord = profile.display_name.split(' ')[0] || profile.display_name;
  document.querySelector('.bio').textContent = profile.bio || `Send ${firstWord} a gift 🎁`;
  document.querySelector('.gift-prompt h2').textContent = `Send ${firstWord} a gift`;

  const badge = document.querySelector('.verified-badge');
  if (badge) {
    // This hides the badge correctly for free tier accounts!
    badge.style.display = profile.is_premium_slug ? 'inline-flex' : 'none';
  }
}

// ------------------------------------------------------------
let currentWallets = [];

function renderWalletTabs(wallets) {
  currentWallets = wallets;
  const tabsContainer = document.querySelector('.chain-tabs');
  tabsContainer.innerHTML = '';

  const CHAIN_META = {
    BTC: { icon: '₿', label: 'BTC' },
    ETH: { icon: 'Ξ', label: 'ETH' },
    SOL: { icon: '◎', label: 'SOL' },
    USDT_TRC20: { icon: '₮', label: 'USDT·TRC20' },
    USDT_ERC20: { icon: '₮', label: 'USDT·ERC20' },
  };

  wallets.forEach((w, i) => {
    const meta = CHAIN_META[w.chain];
    const tab = document.createElement('div');
    tab.className = `chain-tab${i === 0 ? ' active' : ''}`;
    tab.dataset.chain = w.chain;
    tab.innerHTML = `
      <div class="chain-tab-icon">${meta.icon}</div>
      <div class="chain-tab-name">${meta.label}</div>
    `;
    tab.onclick = () => selectChain(w.chain, wallets);
    tabsContainer.appendChild(tab);
  });
}

function selectChain(chain, wallets) {
  const wallet = wallets.find(w => w.chain === chain);
  if (!wallet) return;

  document.querySelectorAll('.chain-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.chain === chain);
  });

  const CHAIN_LABELS = {
    BTC: 'Bitcoin (BTC)',
    ETH: 'Ethereum (ETH)',
    SOL: 'Solana (SOL)',
    USDT_TRC20: 'USDT (TRC-20)',
    USDT_ERC20: 'USDT (ERC-20)',
  };

  document.getElementById('chain-title').textContent = CHAIN_LABELS[chain];
  document.getElementById('address-text').textContent = wallet.address;
  document.getElementById('qr-img').src =
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(wallet.address)}`;

  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copy';
  btn.classList.remove('copied');
}

window.copyAddress = function () {
  const text = document.getElementById('address-text').textContent;
  navigator.clipboard.writeText(text);
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = 'Copy';
    btn.classList.remove('copied');
  }, 2000);
};

// ------------------------------------------------------------
function showNotFound() {
  document.querySelector('.wrap').innerHTML = `
    <div style="text-align:center; padding-top:80px;">
      <h1 style="font-family:'Sora',sans-serif; font-size:22px; margin-bottom:10px;">Page not found</h1>
      <p style="color:var(--muted); font-size:14px;">This LuBisMe link doesn't exist or may have been removed.</p>
    </div>
  `;
}

function showNoWallets(profile) {
  document.querySelector('.wrap').innerHTML = `
    <div style="text-align:center; padding-top:80px;">
      <h1 style="font-family:'Sora',sans-serif; font-size:22px; margin-bottom:10px;">${profile.display_name}</h1>
      <p style="color:var(--muted); font-size:14px;">This creator hasn't added any wallet addresses yet — check back soon.</p>
    </div>
  `;
}

// ------------------------------------------------------------
// Optional "leave a note" form — lets a fan log their name, a
// transaction reference, and a short message after sending a gift.
// This is purely a courtesy record for the creator; LuBisMe has no
// way to verify any of it actually corresponds to a real transaction.
function wireNoteForm() {
  const toggle = document.getElementById('note-toggle');
  const form = document.getElementById('note-form');
  const submitBtn = document.getElementById('note-submit-btn');

  toggle.addEventListener('click', () => {
    form.classList.toggle('hidden');
  });

  submitBtn.addEventListener('click', async () => {
    const errorEl = document.getElementById('note-error');
    const successEl = document.getElementById('note-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const senderName = document.getElementById('note-name').value.trim();
    const transactionReference = document.getElementById('note-tx').value.trim();
    const message = document.getElementById('note-message').value.trim();

    if (!senderName && !transactionReference && !message) {
      errorEl.textContent = 'Fill in at least one field, or skip this step.';
      errorEl.classList.remove('hidden');
      return;
    }

    const activeTab = document.querySelector('.chain-tab.active');
    const chain = activeTab ? activeTab.dataset.chain : currentWallets[0]?.chain;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const { error } = await supabase.from('gift_notes').insert({
      recipient_id: currentRecipientId,
      chain,
      sender_name: senderName || null,
      transaction_reference: transactionReference || null,
      message: message || null,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send note';

    if (error) {
      errorEl.textContent = 'Could not send that — please try again.';
      errorEl.classList.remove('hidden');
      return;
    }

    successEl.textContent = 'Thank you! Your note has been sent.';
    successEl.classList.remove('hidden');
    document.getElementById('note-name').value = '';
    document.getElementById('note-tx').value = '';
    document.getElementById('note-message').value = '';
  });
}

// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initProfilePage();
  // The copy button is static HTML (not generated dynamically like
  // the chain tabs), so it needs its listener attached here rather
  // than relying on an inline onclick in the markup.
  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', window.copyAddress);
});
