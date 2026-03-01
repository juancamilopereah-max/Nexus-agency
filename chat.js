export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, system, saveToNotion, docTitle, agentName } = req.body;

  try {
    // 1. Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system,
        messages
      })
    });

    const data = await response.json();
    const replyText = data.content?.[0]?.text || '';

    // 2. If saveToNotion flag is set, create a Notion page
    if (saveToNotion && replyText && process.env.NOTION_TOKEN && process.env.NOTION_PAGE_ID) {
      try {
        const title = docTitle || `${agentName} — ${new Date().toLocaleDateString('es-ES')}`;

        // Split content into paragraphs for Notion blocks
        const paragraphs = replyText.split('\n').filter(p => p.trim() !== '');
        const blocks = paragraphs.map(p => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: p.substring(0, 2000) }
            }]
          }
        }));

        // Add a divider and metadata at the end
        blocks.push({ object: 'block', type: 'divider', divider: {} });
        blocks.push({
          object: 'block',
          type: 'callout',
          callout: {
            icon: { type: 'emoji', emoji: '🤖' },
            rich_text: [{
              type: 'text',
              text: { content: `Generado por ${agentName} · NEXUS AGENCY · ${new Date().toLocaleString('es-ES')}` }
            }],
            color: 'gray_background'
          }
        });

        await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            parent: { page_id: process.env.NOTION_PAGE_ID },
            icon: { type: 'emoji', emoji: '📄' },
            properties: {
              title: {
                title: [{ type: 'text', text: { content: title } }]
              }
            },
            children: blocks
          })
        });

        res.status(200).json({ ...data, savedToNotion: true });
      } catch (notionErr) {
        // If Notion fails, still return the AI response
        res.status(200).json({ ...data, savedToNotion: false, notionError: notionErr.message });
      }
    } else {
      res.status(200).json(data);
    }

  } catch (err) {
    res.status(500).json({ error: 'Error conectando con el agente.' });
  }
}
