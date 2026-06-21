// Claude APIをサーバー側から呼び出すプロキシ関数（Vercel版）
// APIキーはVercelの環境変数(ANTHROPIC_API_KEY)に保存し、ブラウザには一切渡さない

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'サーバー側にANTHROPIC_API_KEYが設定されていません' });
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'promptが必要です' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: json.error?.message || 'Claude APIエラー', debug: json });
    }

    const text = (json.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'AI解説の取得中にエラーが発生しました: ' + err.message });
  }
};
