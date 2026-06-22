// 日本株の日足データをYahoo!ファイナンスから取得するプロキシ関数（Vercel版）
// yahoo-finance2ライブラリがCookie/crumb認証など内部の複雑な手順を処理してくれる
// ※ yahoo-finance2はESM専用パッケージのため動的importを使用

const JP_NAMES = require('../lib/jp-names.js');

// 東証の取引時間（9:00-11:30, 12:30-15:00、平日）に基づき、
// 最新データが「確定済み（前日終値）」か「進行中（ザラ場中の暫定値）」かを判定する
function getMarketStatus() {
  const now = new Date();
  const jstParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type) => jstParts.find((p) => p.type === type)?.value;
  const weekday = get('weekday'); // "Mon", "Tue", ...
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const todayJst = `${get('year')}-${get('month')}-${get('day')}`;

  const totalMin = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const morning = totalMin >= 9 * 60 && totalMin < 11 * 60 + 30;
  const afternoon = totalMin >= 12 * 60 + 30 && totalMin < 15 * 60;
  const isMarketOpen = isWeekday && (morning || afternoon);

  return { isMarketOpen, todayJst };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const code = (req.query.code || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(code)) {
    return res.status(400).json({ error: '銘柄コードは4桁の英数字で指定してください（例: 7203, 285A）' });
  }

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const symbol = `${code}.T`; // 東証銘柄はYahoo!ファイナンスでは「.T」サフィックス
    const period2 = new Date();
    const period1 = new Date();
    period1.setDate(period1.getDate() - 180); // 直近180日分（指標計算のバッファを含む）

    const chart = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: '1d',
    });

    const quotes = (chart.quotes || []).filter(
      (q) => q.close != null && q.open != null && q.high != null && q.low != null
    );

    if (quotes.length < 30) {
      return res.status(404).json({
        error: `銘柄コード ${code} の十分なデータがありませんでした（指標計算には最低30日分必要です）`,
        debug_rowCount: quotes.length,
      });
    }

    const data = quotes.map((q) => ({
      date: q.date.toISOString().slice(0, 10),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));

    // 会社名を取得（日本語名マップを優先し、なければYahoo!ファイナンスの取得名を使う）
    let name = JP_NAMES[code] || null;
    if (!name) {
      try {
        const quote = await yahooFinance.quote(symbol);
        name = quote?.shortName || quote?.longName || null;
      } catch (e) {
        // 会社名の取得失敗は致命的ではないので握りつぶす
      }
    }

    const { isMarketOpen, todayJst } = getMarketStatus();
    const latestDate = data[data.length - 1].date;
    const isLatestConfirmed = !(isMarketOpen && latestDate === todayJst);

    return res.status(200).json({ code, symbol, name, data, isLatestConfirmed, isMarketOpen });
  } catch (err) {
    return res.status(500).json({
      error: `銘柄コード ${code} のデータ取得中にエラーが発生しました。コードが正しいか確認してください。`,
      debug_message: err.message,
    });
  }
};
