// Simple in-memory rate limiter
const rateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;
  if (!rateLimits.has(ip)) { rateLimits.set(ip, { count: 1, start: now }); return true; }
  const limit = rateLimits.get(ip);
  if (now - limit.start > windowMs) { rateLimits.set(ip, { count: 1, start: now }); return true; }
  if (limit.count >= maxRequests) return false;
  limit.count++;
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Esperá un minuto.' });
  }

  // Auth check
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const token = authHeader.replace('Bearer ', '');

  try {
    const authCheck = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY }
    });
    if (!authCheck.ok) return res.status(401).json({ error: 'Sesión inválida.' });
  } catch(e) {
    return res.status(401).json({ error: 'Error verificando sesión.' });
  }

  const { messages, system, saveToNotion, docTitle, agentName } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, system, messages })
    });

    const data = await response.json();
    const replyText = data.content?.[0]?.text || '';

    if (saveToNotion && replyText && process.env.NOTION_TOKEN && process.env.NOTION_PAGE_ID) {
      try {
        const title = docTitle || `${agentName} — ${new Date().toLocaleDateString('es-ES')}`;
        const blocks = replyText.split('\n').filter(p => p.trim()).map(p => ({
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: p.substring(0, 2000) } }] }
        }));
        blocks.push({ object: 'block', type: 'divider', divider: {} });
        blocks.push({ object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '🤖' }, rich_text: [{ type: 'text', text: { content: `Generado por ${agentName} · NEXUS AGENCY · ${new Date().toLocaleString('es-ES')}` } }], color: 'gray_background' } });

        await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
          body: JSON.stringify({ parent: { page_id: process.env.NOTION_PAGE_ID }, icon: { type: 'emoji', emoji: '📄' }, properties: { title: { title: [{ type: 'text', text: { content: title } }] } }, children: blocks })
        });
        res.status(200).json({ ...data, savedToNotion: true });
      } catch { res.status(200).json({ ...data, savedToNotion: false }); }
    } else {
      res.status(200).json(data);
    }
  } catch (err) {
    res.status(500).json({ error: 'Error conectando con el agente.' });
  }
}
