/**
 * WaveStamp — Customer Portal Session
 * POST /api/customer-portal
 *
 * Redirects user to Stripe's hosted billing portal
 * where they can update payment, cancel, etc.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({ error: 'No billing account found' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: 'https://wavestamp.app/',
    });

    res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error('Portal session error:', err);
    res.status(500).json({ error: err.message });
  }
}
