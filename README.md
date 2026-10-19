# CHRONOS — 時間移動研究プラットフォーム（MVP: CHRONOS-001）

閉じた時間的曲線（CTC）の数学的成立条件を、Gödel時空（Gödel 1949）で計算・検証・可視化する研究コンソール。

> 本システムの判定は与えられた計量内での**数学的判定**です。現実に時間移動が可能であることを示すものではありません（物理的実現性: 未確立）。

## 起動

```bash
./scripts/dev.sh
# → http://127.0.0.1:5173 （API ドキュメント: http://127.0.0.1:8000/docs）
```
初回は backend/.venv と frontend/node_modules を自動作成します（Python 3.11+, Node 20+）。

## テスト

```bash
cd backend && .venv/bin/python -m pytest -q          # 物理エンジン・API（30件）
cd frontend && npm run test:e2e                       # ブラウザ操作 E2E（Playwright）
```
WSL などで Chromium の共有ライブラリ（libnss3 など）が無い場合は `npx playwright install-deps chromium`（要 sudo）を実行するか、`LD_LIBRARY_PATH` で指定してください。

## 構成

- `.kiro/` — SDD（steering / specs: requirements → design → tasks）
- `backend/chronos/physics/` — 計量（SymPy → NumPy）、分類、測地線積分（SciPy DOP853）、実験
- `backend/chronos/runner.py` — 実験ジョブ（開始・停止・履歴 JSON 永続化 `backend/data/`）
- `frontend/src/pages/` — 研究ダッシュボード / 時空ビジュアライザ / 実験制御 / 結果解析

## 実験

| 実験 | 内容 | 照合する解析解 |
|---|---|---|
| 円軌道CTC検証 | t, r, y 一定の円が CTC か | r_c = ln(1+√2) |
| 測地線積分 | 自由落下の経路、保存量 | 最大到達半径（有効ポテンシャル・閉形式）、光的測地線は r_c で転回 |
| 過去到達ミッション | 軸→周回で時間を遡る→帰還→待機の閉曲線 | α_max の閉形式、周回区間の固有時 |
