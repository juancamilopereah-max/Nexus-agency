// api/webhook.js — Stripe Webhook Handler
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function supabaseUpdate(userId, data) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ user_id: userId, ...data })
    }
  );
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // Verify webhook signature
  let event;
  try {
    // Simple HMAC verification
    const crypto = await import('crypto');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const parts = sig.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const v1 = parts.find(p => p.startsWith('v1=')).split('=')[1];
    const payload = `${timestamp}.${rawBody.toString()}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (expected !== v1) throw new Error('Invalid signature');
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  const data = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = data.client_reference_id;
      if (!userId) break;
      await supabaseUpdate(userId, {
        plan: 'pro',
        stripe_customer_id: data.customer,
        stripe_subscription_id: data.subscription,
        status: 'active',
        updated_at: new Date().toISOString(),
      });
      break;
    }
    case 'customer.subscription.updated': {
      const userId = data.metadata?.user_id;
      if (!userId) break;
      const active = ['active','trialing'].includes(data.status);
      await supabaseUpdate(userId, {
        status: active ? 'active' : 'inactive',
        plan: active ? 'pro' : 'free',
        current_period_end: new Date(data.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const userId = data.metadata?.user_id;
      if (!userId) break;
      await supabaseUpdate(userId, {
        status: 'inactive',
        plan: 'free',
        updated_at: new Date().toISOString(),
      });
      break;
    }
  }

  res.status(200).json({ received: true });
}
