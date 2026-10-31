// LuBisMe — submit a gift note (Vercel serverless function)
//
// What this does, in order:
//   1. Checks the note is well-formed and the creator exists
//   2. Applies an anti-spam limit (so nobody can flood a creator's inbox)
//   3. Saves the note
//   4. Emails the creator
//
// IMPORTANT: a note is only what a fan typed. LuBisMe never sees the
// real transaction, so the email says "someone says they sent a gift",
// never "a gift arrived".
//
// Environment variables (set in Vercel → Settings → Environment Variables):
//   SUPABASE_URL                 (already set for the Paystack webhook)
//   SUPABASE_SERVICE_ROLE_KEY    (already set for the Paystack webhook)
//   RESEND_API_KEY               (new — from resend.com)
//   NOTIFY_FROM_EMAIL            (new — e.g. LuBisMe <notifications@lubisme.com>)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CHAIN_LABELS = {
  BTC: 'Bitcoin (BTC)',
  ETH: 'Ethereum (ETH)',
  SOL: 'Solana (SOL)',
  USDT_TRC20: 'USDT (TRC-20)',
  USDT_ERC20: 'USDT (ERC-20)',
};

const MAX_NOTES_PER_HOUR = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

// Fan-typed text goes into an HTML email, so it must be escaped —
// otherwise someone could slip markup or links into a creator's inbox.
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendCreatorEmail({ to, creatorName, chain, senderName, transactionReference, message }) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_FROM_EMAIL) {
    console.warn('Email not configured (RESEND_API_KEY / NOTIFY_FROM_EMAIL missing) — note saved, no email sent.');
    return;
  }

  const who = escapeHtml(senderName || 'Someone');
  const coin = escapeHtml(CHAIN_LABELS[chain] || chain);
  const tx = escapeHtml(transactionReference);
  const msg = escapeHtml(message);
  const name = escapeHtml(creatorName || 'there');

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:480px; margin:0 auto; color:#1A0F1F;">
      <h2 style="margin-bottom:6px;">${who} says they sent you a gift 🎁</h2>
      <p style="margin-top:0; color:#555;">Hi ${name}, a fan left a note on your LuBisMe page.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:6px 0; color:#777;">Coin</td><td style="padding:6px 0;"><strong>${coin}</strong></td></tr>
        ${msg ? `<tr><td style="padding:6px 0; color:#777;">Message</td><td style="padding:6px 0;">${msg}</td></tr>` : ''}
        ${tx ? `<tr><td style="padding:6px 0; color:#777;">Transaction ID</td><td style="padding:6px 0; word-break:break-all; font-family:monospace; font-size:12px;">${tx}</td></tr>` : ''}
      </table>
      <p style="background:#FFF4D6; padding:12px 14px; border-radius:8px; font-size:13px;">
        <strong>Not verified.</strong> LuBisMe can't see the transaction itself — this is only what the fan typed.
        Check your wallet app to confirm the gift actually arrived.
      </p>
      <p><a href="https://lubisme.com/dashboard" style="color:#B8860B;">Open your dashboard →</a></p>
    </div>
  `;

  const text =
    `${senderName || 'Someone'} says they sent you a gift (${CHAIN_LABELS[chain] || chain}).\n` +
    (message ? `Message: ${message}\n` : '') +
    (transactionReference ? `Transaction ID: ${transactionReference}\n` : '') +
    `\nNot verified — check your wallet app to confirm it arrived.\nhttps://lubisme.com/dashboard`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM_EMAIL,
      to: [to],
      subject: `${senderName || 'Someone'} says they sent you a gift on LuBisMe`,
      html,
      text,
    }),
  });

  if (!response.ok) {
    console.error('Resend rejected the email:', response.status, await response.text());
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const recipientId = clean(body.recipient_id, 64);
  const chain = clean(body.chain, 20);
  const senderName = clean(body.sender_name, 60);
  const transactionReference = clean(body.transaction_reference, 200);
  const message = clean(body.message, 300);

  if (!UUID_PATTERN.test(recipientId) || !CHAIN_LABELS[chain]) {
    return res.status(400).json({ error: 'Something about that note looks wrong — please refresh and try again.' });
  }
  if (!senderName && !transactionReference && !message) {
    return res.status(400).json({ error: 'Fill in at least one field, or skip this step.' });
  }

  try {
    // 1. The creator must exist
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', recipientId)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ error: 'That creator could not be found.' });
    }

    // 2. Anti-spam: cap how many notes one creator can receive per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('gift_notes')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', recipientId)
      .gte('created_at', oneHourAgo);

    if ((count ?? 0) >= MAX_NOTES_PER_HOUR) {
      return res.status(429).json({ error: 'This creator has received a lot of notes recently — please try again in a little while.' });
    }

    // 3. Save the note
    const { error: insertError } = await supabase.from('gift_notes').insert({
      recipient_id: recipientId,
      chain,
      sender_name: senderName || null,
      transaction_reference: transactionReference || null,
      message: message || null,
    });

    if (insertError) {
      console.error('Saving gift note failed:', insertError);
      return res.status(500).json({ error: 'Could not send that — please try again.' });
    }

    // 4. Email the creator. A failure here must never undo or hide a
    //    note that was saved successfully, so it is caught separately.
    try {
      const { data: userData } = await supabase.auth.admin.getUserById(recipientId);
      const creatorEmail = userData?.user?.email;
      if (creatorEmail) {
        await sendCreatorEmail({
          to: creatorEmail,
          creatorName: profile.display_name,
          chain,
          senderName,
          transactionReference,
          message,
        });
      }
    } catch (emailError) {
      console.error('Creator notification email failed:', emailError);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit-note error:', err);
    return res.status(500).json({ error: 'Could not send that — please try again.' });
  }
}
