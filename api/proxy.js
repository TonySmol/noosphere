export default async function handler(req, res) {
  const QDRANT_URL = 'https://515693ca-83f2-4a67-ba52-d44d507d8cc0.europe-west3-0.gcp.cloud.qdrant.io';
  const QDRANT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MiOiJtIiwic3ViamVjdCI6ImFwaS1rZXk6OGY1ZGI4Y2ItNWNkYi00MWZlLThjMjgtNGRmM2JkY2U1YzUxIn0.Vv4Xi9L_YrcFcHGcPB4EclGXGXzO1XtUzjl4AYutiPc';

  // CORS для любых доменов (на всякий случай)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // Убираем /api/proxy из пути, оставляем только /collections/...
    const path = req.url.replace('/api/proxy', '') || '/';
    const target = QDRANT_URL + path;

    const response = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'api-key': QDRANT_KEY
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body)
    });

    const text = await response.text();
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(text);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
