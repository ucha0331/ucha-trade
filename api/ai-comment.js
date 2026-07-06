// Claude APIをサーバー側から呼び出すプロキシ関数（Vercel版）
// APIキーはVercelの環境変数(ANTHROPIC_API_KEY)に保存し、ブラウザには一切渡さない
// プロンプトキャッシュ対応：systemプロンプトを分離してcache_controlを付与

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'サーバー側にANTHROPIC_API_KEYが設定されていません' });
  }

  const { prompt, maxTokens, systemPrompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'promptが必要です' });
  }

  // systemPromptが渡された場合はキャッシュ対応のsystemブロックを使う
  // 渡されない場合はデフォルトのsystemプロンプトを使用
  const defaultSystemPrompt =
    'あなたは日本株のテクニカル分析を学ぶ初心者トレーダーの学習支援AIです。' +
    '断定的な売買指示はせず、根拠を示した状況整理として伝えてください。' +
    'Markdown記法（##、**、-など）は使わず、すべてプレーンテキストで出力してください。';

  const systemContent = systemPrompt || defaultSystemPrompt;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 1000,
        system: [
          {
            type: 'text',
            text: systemContent,
            cache_control: { type: 'ephemeral' },
          },
        ],
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

    // キャッシュ利用状況をレスポンスに含める（デバッグ用）
    const usage = json.usage || {};
    return res.status(200).json({
      text,
      cache_hit: (usage.cache_read_input_tokens || 0) > 0,
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens || 0,
        cache_write: usage.cache_creation_input_tokens || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'AI解説の取得中にエラーが発生しました: ' + err.message });
  }
};
