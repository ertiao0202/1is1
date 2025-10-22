// api/fetch-text.js  Edge Runtime
export const config = { runtime: 'edge' };

export default async function(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const { url } = await req.json();

  if (!url.includes('youtube.com') && !url.includes('youtu.be'))
    return new Response('Only YouTube is supported', { status: 400 });

  try {
    const downsub = `https://downsub.com/?url=${encodeURIComponent(url)}`;
    const html  = await fetch(downsub).then(r => r.text());
    const srtUrl = html.match(/href="(.*\.srt)"/)?.[1];
    if (!srtUrl) return new Response('No subtitle found', { status: 404 });

    const srt = await fetch(srtUrl).then(r => r.text());
    const text = srt
      .split('\n')
      .filter(l => l && !l.match(/^\d+$/) && !l.match(/^\d{2}:\d{2}:\d{2}/))
      .join(' ')
      .slice(0, 2000);
    return new Response(JSON.stringify({ text }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response('Subtitle download error', { status: 502 });
  }
}
