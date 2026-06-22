// 会社名や銘柄コードの一部から、候補となる東証銘柄を検索するAPI（Vercel版）
// まず自前の日本語名マップでローカル検索し、ヒットしなければYahoo!ファイナンスの検索APIにフォールバックする

const JP_NAMES = require('../lib/jp-names.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ error: '検索キーワードを入力してください' });
  }

  // ① 自前の日本語名マップからローカル検索（即時・日本語名で検索可能）
  const lowerQ = q.toLowerCase();
  const localMatches = Object.entries(JP_NAMES)
    .filter(([code, name]) => name.toLowerCase().includes(lowerQ) || code.toLowerCase().includes(lowerQ))
    .map(([code, name]) => ({ code, name, source: 'local' }));

  if (localMatches.length > 0) {
    return res.status(200).json({ query: q, results: localMatches.slice(0, 10) });
  }

  // ② ローカルにヒットしなければYahoo!ファイナンスの検索APIにフォールバック
  // （日本語の会社名はYahoo側で見つからないことも多く、英語名・ローマ字表記の方が見つかりやすい場合がある）
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const searchResult = await yahooFinance.search(q);

    const results = (searchResult.quotes || [])
      .filter((item) => item.symbol && item.symbol.endsWith('.T') && item.quoteType === 'EQUITY')
      .map((item) => ({
        code: item.symbol.replace('.T', ''),
        name: item.shortname || item.longname || item.symbol,
        source: 'yahoo',
      }));

    return res.status(200).json({ query: q, results: results.slice(0, 10) });
  } catch (err) {
    return res.status(200).json({ query: q, results: [], debug_message: err.message });
  }
};
