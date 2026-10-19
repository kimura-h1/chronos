# Design — CHRONOS-001

## 1. アーキテクチャ

```
React Frontend (Vite, :5173)  ── /api proxy ──▶  FastAPI (:8000)
                                                   │
                                   ExperimentRunner (ThreadPool, stop event, JSON永続化)
                                                   │
                                   Physics Engine (SymPy記号 → NumPy数値, SciPy積分/求根, mpmath高精度参照)
                                                   │
                                   Result dict: verdict / evidence / series / path / errors / comparisons
                                                   │
                                   3D (R3F) / 2D (Recharts) 可視化
```

## 2. 物理エンジン

### 2.1 モデル（`physics/models.py`）
計量は r のみに依存する定常・軸対称形 `g(r)`（座標順 t, r, φ, y）。

| モデル | 計量 | パラメータ |
|---|---|---|
| Gödel | `4a²[−dt² + dr² + dy² + (sinh²r − sinh⁴r)dφ² − 2√2 sinh²r dt dφ]` | a（光年） |
| Minkowski | `L²[−dt² + dr² + r²dφ² + dy²]` | L（光年） |

- SymPyで g → g⁻¹ → Γ → Ricci → Einstein を導出。`lambdify` で数値関数化。
- 場の方程式検証: `G_ab + Λ g_ab = 8πρ u_a u_b`（u = 静止観測者）を Λ, ρ について解き、残差がゼロかを記号的に確認。
- 時間換算: 軸上静止観測者の固有時 dτ = √(−g_tt) dt。

### 2.2 分類（`physics/classify.py`）
- n = g_μν u^μ u^ν。誤差上界 `δ = 32 ε Σ|g_μν u^μ u^ν| + δ_extra`（ε: 倍精度マシンイプシロン、δ_extra: 積分誤差など）。
- n < −δ: 時間的、n > δ: 空間的、それ以外: 境界（判定不能／光的）。
- 未来向き: f = g(u, ∂t) < −δ_f（∂t は両モデルで全域時間的なので時間向き付けに使用）。
- 曲線全体: 全点が時間的かつ未来向き → 時間的。1点でも明確に空間的/過去向き → 非時間的。それ以外 → 判定不能。

### 2.3 実験（`physics/experiments.py`）
**(a) 円軌道CTC検証** — u = ∂φ。n = g_φφ(R)。高精度（mpmath 50桁）参照値と倍精度値を比較し数値誤差とする。
臨界半径: g_φφ の符号変化を格子走査 + Brent法で求根し、解析解 `r_c = arsinh(1) = ln(1+√2)` と比較。
固有加速度 `a^μ = Γ^μ_νρ u^ν u^ρ`（成分一定の定常曲線）、1周の固有時 `τ = 2π√(−g_φφ)`。

**(b) 測地線** — 8次元一階系 `ẍ^μ = −Γ^μ_νρ ẋ^ν ẋ^ρ` を DOP853（rtol 1e-10）でチャンク分割積分（停止要求をチャンク間で確認）。
初速度は静止観測者の正規直交系 {e0, e_r, e_φ, e_y} で指定（e_φ = (∂φ − (g_tφ/g_tt)∂t)/N）。
保存量 E = −g(u,∂t), L = g(u,∂φ), P_y = g(u,∂y)、拘束 g(u,u) のドリフトを数値誤差として表示。
有効ポテンシャル `g_rr ṙ² = V(r) = −κ + E ṫ(r) − L φ̇(r) − P_y²/g_yy`（(ṫ,φ̇) = M⁻¹(−E, L)）の根で r_max を半解析的に求め比較。
Gödel・L=0 の閉形式: `sinh² r_max = (E² − 4a²κ')/(E² + 4a²κ')`, κ' = κ + P_y²/(4a²)（null: r_max = r_c）。
r < r_axis（座標特異点）で積分終了イベント。

**(c) 過去到達ミッション** — 区分的曲線:
1. 軸 r=0 → R（φ一定、dr/dt = β）
2. r = R で N 周（dφ/dλ = 1, dt/dλ = −α）
3. R → 0 へ帰還
4. 軸上で出発時刻まで静止待機（これで閉曲線になる）

後退率の上限 `α_max = (g_tφ + √(g_tφ² − g_tt g_φφ))/g_tt`（時間的かつ未来向きとなる最大値。正値が存在しない半径では過去向き周回は不可能）。
折れ点の速度変化: `cosh Δη = −g(û₁, û₂)`。総ラピディティ `η_tot = Σ∫|a|dτ + ΣΔη`、理想光子ロケット質量比 `exp(η_tot)`。
η_tot はスケール a に依存しない（加速度 ∝ 1/a、時間 ∝ a）。

### 2.4 判定の表示
各結果は `verdict = {math: 成立|不成立|判定不能, physical: "未確立", label, reason}` と `evidence[]`（式・値・誤差）を持つ。

## 3. API

| Method | Path | 説明 |
|---|---|---|
| GET | /api/health | 稼働確認 |
| GET | /api/models | モデル一覧（計量式、パラメータ、出典） |
| GET | /api/models/{id}/verification | 記号計算による場の方程式検証 |
| GET | /api/models/{id}/profile | 計量成分・光円錐傾き vs r（2D用） |
| GET | /api/models/{id}/lightcones | 3D用光円錐（計量から計算） |
| GET | /api/constraints | 未解決の物理的制約 |
| POST | /api/experiments | 実験開始（`preview=true` で同期計算・履歴に保存しない） |
| GET | /api/experiments | 履歴一覧（要約） |
| GET | /api/experiments/{id} | 詳細 |
| POST | /api/experiments/{id}/stop | 停止 |
| GET | /api/experiments/{id}/download | JSON |
| DELETE | /api/experiments/{id} | 削除 |

## 4. フロントエンド
- タブ: ダッシュボード / 時空ビジュアライザ / 実験制御 / 結果解析（URL hash で保持）。
- 3D座標図: X = r cosφ, Z = r sinφ, 上方向 = t（y は省略）。光円錐はバックエンド計算の零ベクトル（座標成分）を描画。r > r_c で円錐が水平面より下へ傾く（φ方向が時間的）ことが直接見える。
- 実験経路を重ね描き。CTC判定が「成立」の経路はマゼンタで発光表示。
- 実行中ジョブはポーリング（500ms）。
- テーマ: ダーク、研究施設コンソール風（等幅数字、ステータスランプ、グリッド）。

## 5. エラー/不確実性
- 積分失敗・特異点到達は `warnings[]` に記録。
- 判定不能は色分け（アンバー）し、成立（シアン/マゼンタ）・不成立（グレー/赤）と区別。
