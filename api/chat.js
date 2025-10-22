// api/chat.js  Edge Runtime
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    return new Response('Missing KIMI_API_KEY', { status: 500 });
  }

  try {
    const body = await req.json();
    const upstream = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...body,
        model: 'moonshot-v1-8k',
        max_tokens: 1200,
        temperature: 0.15,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return new Response(text, { status: upstream.status });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
