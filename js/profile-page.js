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
}

// ------------------------------------------------------------
// Supports both query-string (?slug=x) and path-based routing.
// If deployed with a Vercel rewrite like /:slug -> /profile.html,
// pull the slug from the path instead.
// ------------------------------------------------------------
function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('slug')) return params.get('slug');

  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // handles both /tobi (premium) and /u/tobi-8f3k (free tier)
  if (pathParts[0] === 'u' && pathParts[1]) return pathParts[1];
  if (pathParts[0]) return pathParts[0];

  return null;
}

// ------------------------------------------------------------
function renderProfile(profile) {
  document.title = `${profile.display_name} — LuBisMe`;

  const initials = profile.display_name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  document.querySelector('.avatar').textContent = initials;
  document.querySelector('h1').textContent = profile.display_name;
  document.querySelector('.bio').textContent = profile.bio || `Send ${profile.display_name.split(' ')[0]} a gift 🎁`;
  document.querySelector('.gift-prompt h2').textContent = `Send ${profile.display_name.split(' ')[0]} a gift`;

  const badge = document.querySelector('.verified-badge');
  if (badge) {
    // Only show the badge for confirmed premium accounts — never
    // let this be inferred from anything the fan-facing page alone
    // could spoof; it comes straight from the DB record.
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
    USDT: { icon: '₮', label: 'USDT' },
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
    USDT: `USDT${wallet.network ? ' (' + wallet.network + ')' : ''}`,
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
document.addEventListener('DOMContentLoaded', () => {
  initProfilePage();
  // The copy button is static HTML (not generated dynamically like
  // the chain tabs), so it needs its listener attached here rather
  // than relying on an inline onclick in the markup.
  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', window.copyAddress);
});
