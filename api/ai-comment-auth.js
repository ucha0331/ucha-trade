// Claude APIをサーバー側から呼び出すプロキシ関数（認証必須版）
// 取引日記タブの「アイリスが分析」「アイリスに相談」はログイン済みユーザーの
// 個人データ（取引履歴・保有ポジション）を扱うため、SupabaseのJWTを検証し
// 未ログインのリクエストは拒否する。
//
// APIキーはVercelの環境変数(ANTHROPIC_API_KEY)に保存し、ブラウザには一切渡さない
// プロンプトキャッシュ対応：systemプロンプトを分離してcache_controlを付与
//
// 必要な環境変数: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// （SUPABASE_ANON_KEYはservice_roleではなく公開用のanonキーでよい。
//   JWT検証だけが目的でRLSをバイパスする必要はないため）

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'サーバー側の認証設定（SUPABASE_URL/SUPABASE_ANON_KEY）が不足しています' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: '認証に失敗しました。再度ログインしてください' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'サーバー側にANTHROPIC_API_KEYが設定されていません' });
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'promptが必要です' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'プロンプトが長すぎます' });
  }
  const cappedMaxTokens = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 100), 1500);

  const systemContent =
    'あなたは個人投資家の学習をサポートするアシスタント「アイリス」です。' +
    '断定的な売買指示はせず、根拠を示した状況整理として伝えてください。' +
    'Markdown記法（##、**、-など）は使わず、すべてプレーンテキストで出力してください。';

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
        max_tokens: cappedMaxTokens,
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
