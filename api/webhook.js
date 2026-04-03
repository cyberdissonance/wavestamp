/**
 * WaveStamp — Stripe Webhook Handler
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FOUNDING_LIMIT = parseInt(process.env.FOUNDING_MEMBER_LIMIT || '100');

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session        = event.data.object;
        const userId         = session.metadata?.supabase_user_id;
        const isFounder      = session.metadata?.is_founding_member === 'true';
        const customerId     = session.customer;
        const subscriptionId = session.subscription;

        if (!userId) { console.error('No supabase_user_id in metadata'); break; }

        if (isFounder) {
          const { data: config } = await supabase
            .from('app_config').select('value').eq('key', 'founding_members_count').single();
          const currentCount = parseInt(config?.value || '0');
          if (currentCount >= FOUNDING_LIMIT) {
            if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId);
            console.warn('Founding member limit reached');
            break;
          }
          await supabase.from('app_config')
            .update({ value: String(currentCount + 1) })
            .eq('key', 'founding_members_count');
        }

        const { error } = await supabase.from('profiles').upsert({
          id: userId, is_pro: true, is_founding_member: isFounder,
          stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
          subscription_status: 'active', updated_at: new Date().toISOString(),
        });

        if (error) console.error('Supabase error:', error);
        else console.log(`✅ Pro activated: ${userId} (founder: ${isFounder})`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const { data: profile } = await supabase.from('profiles')
          .select('id').eq('stripe_subscription_id', sub.id).single();
        if (profile) {
          await supabase.from('profiles')
            .update({ is_pro: false, subscription_status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', profile.id);
          console.log(`❌ Pro removed: ${profile.id}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const status = sub.status;
        const isPro  = status === 'active' || status === 'trialing';
        const { data: profile } = await supabase.from('profiles')
          .select('id').eq('stripe_subscription_id', sub.id).single();
        if (profile) {
          await supabase.from('profiles')
            .update({ is_pro: isPro, subscription_status: status, updated_at: new Date().toISOString() })
            .eq('id', profile.id);
          console.log(`🔄 Subscription updated: ${profile.id} → ${status}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  res.status(200).json({ received: true });
}
