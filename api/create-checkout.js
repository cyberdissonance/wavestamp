/**
 * WaveStamp — Create Stripe Checkout Session
 * POST /api/create-checkout
 *
 * Body: { userId, userEmail, plan } — plan is 'pro' or 'founding'
 * Returns: { url } — Stripe Checkout URL to redirect to
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FOUNDING_LIMIT = parseInt(process.env.FOUNDING_MEMBER_LIMIT || '100');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, userEmail, plan } = req.body;

  if (!userId || !userEmail || !plan) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const isFounder = plan === 'founding';

    // Check founding member availability if applicable
    if (isFounder) {
      const { data: config } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'founding_members_count')
        .single();

      const currentCount = parseInt(config?.value || '0');
      if (currentCount >= FOUNDING_LIMIT) {
        return res.status(400).json({
          error: 'founding_limit_reached',
          message: 'All founding member spots have been claimed.'
        });
      }
    }

    // Pick the right price
    const priceId = isFounder
      ? process.env.STRIPE_FOUNDING_PRICE_ID
      : process.env.STRIPE_PRO_PRICE_ID;

    // Create or retrieve Stripe customer
    let customerId;
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
    }

    // Create checkout session with 7-day trial
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          supabase_user_id: userId,
          is_founding_member: String(isFounder),
        },
      },
      metadata: {
        supabase_user_id: userId,
        is_founding_member: String(isFounder),
      },
      success_url: `https://wavestamp.app/?upgrade=success`,
      cancel_url:  `https://wavestamp.app/?upgrade=cancelled`,
      // customer_email omitted — using customer ID instead
    });

    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout session error:', err);
    res.status(500).json({ error: err.message });
  }
}
