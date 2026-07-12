// 「今日の注目銘柄」検出API（Vercel版）
// 主要242銘柄（lib/universe.js）の当日の値動きと出来高を一括取得し、
// 「出来高が普段より急増 ＋ 値動きが大きい」＝大口投資家が動いている可能性の
// 高い銘柄をスコアリングして返す。
//
// 熱度スコア = |値動き%| + max(0, 出来高倍率 - 1) × 2
//   出来高の異常度を値動きの2倍の重みで評価する
//   （「大口投資家が作る波に乗る」思想: 価格より先に出来高に大口の痕跡が出る）
//
// 注意: ザラ場中は当日出来高がまだ積み上がり途中のため出来高倍率は控えめに出る。
//       レスポンスのisMarketOpenフラグでフロント側に注記を出す。

const JP_NAMES = require('../lib/jp-names.js');
const UNIVERSE_CODES = require('../lib/universe.js');

function getMarketStatus() {
  const now = new Date();
  const jstParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => jstParts.find((p) => p.type === type)?.value;
  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const totalMin = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const morning = totalMin >= 9 * 60 && totalMin < 11 * 60 + 30;
  const afternoon = totalMin >= 12 * 60 + 30 && totalMin < 15 * 60;
  return isWeekday && (morning || afternoon);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const symbols = UNIVERSE_CODES.map((c) => `${c}.T`);
    const quotes = await yahooFinance.quote(symbols);
    const quoteArr = Array.isArray(quotes) ? quotes : [quotes];

    const scored = quoteArr
      .map((q) => {
        const code = (q.symbol || '').replace('.T', '');
        const changePercent = q.regularMarketChangePercent;
        const vol = q.regularMarketVolume;
        const avgVol = q.averageDailyVolume10Day || q.averageDailyVolume3Month;
        if (changePercent == null || !vol || !avgVol) return null;

        const volumeRatio = vol / avgVol;
        const heatScore = Math.abs(changePercent) + Math.max(0, volumeRatio - 1) * 2;

        return {
          code,
          name: JP_NAMES[code] || q.shortName || code,
          price: q.regularMarketPrice,
          changePercent,
          volumeRatio: +volumeRatio.toFixed(2),
          heatScore: +heatScore.toFixed(2),
          direction: changePercent >= 0 ? 'up' : 'down',
        };
      })
      .filter(Boolean)
      // ノイズ除去: 出来高が平常並み以下 かつ 値動きも小さい銘柄は対象外
      .filter((r) => r.volumeRatio >= 1.2 || Math.abs(r.changePercent) >= 2.5);

    const hot = scored.sort((a, b) => b.heatScore - a.heatScore).slice(0, 12);

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      isMarketOpen: getMarketStatus(),
      totalChecked: quoteArr.length,
      hot,
    });
  } catch (err) {
    return res.status(500).json({ error: '注目銘柄の取得中にエラーが発生しました: ' + err.message });
  }
};
