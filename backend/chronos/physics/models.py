"""時空モデル定義。

計量は全て「r のみに依存する定常・軸対称形」 g(r)、座標順 (t, r, φ, y)、符号 (−,+,+,+)、c = G = 1。
記号計算（SymPy）で Γ・Einstein テンソルを導出し、lambdify で数値関数化する。
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from functools import cached_property
from typing import Any

import mpmath
import numpy as np
import sympy as sp

T, R, PHI, Y = sp.symbols("t r phi y", real=True)
COORDS = (T, R, PHI, Y)
COORD_LABELS = ["t", "r", "φ", "y"]
IT, IR, IPHI, IY = 0, 1, 2, 3


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    default: float
    min: float
    max: float
    unit: str
    description: str


@dataclass(frozen=True)
class Reference:
    citation: str
    note: str


class SpacetimeModel:
    id: str
    name: str
    description: str
    metric_text: str
    metric_latex: str
    params: list[ParamSpec]
    references: list[Reference]
    scale_symbol: sp.Symbol
    # 解析的に既知の臨界半径（g_φφ = 0 となる r）。存在しない場合 None
    critical_radius_expr: sp.Expr | None = None
    critical_radius_text: str | None = None
    known_results: list[str] = []

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._verification: dict[str, Any] | None = None

    # ---- symbolic -------------------------------------------------------
    def symbolic_metric(self) -> sp.Matrix:  # pragma: no cover - abstract
        raise NotImplementedError

    @cached_property
    def g_sym(self) -> sp.Matrix:
        g = self.symbolic_metric()
        assert g == g.T, "計量は対称でなければならない"
        for expr in g:
            assert not (expr.free_symbols & {T, PHI, Y}), "本エンジンは g = g(r) の計量のみ扱う"
        return g

    @cached_property
    def ginv_sym(self) -> sp.Matrix:
        return sp.simplify(self.g_sym.inv())

    @cached_property
    def christoffel_sym(self) -> list[list[list[sp.Expr]]]:
        g, gi = self.g_sym, self.ginv_sym
        x = COORDS
        out = [[[sp.Integer(0)] * 4 for _ in range(4)] for _ in range(4)]
        for l in range(4):
            for i in range(4):
                for j in range(i, 4):
                    val = sum(
                        gi[l, m] * (sp.diff(g[m, i], x[j]) + sp.diff(g[m, j], x[i]) - sp.diff(g[i, j], x[m]))
                        for m in range(4)
                    ) / 2
                    val = sp.simplify(val)
                    out[l][i][j] = out[l][j][i] = val
        return out

    def param_symbols(self) -> list[sp.Symbol]:
        return [self.scale_symbol]

    # ---- numeric --------------------------------------------------------
    @cached_property
    def _g_func(self):
        return sp.lambdify((R, *self.param_symbols()), list(self.g_sym), "numpy")

    @cached_property
    def _g_func_mp(self):
        return sp.lambdify((R, *self.param_symbols()), list(self.g_sym), "mpmath")

    @cached_property
    def _gamma_func(self):
        flat = [self.christoffel_sym[l][i][j] for l in range(4) for i in range(4) for j in range(4)]
        return sp.lambdify((R, *self.param_symbols()), flat, "numpy")

    def pvals(self, params: dict[str, float]) -> list[float]:
        return [float(params.get(p.key, p.default)) for p in self.params]

    def metric(self, r: float, params: dict[str, float]) -> np.ndarray:
        return np.array(self._g_func(float(r), *self.pvals(params)), dtype=float).reshape(4, 4)

    def metric_mp(self, r: float | str, params: dict[str, float], dps: int = 50) -> list[list]:
        """高精度（mpmath）の計量。倍精度計算の誤差評価の参照値に使う。呼び出し側も workdps 内で使うこと。"""
        with mpmath.workdps(dps):
            vals = self._g_func_mp(mpmath.mpf(r), *[mpmath.mpf(v) for v in self.pvals(params)])
            return _mp_reshape([mpmath.mpf(v) for v in vals])

    def christoffel(self, r: float, params: dict[str, float]) -> np.ndarray:
        with np.errstate(divide="ignore", invalid="ignore"):
            vals = self._gamma_func(float(r), *self.pvals(params))
        return np.array(vals, dtype=float).reshape(4, 4, 4)

    def time_scale(self, params: dict[str, float]) -> float:
        """軸上 (r=0) 静止観測者の dτ/dt = √(−g_tt(0))。座標時間 → 物理時間（年）換算係数。"""
        return float(np.sqrt(-self.metric(0.0, params)[IT, IT]))

    def critical_radius_analytic(self, params: dict[str, float]) -> float | None:
        if self.critical_radius_expr is None:
            return None
        subs = dict(zip(self.param_symbols(), self.pvals(params), strict=True))
        return float(self.critical_radius_expr.subs(subs))

    # ---- field equations ------------------------------------------------
    def verification(self) -> dict[str, Any]:
        """Einstein テンソルを記号的に計算し、G_ab + Λ g_ab = 8π ρ u_a u_b（ダスト+宇宙定数）を解く。"""
        with self._lock:
            if self._verification is None:
                self._verification = self._compute_verification()
            return self._verification

    def _compute_verification(self) -> dict[str, Any]:
        g, gi, Gam, x = self.g_sym, self.ginv_sym, self.christoffel_sym, COORDS

        def ricci(i: int, j: int) -> sp.Expr:
            return sp.simplify(
                sum(
                    sp.diff(Gam[l][i][j], x[l])
                    - sp.diff(Gam[l][i][l], x[j])
                    + sum(Gam[l][l][m] * Gam[m][i][j] - Gam[l][j][m] * Gam[m][i][l] for m in range(4))
                    for l in range(4)
                )
            )

        Ric = sp.Matrix(4, 4, lambda i, j: ricci(i, j))
        Rs = sp.simplify(sum(gi[i, j] * Ric[i, j] for i in range(4) for j in range(4)))
        G = sp.simplify(Ric - Rs * g / 2)
        # 静止観測者 u = ∂t / √(−g_tt) を物質の4元速度とする
        u = sp.Matrix([1 / sp.sqrt(-g[0, 0]), 0, 0, 0])
        u_low = g * u
        lam, rho = sp.symbols("Lambda rho", real=True)
        E = sp.simplify(G + lam * g - 8 * sp.pi * rho * u_low * u_low.T)
        # 対角成分 2 本から Λ, ρ を決め、残り全成分の残差がゼロになるかで検証する
        eqs = [E[i, i] for i in range(4) if E[i, i] != 0]
        candidates: list[dict] = []
        for i in range(len(eqs)):
            for j in range(i + 1, len(eqs)):
                candidates += sp.solve([eqs[i], eqs[j]], [lam, rho], dict=True)
            if candidates:
                break
        if not eqs:
            candidates = [{lam: sp.Integer(0), rho: sp.Integer(0)}]
        ok = False
        lam_v = rho_v = None
        for sol in candidates:
            residual = sp.simplify(E.subs(sol))
            if all(sp.simplify(c) == 0 for c in residual):
                ok = True
                lam_v, rho_v = sol.get(lam, sp.Integer(0)), sol.get(rho, sp.Integer(0))
                break
        nonzero_G = [
            {"index": f"G_{{{COORD_LABELS[i]}{COORD_LABELS[j]}}}", "latex": sp.latex(G[i, j]), "text": str(G[i, j])}
            for i in range(4)
            for j in range(i, 4)
            if G[i, j] != 0
        ]
        return {
            "model": self.id,
            "metric_components": [
                {"index": f"g_{{{COORD_LABELS[i]}{COORD_LABELS[j]}}}", "text": str(g[i, j]), "latex": sp.latex(g[i, j])}
                for i in range(4)
                for j in range(i, 4)
                if g[i, j] != 0
            ],
            "ricci_scalar": {"text": str(Rs), "latex": sp.latex(Rs)},
            "einstein_nonzero": nonzero_G,
            "ansatz": "G_ab + Λ g_ab = 8π ρ u_a u_b（ダスト＋宇宙定数, u = 静止観測者）",
            "solved": ok,
            "Lambda": {"text": str(lam_v), "latex": sp.latex(lam_v)} if lam_v is not None else None,
            "rho": {"text": str(rho_v), "latex": sp.latex(rho_v)} if rho_v is not None else None,
            "eight_pi_rho": {"text": str(sp.simplify(8 * sp.pi * rho_v))} if rho_v is not None else None,
            "method": "SymPy による記号計算（計量 → クリストッフェル記号 → リッチテンソル → Einsteinテンソル）。残差を記号的に簡約しゼロを確認。",
        }

    # ---- serialization --------------------------------------------------
    def info(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "metric_text": self.metric_text,
            "metric_latex": self.metric_latex,
            "signature": "(−, +, +, +)",
            "coordinates": COORD_LABELS,
            "units": "c = G = 1。スケールパラメータを光年で与えると、時間は年・長さは光年で換算表示。",
            "params": [p.__dict__ for p in self.params],
            "references": [r.__dict__ for r in self.references],
            "critical_radius": self.critical_radius_text,
            "known_results": self.known_results,
        }


def _mp_reshape(vals: list) -> list[list]:
    return [vals[0:4], vals[4:8], vals[8:12], vals[12:16]]


class GodelModel(SpacetimeModel):
    id = "godel"
    name = "Gödel時空"
    description = (
        "Kurt Gödel (1949) によるEinstein方程式の厳密解。一様に回転するダストと負の宇宙定数を持つ。"
        "r > ln(1+√2) では φ 方向の円が時間的になり、閉じた時間的曲線（CTC）が存在する。"
    )
    metric_text = "ds² = 4a² [ −dt² + dr² + dy² + (sinh²r − sinh⁴r) dφ² − 2√2 sinh²r dt dφ ]"
    metric_latex = (
        r"ds^2 = 4a^2\left[-dt^2 + dr^2 + dy^2 + (\sinh^2 r - \sinh^4 r)\,d\phi^2 "
        r"- 2\sqrt{2}\,\sinh^2 r\,dt\,d\phi\right]"
    )
    params = [
        ParamSpec("a", "スケール a", 1.0, 0.01, 1.0e10, "光年",
                  "Gödel解のスケール長。8πρ = 1/a², Λ = −1/(2a²)。時間・長さ・加速度の物理換算に使う。"),
    ]
    references = [
        Reference("K. Gödel, “An Example of a New Type of Cosmological Solutions of Einstein's Field Equations of Gravitation”, Rev. Mod. Phys. 21, 447 (1949).",
                  "原論文。"),
        Reference("S. W. Hawking & G. F. R. Ellis, The Large Scale Structure of Space-Time, Cambridge Univ. Press (1973), §5.7.",
                  "円筒座標形の計量と、r > ln(1+√2) の円が閉じた時間的曲線になることの解説（符号は (+,−,−,−) で記載。本システムは全体の符号を反転して使用）。"),
        Reference("S. Chandrasekhar & J. P. Wright, “The geodesics in Gödel's universe”, Proc. Natl. Acad. Sci. 47, 341 (1961).",
                  "Gödel時空の測地線の解析。閉じた時間的測地線が存在しないことの議論（書誌情報は原典で確認のこと）。"),
    ]
    critical_radius_text = "r_c = arsinh(1) = ln(1 + √2) ≈ 0.881374"
    known_results = [
        "Einstein方程式の解: 8πρ = 1/a², Λ = −1/(2a²)（Gödel 1949）",
        "r > r_c = ln(1+√2) で t, r, y 一定の円は閉じた時間的曲線（Hawking & Ellis §5.7）",
        "軸から出た光的測地線は r = r_c まで到達して軸へ再収束する（Hawking & Ellis §5.7）",
        "時空は時間的に向き付け可能だが、全ての点をCTCが通りコーシー面を持たない",
    ]

    def __init__(self) -> None:
        super().__init__()
        self.scale_symbol = sp.Symbol("a", positive=True)
        self.critical_radius_expr = sp.asinh(1)

    def symbolic_metric(self) -> sp.Matrix:
        a = self.scale_symbol
        s = sp.sinh(R)
        g = sp.zeros(4, 4)
        g[IT, IT] = -4 * a**2
        g[IR, IR] = 4 * a**2
        g[IY, IY] = 4 * a**2
        g[IPHI, IPHI] = 4 * a**2 * (s**2 - s**4)
        g[IT, IPHI] = g[IPHI, IT] = -4 * a**2 * sp.sqrt(2) * s**2
        return g


class MinkowskiModel(SpacetimeModel):
    id = "minkowski"
    name = "Minkowski時空（対照）"
    description = "重力のない平坦な時空（円筒座標）。CTCが存在しないことの対照実験に用いる。"
    metric_text = "ds² = L² [ −dt² + dr² + r² dφ² + dy² ]"
    metric_latex = r"ds^2 = L^2\left[-dt^2 + dr^2 + r^2\,d\phi^2 + dy^2\right]"
    params = [
        ParamSpec("L", "スケール L", 1.0, 0.01, 1.0e10, "光年", "座標の単位長。物理換算に使う。"),
    ]
    references = [
        Reference("C. W. Misner, K. S. Thorne & J. A. Wheeler, Gravitation, W. H. Freeman (1973).",
                  "特殊相対論の平坦時空。"),
    ]
    critical_radius_text = None
    known_results = [
        "真空解（G_ab = 0, Λ = 0）",
        "g_φφ = L² r² ≥ 0 のため φ 方向の円は時間的にならない（CTCなし）",
        "測地線は直線",
    ]

    def __init__(self) -> None:
        super().__init__()
        self.scale_symbol = sp.Symbol("L", positive=True)

    def symbolic_metric(self) -> sp.Matrix:
        L = self.scale_symbol
        return sp.diag(-(L**2), L**2, L**2 * R**2, L**2)


MODELS: dict[str, SpacetimeModel] = {m.id: m for m in (GodelModel(), MinkowskiModel())}


def get_model(model_id: str) -> SpacetimeModel:
    try:
        return MODELS[model_id]
    except KeyError as exc:
        raise KeyError(f"未知のモデル: {model_id}") from exc
