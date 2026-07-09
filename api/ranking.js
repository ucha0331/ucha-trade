// 主要な日本株（日経225・TOPIX Core30クラス）の値動きを取得し、
// 値上がり率・値下がり率のランキングを返すAPI（Vercel版）

// 業種を分散させた主要銘柄リスト（個人利用の範囲で固定運用）
const UNIVERSE = [
  { code: '7203', name: 'トヨタ自動車' },
  { code: '7267', name: 'ホンダ' },
  { code: '7201', name: '日産自動車' },
  { code: '6758', name: 'ソニーグループ' },
  { code: '6501', name: '日立製作所' },
  { code: '7011', name: '三菱重工業' },
  { code: '6701', name: 'NEC' },
  { code: '6702', name: '富士通' },
  { code: '6753', name: 'シャープ' },
  { code: '6752', name: 'パナソニックHD' },
  { code: '9984', name: 'ソフトバンクG' },
  { code: '9433', name: 'KDDI' },
  { code: '9434', name: 'ソフトバンク' },
  { code: '9432', name: 'NTT' },
  { code: '8306', name: '三菱UFJ FG' },
  { code: '8316', name: '三井住友FG' },
  { code: '8411', name: 'みずほFG' },
  { code: '8766', name: '東京海上HD' },
  { code: '4063', name: '信越化学工業' },
  { code: '4502', name: '武田薬品工業' },
  { code: '4503', name: 'アステラス製薬' },
  { code: '4519', name: '中外製薬' },
  { code: '6098', name: 'リクルートHD' },
  { code: '8267', name: 'イオン' },
  { code: '9020', name: 'JR東日本' },
  { code: '9021', name: 'JR西日本' },
  { code: '9202', name: 'ANA HD' },
  { code: '7974', name: '任天堂' },
  { code: '6861', name: 'キーエンス' },
  { code: '8035', name: '東京エレクトロン' },
  { code: '6594', name: 'ニデック' },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const symbols = UNIVERSE.map((u) => `${u.code}.T`);
    const quotes = await yahooFinance.quote(symbols);
    const quoteArr = Array.isArray(quotes) ? quotes : [quotes];

    const ranked = quoteArr
      .map((q) => {
        const code = (q.symbol || '').replace('.T', '');
        const meta = UNIVERSE.find((u) => u.code === code);
        return {
          code,
          name: meta ? meta.name : (q.shortName || code),
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
