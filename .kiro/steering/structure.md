# Structure Steering

```
chronos/
├── .kiro/                 # SDD (steering + specs)
├── backend/
│   ├── chronos/
│   │   ├── physics/       # 計量・クリストッフェル・分類・実験（純粋計算、FastAPI非依存）
│   │   ├── runner.py      # 実験ジョブ管理（開始・停止・履歴永続化）
│   │   └── api.py         # FastAPI ルーティング
│   ├── tests/             # pytest
│   └── data/              # 実験履歴 JSON（gitignore）
├── frontend/
│   ├── src/
│   │   ├── api/           # バックエンドクライアントと型
│   │   ├── pages/         # Dashboard / Visualizer / ExperimentControl / ResultsAnalysis
│   │   └── components/    # UI部品・3Dシーン・チャート
│   └── e2e/               # Playwright
└── scripts/dev.sh         # 開発サーバー起動
```
