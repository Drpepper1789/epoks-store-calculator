// Vercel Serverless Function: /api/items
// Proxies JBCL items list to avoid client CORS issues and adds caching.
//
// Query:
//  - minCash: number (optional) minimum cash_value filter

module.exports = async (req, res) => {
  try {
    const minCash = Number(req.query.minCash || 0);

    const upstream = await fetch('https://api.jailbreakchangelogs.xyz/items/list', {
      headers: { accept: 'application/json' }
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    const items = Array.isArray(data) ? data : (data.items || data.values || []);
    const filtered = (Array.isArray(items) ? items : []).filter((x) => {
      const v = Number(x.cash_value ?? x.cashValue ?? x.cash ?? x.value ?? 0);
      return Number.isFinite(v) && v >= minCash;
    });

    // Cache at the edge for 1 hour; allow stale while revalidating for a day.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify({ items: filtered }));
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
