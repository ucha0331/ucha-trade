-- 週次/月次成績レポートテーブル
-- Supabase SQL Editorで実行（プロジェクト: ilgdxxcbdcxhozgmzudc = "ucha trade" Organization）
--
-- 確認事項：
-- ・既存の trades テーブルとは独立した新テーブルなので、既存データへの影響なし
-- ・書き込みは GitHub Actions の service_role キー経由のみを想定
--   （RLSで select は auth.uid() = user_id のみ許可、insert/upsertは
--    service_roleがRLSをバイパスするため個別ポリシー不要）

create table if not exists trade_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  report_type text not null check (report_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  stats jsonb not null,          -- スクリプトで計算した統計（数値の正）
  ai_summary text not null,      -- Claudeによる総括コメント
  created_at timestamptz default now(),
  unique (user_id, report_type, period_start)  -- 再実行時の重複防止
);

alter table trade_reports enable row level security;

create policy "Users can view own reports"
  on trade_reports for select
  using (auth.uid() = user_id);

-- 書き込みはservice roleキー（GitHub Actions）経由のみなのでinsertポリシーは不要
