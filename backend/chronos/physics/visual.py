"""可視化用データ: 計量プロファイル（2D）と光円錐（3D）。いずれも計量から厳密に計算する。"""
from __future__ import annotations

import numpy as np

from .geometry import alpha_max, static_frame
from .models import IPHI, IR, IT, SpacetimeModel


def null_directions(model: SpacetimeModel, params: dict, r: float, n: int = 32) -> np.ndarray:
    """静止観測者系で k = e0 + cosψ e_r + sinψ e_φ（y 成分 0）の零ベクトル族（座標成分 (t, r, φ)）。"""
    fr = static_frame(model.metric(r, params))
    psi = np.linspace(0, 2 * np.pi, n, endpoint=False)
    k = fr["e0"][None, :] + np.cos(psi)[:, None] * fr["er"][None, :] + np.sin(psi)[:, None] * fr["ephi"][None, :]
    return k


def profile(model: SpacetimeModel, params: dict, r_max: float = 3.0, n: int = 240) -> dict:
    rs = np.linspace(1e-3, r_max, n)
    rows = []
    for r in rs:
        g = model.metric(r, params)
        fr = static_frame(g)
        e0t, ephit = fr["e0"][IT], abs(fr["ephi"][IT])
        am = alpha_max(g)
        rows.append({
            "r": float(r),
            "g_tt": float(g[IT, IT]),
            "g_tphi": float(g[IT, IPHI]),
            "g_phiphi": float(g[IPHI, IPHI]),
            "g_rr": float(g[IR, IR]),
            # 光円錐の傾き指標: 未来零方向の dt 成分の最小値 / 静止系の dt 成分。負 ⇒ 円錐が t = 一定面より下へ傾く
            "cone_tilt": float((e0t - ephit) / e0t),
            "alpha_max": float(am) if am is not None else 0.0,
        })
    return {
        "model": model.id,
        "params": params,
        "critical_radius": model.critical_radius_analytic(params),
        "rows": rows,
        "notes": {
            "cone_tilt": "min_ψ k^t(ψ) / k^t_radial。k = e0 + cosψ e_r + sinψ e_φ（静止観測者系の零ベクトル）。0 を下回ると、未来向きの光の方向に座標時間 t が減少する方向が含まれる。",
            "alpha_max": "dt/dφ = −α の周回が未来向き時間的となる α の上限（0 = 不可能）。",
        },
    }


def lightcones(model: SpacetimeModel, params: dict, r_max: float = 2.4, n_r: int = 7, n_phi: int = 8,
               t_levels: tuple[float, ...] = (0.0,), size: float = 0.22, n_ring: int = 40) -> dict:
    """3D座標図 (X, T, Z) = (r cosφ, t, r sinφ) 上の未来光円錐。

    各円錐は頂点と、零ベクトル k^μ を座標図へ写した変位の輪からなる。表示用に最大変位長を size に正規化（向きは厳密）。
    """
    cones = []
    rs = np.linspace(r_max / n_r, r_max, n_r)
    rc = model.critical_radius_analytic(params)
    for t in t_levels:
        # 軸上（r = 0）の円錐は ∂t 方向の対称な円錐（極座標特異点を避けて小さい r で評価）
        for r in [1e-4, *rs]:
            phis = [0.0] if r < 1e-3 else np.linspace(0, 2 * np.pi, n_phi, endpoint=False)
            k = null_directions(model, params, r, n_ring)
            for phi in phis:
                dX = k[:, IR] * np.cos(phi) - r * k[:, IPHI] * np.sin(phi)
                dZ = k[:, IR] * np.sin(phi) + r * k[:, IPHI] * np.cos(phi)
                dT = k[:, IT]
                d = np.stack([dX, dT, dZ], 1)
                scale = size / np.max(np.linalg.norm(d, axis=1))
                apex = np.array([r * np.cos(phi), t, r * np.sin(phi)])
                ring = apex + d * scale
                cones.append({
                    "r": float(r),
                    "phi": float(phi),
                    "apex": apex.round(6).tolist(),
                    "ring": ring.round(6).tolist(),
                    "tipped": bool(np.min(dT) < 0),
                    "beyond_critical": bool(rc is not None and r > rc),
                })
    return {
        "model": model.id,
        "critical_radius": rc,
        "embedding": "X = r cosφ, Y(上) = t, Z = r sinφ（y 座標は省略）",
        "cones": cones,
        "note": "円錐の大きさは表示用に正規化。向き（零方向）は計量から厳密に計算。",
    }
