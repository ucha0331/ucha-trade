// scripts/generate-report.mjs
// 週次/月次成績レポート生成: 取引日記の統計計算 → Claude総括 → Supabase保存
// 実行: node scripts/generate-report.mjs [--monthly]
// 必要な環境変数: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//
// 【実スキーマに合わせた変更点】
// デイトレ羅針盤の trades テーブルには trade_date / pnl / stop_loss_risk / rule_followed
// カラムは存在しない。実際のカラムは以下（index.htmlのsaveTradeBtn payload参照）:
//   user_id, ticker_code, ticker_name, side('long'|'short'|'pass'),
//   entry_date, entry_price, exit_date, exit_price, quantity,
//   reason, result_note, source
// そのため:
//   - 決済済み取引（exit_date/exit_priceがある & side!=='pass'）のみを対象に
//     pnl をこちら側で計算してから統計処理に渡す
//   - 日付集計軸は exit_date（決済日=結果が確定した日）を使用
//   - stop_loss_risk が無いため rMultiples/avgR は自動的に空（統計スキップ）になる
//   - rule_followed が無いため ruleStats も自動的にnullになる
//   （どちらも「カラムが無ければ自然にスキップされる」設計をそのまま維持）

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const isMonthly = process.argv.includes("--monthly");

// ---------- 期間計算（JST基準） ----------
function getPeriod() {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
  if (isMonthly) {
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(firstOfThisMonth.getTime() - 24 * 3600 * 1000);
    return { start, end, type: "monthly" };
  }
  // 週次: 先週の月曜〜日曜
  const dow = now.getUTCDay(); // 0=日
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  const start = new Date(thisMonday.getTime() - 7 * 24 * 3600 * 1000);
  const end = new Date(thisMonday.getTime() - 24 * 3600 * 1000);
  return { start, end, type: "weekly" };
}

const fmt = (d) => d.toISOString().slice(0, 10);

// ---------- PnL計算（アプリ側 calcPnl と同一ロジック） ----------
function calcPnl(t) {
  const diff = t.side === "long" ? t.exit_price - t.entry_price : t.entry_price - t.exit_price;
  return diff * t.quantity;
}

// ---------- 統計計算（数値の正はここ。LLMには計算させない） ----------
// 想定入力: 決済済み（exit_date/exit_priceあり、side!=='pass'）のtradesに
//           pnlフィールドを付与し、日付軸として exit_date を使う
function computeStats(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const sum = (arr, f) => arr.reduce((a, t) => a + f(t), 0);
  const n = trades.length;

  const winRate = n ? wins.length / n : 0;
  const avgWin = wins.length ? sum(wins, (t) => t.pnl) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(sum(losses, (t) => t.pnl)) / losses.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  const grossProfit = sum(wins, (t) => t.pnl);
  const grossLoss = Math.abs(sum(losses, (t) => t.pnl));

  // R倍数（stop_loss_riskカラムが存在する場合のみ意味を持つ。現行スキーマには無いので基本的に空配列）
  const rMultiples = trades
    .filter((t) => t.stop_loss_risk > 0)
    .map((t) => +(t.pnl / t.stop_loss_risk).toFixed(2));

  // 曜日別セグメント（決済日=exit_date基準）
  const byDow = {};
  for (const t of trades) {
    const dow = ["日", "月", "火", "水", "木", "金", "土"][new Date(t.exit_date).getUTCDay()];
    byDow[dow] ??= { count: 0, pnl: 0 };
    byDow[dow].count++;
    byDow[dow].pnl += t.pnl;
  }

  // ルール遵守監査（rule_followedカラムが存在する場合のみ。現行スキーマには無いので自動的にnull）
  const audited = trades.filter((t) => t.rule_followed !== null && t.rule_followed !== undefined);
  const ruleStats = audited.length
    ? {
        complianceRate: +(audited.filter((t) => t.rule_followed).length / audited.length).toFixed(2),
        ruleViolationWins: audited.filter((t) => !t.rule_followed && t.pnl > 0).length, // 危険サンプル
        ruleFollowedLosses: audited.filter((t) => t.rule_followed && t.pnl < 0).length, // 正しい負け
      }
    : null;

  // 連敗検出（リベンジトレード監査用、exit_date順にソート）
  let maxConsecLosses = 0, streak = 0;
  const sorted = [...trades].sort((a, b) => new Date(a.exit_date) - new Date(b.exit_date));
  for (const t of sorted) {
    streak = t.pnl < 0 ? streak + 1 : 0;
    maxConsecLosses = Math.max(maxConsecLosses, streak);
  }

  return {
    tradeCount: n,
    totalPnl: +sum(trades, (t) => t.pnl).toFixed(0),
    winRate: +winRate.toFixed(3),
    avgWin: +avgWin.toFixed(0),
    avgLoss: +avgLoss.toFixed(0),
    expectancy: +expectancy.toFixed(0),
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : null,
    rMultiples,
    avgR: rMultiples.length ? +(rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length).toFixed(2) : null,
    byDayOfWeek: byDow,
    ruleStats,
    maxConsecutiveLosses: maxConsecLosses,
  };
}

// ---------- Claude総括（プロンプトキャッシュ適用） ----------
const SYSTEM_PROMPT = `あなたはトップトレーダーの思考法でトレード記録をレビューするコーチ「アイリス」です。

## レビュー原則
- 結果（損益額）ではなくプロセス（ルール遵守・期待値）を評価する
- 「ルール違反で勝ったトレード」は成功体験として学習してはいけない危険なサンプルとして必ず指摘する
- 「ルール通りで負けたトレード」は正しいトレードとして肯定する
- サンプル数が30未満の統計は「傾向の可能性」として語り、断定しない
- 連敗後の行動変化（リベンジトレードの兆候）に注意を払う
- 好成績のときこそ「相場環境の追い風」の可能性を指摘する
- 断定予測（「来週は上がる」等）はしない。特定銘柄の売買推奨もしない

## 出力形式（Markdown、400字以内）
### 今期の総括（2-3文）
### 良かった点（プロセス面で1-2個）
### 最重要の改善点（1個に絞る）
### 来期の検証仮説(1個)`;

async function generateSummary(stats, period) {
  // API側が固まった場合にGitHub Actionsを無駄に長時間占有しないようタイムアウトを設定
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" }, // プロンプトキャッシュ適用（維持）
          },
        ],
        messages: [
          {
            role: "user",
            content: `期間: ${fmt(period.start)}〜${fmt(period.end)}（${period.type}）\n計算済み統計:\n${JSON.stringify(stats, null, 2)}\n\nこの統計をレビューして総括してください。`,
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// ---------- メイン ----------
async function main() {
  const period = getPeriod();
  console.log(`Generating ${period.type} report: ${fmt(period.start)} - ${fmt(period.end)}`);

  // 決済済み（exit_date/exit_priceが確定している）取引のみ対象。
  // side='pass'（見送り記録）はポジションを持っていないため除外。
  const { data: rawTrades, error } = await supabase
    .from("trades")
    .select("*")
    .neq("side", "pass")
    .not("exit_date", "is", null)
    .not("exit_price", "is", null)
    .gte("exit_date", fmt(period.start))
    .lte("exit_date", fmt(period.end));
  if (error) throw error;

  // pnlフィールドをこちらで計算して付与（LLMには計算させない）
  const trades = (rawTrades ?? []).map((t) => ({ ...t, pnl: calcPnl(t) }));

  // ユーザーごとにレポート生成。1ユーザーの失敗（Claude APIエラー等）で
  // 他ユーザー分まで巻き添えにしないよう、ループ内でエラーを捕捉して続行する。
  const byUser = Object.groupBy(trades, (t) => t.user_id);
  let hasFailure = false;
  for (const [userId, userTrades] of Object.entries(byUser)) {
    if (!userTrades?.length) continue;
    try {
      const stats = computeStats(userTrades);
      const aiSummary = await generateSummary(stats, period);

      const { error: insErr } = await supabase.from("trade_reports").upsert(
        {
          user_id: userId,
          report_type: period.type,
          period_start: fmt(period.start),
          period_end: fmt(period.end),
          stats,
          ai_summary: aiSummary,
        },
        { onConflict: "user_id,report_type,period_start" }
      );
      if (insErr) throw insErr;
      console.log(`✅ Report saved for user ${userId} (${stats.tradeCount} trades)`);
    } catch (e) {
      hasFailure = true;
      console.error(`❌ Report failed for user ${userId}:`, e);
    }
  }
  console.log("Done.");
  if (hasFailure) process.exitCode = 1; // Actions側で失敗を検知できるようにする（他ユーザー分は保存済み）
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
