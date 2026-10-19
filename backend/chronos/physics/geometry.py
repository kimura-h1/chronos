"""幾何ユーティリティ: 静止観測者の正規直交系、埋め込み座標、加速度、有効ポテンシャル。"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq

from .models import IPHI, IR, IT, IY, SpacetimeModel


def static_frame(g: np.ndarray) -> dict[str, np.ndarray]:
    """静止観測者（∂t に沿う）の正規直交系 {e0, e_r, e_φ, e_y}（座標成分）。r > 0 で定義。"""
    gtt, gtp, gpp = g[IT, IT], g[IT, IPHI], g[IPHI, IPHI]
    if gtt >= 0:
        raise ValueError("∂t が時間的でない点では静止観測者の系を構成できない")
    e0 = np.array([1 / np.sqrt(-gtt), 0, 0, 0])
    er = np.array([0, 1 / np.sqrt(g[IR, IR]), 0, 0])
    ey = np.array([0, 0, 0, 1 / np.sqrt(g[IY, IY])])
    n2 = gpp - gtp**2 / gtt
    if n2 <= 0:
        raise ValueError("r = 0（軸上）では φ 方向の基底を構成できない")
    nphi = np.sqrt(n2)
    ephi = np.array([-(gtp / gtt) / nphi, 0, 1 / nphi, 0])
    return {"e0": e0, "er": er, "ephi": ephi, "ey": ey}


def embed(t: np.ndarray, r: np.ndarray, phi: np.ndarray) -> np.ndarray:
    """3D表示用の座標図: (X, T, Z) = (r cosφ, t, r sinφ)。y は省略。"""
    return np.stack([r * np.cos(phi), t, r * np.sin(phi)], axis=-1)


def proper_acceleration(model: SpacetimeModel, params: dict, r: float, u: np.ndarray, du_dtau: np.ndarray | None = None) -> float:
    """固有加速度の大きさ |a|, a^μ = du^μ/dτ + Γ^μ_νρ u^ν u^ρ（u は g(u,u) = −1 に規格化済み）。"""
    gam = model.christoffel(r, params)
    nz = np.flatnonzero(u)
    a = np.zeros(4) if du_dtau is None else du_dtau.astype(float).copy()
    for mu in range(4):
        a[mu] += sum(gam[mu, i, j] * u[i] * u[j] for i in nz for j in nz)
    g = model.metric(r, params)
    a2 = float(a @ g @ a)
    return float(np.sqrt(max(a2, 0.0)))


def rapidity_between(g: np.ndarray, u1: np.ndarray, u2: np.ndarray) -> float:
    """二つの未来向き時間的単位ベクトルの間のラピディティ差 Δη: cosh Δη = −g(û1, û2)。"""
    n1 = np.sqrt(-(u1 @ g @ u1))
    n2 = np.sqrt(-(u2 @ g @ u2))
    c = -(u1 @ g @ u2) / (n1 * n2)
    return float(np.arccosh(max(c, 1.0)))


def alpha_max(g: np.ndarray) -> float | None:
    """曲線 dt/dλ = −α, dφ/dλ = 1（r, y 一定）が未来向き時間的となる α の上限。存在しなければ None。

    g(u,u) = g_tt α² − 2 g_tφ α + g_φφ < 0, かつ g(u,∂t) = −g_tt α + g_tφ < 0。
    """
    gtt, gtp, gpp = g[IT, IT], g[IT, IPHI], g[IPHI, IPHI]
    disc = gtp**2 - gtt * gpp
    if disc < 0:
        return None
    root = (gtp + np.sqrt(disc)) / gtt  # g_tt<0 なので小さい方の根
    upper_future = gtp / gtt
    am = min(root, upper_future)
    return float(am) if am > 0 else None


def conserved(g: np.ndarray, u: np.ndarray) -> tuple[float, float, float]:
    """E = −g(u,∂t), L = g(u,∂φ), P_y = g(u,∂y)。"""
    gu = g @ u
    return float(-gu[IT]), float(gu[IPHI]), float(gu[IY])


def effective_potential(model: SpacetimeModel, params: dict, r: float, E: float, L: float, Py: float, kappa: float) -> float:
    """g_rr ṙ² = V(r) = −κ + E ṫ − L φ̇ − P_y²/g_yy、(ṫ, φ̇) = M⁻¹(−E, L)。"""
    g = model.metric(r, params)
    M = np.array([[g[IT, IT], g[IT, IPHI]], [g[IT, IPHI], g[IPHI, IPHI]]])
    tdot, pdot = np.linalg.solve(M, np.array([-E, L]))
    return float(-kappa + E * tdot - L * pdot - Py**2 / g[IY, IY])


def turning_radius(model: SpacetimeModel, params: dict, r0: float, E: float, L: float, Py: float, kappa: float, r_hi: float = 12.0) -> float | None:
    """r0 より外側で最初に V が負になる点（外側転回点）を格子走査 + Brent 法で求める。"""
    grid = np.linspace(r0, r_hi, 6000)[1:]
    prev_r, prev_v = r0, effective_potential(model, params, r0, E, L, Py, kappa)
    for rr in grid:
        v = effective_potential(model, params, rr, E, L, Py, kappa)
        if prev_v >= 0 > v:
            return float(brentq(lambda x: effective_potential(model, params, x, E, L, Py, kappa), prev_r, rr, xtol=1e-14, rtol=1e-14))
        prev_r, prev_v = rr, v
    return None


def find_critical_radius(model: SpacetimeModel, params: dict, r_hi: float = 6.0) -> float | None:
    """g_φφ の符号変化（正→負）を数値的に求根。"""
    def f(rr: float) -> float:
        return model.metric(rr, params)[IPHI, IPHI]

    grid = np.linspace(1e-3, r_hi, 3000)
    vals = [f(x) for x in grid]
    for i in range(len(grid) - 1):
        if vals[i] > 0 >= vals[i + 1]:
            return float(brentq(f, grid[i], grid[i + 1], xtol=1e-15, rtol=4 * np.finfo(float).eps))
    return None
