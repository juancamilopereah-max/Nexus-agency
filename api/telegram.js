export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;

  const { message } = req.body;
  if (!message || !message.text) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const text = message.text.trim();
  const firstName = message.from?.first_name || 'Usuario';

  // Detect agent from command or mention
  const agents = {
    '/estrategia': { name: 'NEXUS-S', role: 'Eres NEXUS-S, agente de estrategia de NEXUS AGENCY. Especialidad: estrategia de negocio, posicionamiento, planificación, análisis competitivo. Responde en español, máximo 200 palabras, sé directo y útil.' },
    '/contenido':  { name: 'NEXUS-C', role: 'Eres NEXUS-C, agente de contenido de NEXUS AGENCY. Especialidad: copywriting, guiones, hooks para redes, storytelling, contenido viral. Responde en español, máximo 200 palabras, da ejemplos concretos.' },
    '/ventas':     { name: 'NEXUS-V', role: 'Eres NEXUS-V, agente de ventas de NEXUS AGENCY. Especialidad: propuestas comerciales, scripts de venta, funnels, pricing, manejo de objeciones. Responde en español, máximo 200 palabras.' },
    '/analisis':   { name: 'NEXUS-A', role: 'Eres NEXUS-A, agente analítico de NEXUS AGENCY. Especialidad: métricas, KPIs, benchmarking, insights accionables, reporting. Responde en español, máximo 200 palabras.' },
    '/doc':        { name: 'NEXUS-S', role: 'Eres NEXUS-S de NEXUS AGENCY. Genera un documento estructurado y completo basado en el mensaje del usuario. Usa secciones claras con títulos. Máximo 400 palabras.' },
  };

  const sendMessage = async (text) => {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  };

  // Help command
  if (text === '/start' || text === '/help') {
    await sendMessage(`👋 Hola ${firstName}! Bienvenido a *NEXUS AGENCY*.\n\nComandos disponibles:\n\n🧠 /estrategia — Agente de estrategia\n🎬 /contenido — Agente de contenido\n💹 /ventas — Agente de ventas\n📊 /analisis — Agente de análisis\n📄 /doc — Generar documento completo\n\nEjemplo: /estrategia necesito un plan para mi restaurante`);
    return res.status(200).json({ ok: true });
  }

  // Find which agent to use
  let agentKey = null;
  let userMessage = text;

  for (const cmd of Object.keys(agents)) {
    if (text.startsWith(cmd)) {
      agentKey = cmd;
      userMessage = text.replace(cmd, '').trim();
      break;
    }
  }

  if (!agentKey) {
    await sendMessage(`Usá un comando para hablar con un agente:\n\n🧠 /estrategia\n🎬 /contenido\n💹 /ventas\n📊 /analisis\n📄 /doc\n\nEjemplo: /estrategia ¿cómo valido mi idea?`);
    return res.status(200).json({ ok: true });
  }

  if (!userMessage) {
    await sendMessage(`¿En qué te puedo ayudar? Escribí tu consulta después del comando.\n\nEjemplo: ${agentKey} ¿cómo mejoro mis ventas?`);
    return res.status(200).json({ ok: true });
  }

  const agent = agents[agentKey];

  // Send typing indicator
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  });

  try {
    // Call Anthropic
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: agent.role,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    const aiData = await aiRes.json();
    const reply = aiData.content?.[0]?.text || 'Error generando respuesta.';

    // Send reply to Telegram
    await sendMessage(`*${agent.name}:*\n\n${reply}`);

    // Save to Notion if /doc command
    if (agentKey === '/doc' && NOTION_TOKEN && NOTION_PAGE_ID) {
      const paragraphs = reply.split('\n').filter(p => p.trim());
      const blocks = paragraphs.map(p => ({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: p.substring(0, 2000) } }] }
      }));

      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { page_id: NOTION_PAGE_ID },
          icon: { type: 'emoji', emoji: '📄' },
          properties: { title: { title: [{ type: 'text', text: { content: `[Telegram] ${userMessage.substring(0, 60)}` } }] } },
          children: blocks
        })
      });

      await sendMessage(`✅ Documento guardado en tu Notion.`);
    }

  } catch(err) {
    await sendMessage('⚠ Error conectando con el agente. Intentá de nuevo.');
  }

  return res.status(200).json({ ok: true });
}
