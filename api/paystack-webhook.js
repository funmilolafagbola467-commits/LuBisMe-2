// LuBisMe — Paystack webhook handler (Vercel serverless function)
//
// This is the ONLY place that's allowed to mark a user as premium.
// It runs on Vercel's servers, never in the browser — that's what
// makes it trustworthy. It uses two secret values that must be set
// as Environment Variables in your Vercel project settings, never
// written directly into this file or committed to GitHub:
//
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Supabase Settings → API → service_role key)
//   PAYSTACK_SECRET_KEY         (Paystack Settings → API Keys & Webhooks)
//   PREMIUM_PLAN_CODE           (the PLN_xxxx code for your Premium plan)
//
// See the "Setting environment variables" section in
// backend/paystack-integration.md for exactly how to add these in
// the Vercel dashboard — no code changes needed to configure them.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  // 1. Verify this request genuinely came from Paystack, not someone
  //    pretending to be Paystack by POSTing a fake "payment succeeded"
  //    event at this same URL.
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  const premiumPlanCode = process.env.PREMIUM_PLAN_CODE;

  try {
    if (event.event === 'charge.success' || event.event === 'subscription.create') {
      const userId = event.data.metadata?.user_id;
      if (!userId) {
        console.warn('Webhook event missing user_id in metadata, skipping.');
        return res.status(200).send('OK — no user_id, ignored');
      }

      const planCode = event.data.plan?.plan_code;
      const plan = planCode === premiumPlanCode ? 'premium' : 'regular';

      await supabase.from('subscriptions').insert({
        user_id: userId,
        plan,
        paystack_customer_code: event.data.customer?.customer_code,
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
      if (userId) {
        await supabase
          .from('profiles')
          .update({ plan_status: 'past_due' })
          .eq('id', userId);
      }
    }

    if (event.event === 'subscription.disable') {
      const userId = event.data.metadata?.user_id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({ plan: 'free', plan_status: 'cancelled' })
          .eq('id', userId);
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    // Log server-side for your own debugging, but never leak
    // internal error details back to whoever called this endpoint.
    console.error('Webhook processing error:', err);
    return res.status(500).send('Internal error');
  }
}
