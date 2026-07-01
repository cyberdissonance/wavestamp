/**
 * WaveStamp — Feedback / Report an Issue
 * POST /api/feedback
 *
 * Body: { category, message, email?, userId?, plan?, browser?, pageUrl? }
 * Stores the submission in Supabase (table: feedback) and emails it via Resend.
 * Storing is the source of truth; email is best-effort (never fails the request).
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const TO_EMAIL   = process.env.FEEDBACK_EMAIL || 'steinackerr@gmail.com';
const FROM_EMAIL = process.env.FEEDBACK_FROM  || 'WaveStamp Feedback <onboarding@resend.dev>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { category, message, email, userId, plan, browser, pageUrl } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Trim/cap fields defensively (avoid abuse / oversized rows)
  const row = {
    category:  (category || 'other').toString().slice(0, 40),
    message:   message.toString().slice(0, 4000),
    email:     email ? email.toString().slice(0, 320) : null,
    user_id:   userId || null,
    plan:      plan ? plan.toString().slice(0, 20) : null,
    browser:   browser ? browser.toString().slice(0, 500) : null,
    page_url:  pageUrl ? pageUrl.toString().slice(0, 500) : null,
  };

  // 1) Persist to Supabase (source of truth)
  let stored = false;
  try {
    const { error } = await supabase.from('feedback').insert(row);
    if (error) console.error('Feedback insert error:', error.message);
    else stored = true;
  } catch (e) {
    console.error('Feedback insert threw:', e);
  }

  // 2) Email notification (best-effort — don't fail the request if this errors)
  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: TO_EMAIL,
        replyTo: row.email || undefined,
        subject: `[WaveStamp] ${row.category} — ${row.email || row.user_id || 'anonymous'}`,
        text:
`New WaveStamp feedback

Category: ${row.category}
From:     ${row.email || '(none)'}
User ID:  ${row.user_id || '(anonymous)'}
Plan:     ${row.plan || '(unknown)'}
Page:     ${row.page_url || '(unknown)'}
Browser:  ${row.browser || '(unknown)'}

Message:
${row.message}
`,
      });
    } catch (e) {
      console.error('Feedback email error:', e);
    }
  }

  // As long as it stored (or email fired), treat as success for the user.
  if (stored || resend) return res.status(200).json({ ok: true });
  return res.status(500).json({ error: 'Could not record feedback' });
}
