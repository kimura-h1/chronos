# AI-DLC 運用ガイド（CHRONOS）

CHRONOS の開発は **GitHub Issues を管理元**とし、AI-DLC（AI-Driven Development Lifecycle）の 3 フェーズで進める。
調査・設計・実装・検証は Claude Code が担い、判断（要件の確定・マージ）は人間が行う。

## 1. 単位と役割

| 概念 | CHRONOS での対応 |
|---|---|
| Unit of Work | GitHub Issue 1 件 |
| Bolt（短い実装サイクル） | Issue ブランチ上のコミット群 → 1 PR |
| 人間の承認ポイント | ① Inception 完了時の受け入れ条件確定 ② PR レビューと main へのマージ |
| 仕様の置き場所 | 小規模: Issue 本文のみ ／ 中〜大規模: `.kiro/specs/<issue番号>-<slug>/`（requirements / design / tasks） |

## 2. フェーズ

### Inception（要件と受け入れ条件の確認）
1. 既存 Issue との重複を確認する（`gh issue list --search`）。
2. 関連コードを調査し、Issue に「現状」「要件」「受け入れ条件」「スコープ外」を記載する。
3. 不明点は Issue コメントで質問し、受け入れ条件を人間が確定したら `ai-dlc:construction` に進める。

### Construction（設計・実装・テスト）
1. `main` から `issue-<番号>-<slug>` ブランチを作成する。
2. 中規模以上は `.kiro/specs/` に design / tasks を作成してから実装する（小規模なら省略可）。
3. 既存機能を壊さないこと、全面リライトをしないことを原則とする。変更は Issue のスコープ内に限る。
4. テストを追加・更新する（物理: pytest、UI: Playwright E2E）。

### Operations（動作確認・品質確認）
1. 品質ゲート（下記）をすべて通す。
2. `scripts/dev.sh` で起動し、ブラウザで受け入れ条件を確認する（スクリーンショットを PR に添付）。
3. PR を作成する（`Closes #<番号>`、テスト結果、確認手順を記載）。
4. 人間がレビュー・承認した後にのみ main へマージする。

小規模な変更では、不要な工程や文書を省略してよい（省略した工程は PR に明記する）。

## 3. 品質ゲート

| 項目 | コマンド | 基準 |
|---|---|---|
| 物理・API テスト | `cd backend && .venv/bin/python -m pytest -q` | 全件合格（2026-10-20 時点のベースライン: 30 件） |
| Python lint | `cd backend && .venv/bin/ruff check .` | 指摘 0（ルールは `backend/pyproject.toml`） |
| 型チェック | `cd frontend && npx tsc -b` | エラー 0 |
| Lint | `cd frontend && npx oxlint src` | エラー 0（警告は増やさない。ベースライン 3 件） |
| ビルド | `cd frontend && npx vite build` | 成功 |
| E2E | `cd frontend && npm run test:e2e` | 全件合格 |

これらは GitHub Actions（`.github/workflows/ci.yml`）で PR と main への push のたびに自動実行される。ジョブは「Python lint」「pytest」「TypeScript 型チェック（oxlint を含む）」「フロントエンドビルド」「Playwright E2E」の 5 つ。E2E のレポートとスクリーンショットは artifact `playwright-report` から取得できる。PR は CI がすべて成功してからレビューを依頼する。

科学的正確性の原則（`.kiro/steering/product.md`）は全 Issue に適用する。特に「数学的に成立」と「物理的に実現可能」を区別し、判定不能を成功・失敗に分類しない。

## 4. GitHub 運用

- ブランチ名: `issue-<番号>-<slug>`（例: `issue-4-physics-verification`）
- コミット: 1 コミット 1 目的。メッセージ本文で Issue を参照（`Refs #4`）
- PR: テンプレート（`.github/pull_request_template.md`）に従い、関連 Issue・テスト結果・AI-DLC 各フェーズの実施内容を記載
- ラベル: `ai-dlc:inception` / `ai-dlc:construction` / `ai-dlc:operations`、領域（`area:*`）、優先度（`priority:P1`〜`P2`）
- main へのマージはリポジトリオーナーの承認後のみ
