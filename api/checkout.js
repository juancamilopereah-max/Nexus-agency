// api/checkout.js — Stripe Checkout Session
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  const token = authHeader.replace('Bearer ', '');

  // Verify Supabase session
  const authCheck = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY }
  });
  if (!authCheck.ok) return res.status(401).json({ error: 'Sesión inválida' });
  const user = await authCheck.json();

  const { plan } = req.body; // 'monthly' or 'yearly'
  const origin = req.headers.origin || 'https://nexus-agency-nine.vercel.app';

  // Price IDs — set after creating products in Stripe
  const prices = {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_YEARLY,
  };

  const priceId = prices[plan];
  if (!priceId) return res.status(400).json({ error: 'Plan inválido' });

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[0]': 'card',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'mode': 'subscription',
        'success_url': `${origin}/dashboard.html?payment=success`,
        'cancel_url': `${origin}/pricing.html`,
        'client_reference_id': user.id,
        'customer_email': user.email,
        'subscription_data[metadata][user_id]': user.id,
      }).toString()
    });

    const session = await stripeRes.json();
    if (session.error) return res.status(400).json({ error: session.error.message });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Error creando sesión de pago' });
  }
}
