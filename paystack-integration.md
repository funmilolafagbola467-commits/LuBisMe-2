# LuBisMe — Paystack subscription integration

This covers **only** subscription billing (you getting paid ₦3,500 /
₦8,500 per month). It has nothing to do with the crypto gifting flow —
that stays entirely client-to-client via wallet addresses, no backend
involvement at all.

## 1. Paystack setup (one-time, dashboard)

1. Create two **Plans** in the Paystack dashboard (Payments → Plans):
   - `LuBisMe Regular` — ₦3,500, monthly interval
   - `LuBisMe Premium` — ₦8,500, monthly interval
2. Note each plan's `plan_code` (e.g. `PLN_xxxxx`) — you'll need these in the frontend checkout call.
3. Under Settings → API Keys & Webhooks, set your webhook URL to your
   deployed handler, e.g. `https://lubisme.com/api/paystack-webhook`.
4. Keep the **secret key** server-side only (Vercel environment
   variable). Only the **public key** ever goes in frontend code.

## 2. Frontend checkout (client-side, safe to expose)

```html
<script src="https://js.paystack.co/v2/inline.js"></script>
<script>
function upgradeToPremium(email, userId) {
  const handler = PaystackPop.setup({
    key: 'pk_live_xxxxxxxxxxxx',       // public key — safe in frontend
    email: email,
    plan: 'PLN_premium_plan_code',      // from step 1
    metadata: { user_id: userId },      // ties the payment back to the Supabase user
    callback: function(response) {
      // Payment succeeded on Paystack's side — but DO NOT unlock
      // premium here. Just show a "confirming payment..." state.
      // The webhook (server-side) is the only source of truth.
      showPendingConfirmation();
    },
    onClose: function() {
      // user closed the popup without paying
    }
  });
  handler.openIframe();
}
</script>
```

**Why not unlock premium in the `callback`?** Because that callback
runs in the fan's browser — trivially fakeable by anyone with dev
tools open. The frontend only ever *initiates* payment and shows
optimistic UI; the webhook below is what actually flips the switch.

## 3. Webhook handler (server-side — e.g. a Vercel serverless function)

This is the part that must run on a server, using your Paystack
**secret key** and Supabase **service role key** (never exposed to
the browser).

```js
// /api/paystack-webhook.js  (Vercel serverless function)
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role — bypasses RLS, server-only
);

export default async function handler(req, res) {
  // 1. Verify the request genuinely came from Paystack
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;

  // 2. Handle the events that matter for subscription state
  if (event.event === 'charge.success' || event.event === 'subscription.create') {
    const userId = event.data.metadata?.user_id;
    const planCode = event.data.plan?.plan_code;
    const plan = planCode === 'PLN_premium_plan_code' ? 'premium' : 'regular';

    await supabase.from('subscriptions').insert({
      user_id: userId,
      plan,
      paystack_customer_code: event.data.customer.customer_code,
      paystack_subscription_code: event.data.subscription_code,
      paystack_reference: event.data.reference,
      status: 'active',
      amount_kobo: event.data.amount,
      current_period_end: event.data.subscription?.next_payment_date ?? null,
    });

    await supabase
      .from('profiles')
      .update({ plan, plan_status: 'active' })
      .eq('id', userId);
  }

  if (event.event === 'subscription.not_renew' || event.event === 'invoice.payment_failed') {
    const userId = event.data.metadata?.user_id;
    await supabase
      .from('profiles')
      .update({ plan_status: 'past_due' })
      .eq('id', userId);
  }

  if (event.event === 'subscription.disable') {
    const userId = event.data.metadata?.user_id;
    await supabase
      .from('profiles')
      .update({ plan: 'free', plan_status: 'cancelled' })
      .eq('id', userId);
  }

  res.status(200).send('OK');
}
```

## 4. Premium slug unlock flow

Once `profiles.plan = 'premium'` and `plan_status = 'active'`
(confirmed by the webhook, not the frontend), the dashboard shows the
"choose your custom link" field. On submit:

```js
import { isReservedSlug } from './auth-page.js'; // same reserved list used at signup

if (isReservedSlug(desiredSlug)) {
  // show "that name is reserved, try another" — never let this reach the DB
} else {
  const { data: available } = await supabase.rpc('is_slug_available', { check_slug: desiredSlug });

  if (available) {
    await supabase
      .from('profiles')
      .update({ slug: desiredSlug, is_premium_slug: true })
      .eq('id', userId);
  } else {
    // show "that name's taken, try another"
  }
}
```

The `unique` constraint on `profiles.slug` in the schema is the real
safety net against two users racing for the same slug. The reserved-word
check above is a separate concern — it stops a paying user from
claiming a name like `dashboard` or `login` that would otherwise
collide with a real app route (see `vercel.json`'s catch-all rewrite).

## 5. What happens on non-payment / downgrade

- Paystack fires `invoice.payment_failed` on a missed renewal →
  `plan_status` moves to `past_due`. Decide with your client: does a
  past_due premium user keep their custom slug for a grace period, or
  does it revert immediately? This is a product decision, not a
  technical one — worth confirming before launch.
- On full cancellation (`subscription.disable`), plan reverts to
  `free`/`plan_status: cancelled`. Recommend keeping their existing
  slug reserved rather than releasing it back into the pool
  immediately, so a lapsed premium user doesn't come back to find
  someone else took their name.

## Summary of what stays where

| Data | Where it lives | Who can write it |
|---|---|---|
| Wallet addresses | `wallet_addresses` table | Only the owning user (RLS) |
| Subscription status | `subscriptions` + `profiles.plan_status` | Only the webhook handler (service role key) |
| Gift funds | Never touch your system at all | N/A — wallet-to-wallet |
