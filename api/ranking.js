// 主要な日本株の値動きを取得し、値上がり率・値下がり率のランキングを返すAPI（Vercel版）
// 対象銘柄は lib/universe.js（約240銘柄、hot-stocks.jsと共有）

const JP_NAMES = require('../lib/jp-names.js');
const UNIVERSE_CODES = require('../lib/universe.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const symbols = UNIVERSE_CODES.map((c) => `${c}.T`);
    const quotes = await yahooFinance.quote(symbols);
    const quoteArr = Array.isArray(quotes) ? quotes : [quotes];

    const ranked = quoteArr
      .map((q) => {
        const code = (q.symbol || '').replace('.T', '');
        return {
          code,
          name: JP_NAMES[code] || q.shortName || code,
          price: q.regularMarketPrice,
          changePercent: q.regularMarketChangePercent,
          change: q.regularMarketChange,
        };
      })
      .filter((r) => r.price != null && r.changePercent != null);

    const gainers = [...ranked].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
    const losers = [...ranked].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);

    return res.status(200).json({ updatedAt: new Date().toISOString(), gainers, losers, totalChecked: ranked.length });
  } catch (err) {
    return res.status(500).json({ error: 'ランキングの取得中にエラーが発生しました: ' + err.message });
  }
};
