# 地方競馬新聞

地方競馬情報サイト(keiba.go.jp)が公開している公式データダウンロード機能から
出馬表・レース一覧・オッズ・払戻金のCSVを取得し、自分競馬新聞ふうに表示するツール。

- データ元: https://www.keiba.go.jp （当日ファイル/月次ファイルのZIP CSVダウンロード）
- keiba.go.jpはCORS非対応のため、ブラウザから直接は取得できない。代わりにSupabase Edge
  Function(`supabase/functions/nar-races`)がサーバー側でCSVを取得・解凍・パースしてフロントに返す。
- DB・認証なし。Edge Functionはリクエストの都度その場で取得するだけで、何も保存しない。
- 印(◎○▲△✕)はブラウザのlocalStorageに保存(端末ローカルのみ)。

## 使い方(ローカル開発)

```bash
npm install
npm run dev
```

http://localhost:5174 を開く。`.env.local` に既存のjibun-keiba-shinbunと同じSupabaseプロジェクトの
URL/anon keyを設定しておくこと(`.env.example` 参照)。Edge Functionは事前にデプロイ済みである前提。

## デプロイ

フロントは静的ビルドなので `keiba.henatyoko.com` の配信サーバー(お名前.comレンタルサーバー、FTP)に
サブディレクトリとして置く想定(例: `keiba.henatyoko.com/chiho/`)。既存のjibun-keiba-shinbunと
同じFTP/Supabaseの認証情報を使うが、リポジトリが別なのでGitHub Secretsは別途このリポジトリにも
登録が必要(`FTP_USERNAME`, `FTP_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)。

Edge Functionのデプロイ(既存のSupabaseプロジェクトに追加する):

```bash
supabase functions deploy nar-races --project-ref lbmklokiiobgakuaohgo
```

## 過去データの一括取得(バックテスト用)

表示アプリとは別に、複数ヶ月分のレース結果・払戻金をローカルにJSONで貯めるスクリプトがある。
keiba.go.jpの月次ファイルは1998年1月以降のレース情報まで遡れる。

```bash
npm run export-history -- --months 12          # 直近12ヶ月分
npm run export-history -- --from 2025-01 --to 2025-12
npm run export-history -- --months 6 --force    # 既存キャッシュを無視して再取得
```

`history/YYYYMM.json` に1ヶ月分のレース配列(出走馬・着順・払戻金入り)が保存される。オッズ(月次)は
確定オッズのみでファイルサイズが非常に大きいため取得していない(払戻金は取得済みなので、単勝的中時の
実際の配当は分かる)。

## 仕組み

- `supabase/functions/nar-races/index.ts` が keiba.go.jp から当日/月次のZIPを取得してCSVをパースし、
  レース単位(会場+レース番号)に出馬表・オッズ・払戻金をマージしてJSONで返す。
- 当日は当日ファイル(オッズは2分毎更新の中間オッズを含む)、それ以外の日は月次ファイルから取得する。
- 月次のオッズファイルは確定オッズのみでサイズが非常に大きいため取得していない
  (過去レースの配当は `payback.csv` から取得できるため実用上は困らない)。
