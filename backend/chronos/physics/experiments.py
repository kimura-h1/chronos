"""CHRONOS-001 の実験: 円軌道CTC検証 / 測地線積分 / 過去到達ミッション。

各実験は純粋関数で、結果 dict（判定・計算根拠・誤差・解析比較・グラフ・3D経路）を返す。
"""
from __future__ import annotations

import math
import threading
from collections.abc import Callable
from typing import Any

import mpmath
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import minimize_scalar

from .classify import BOUNDARY, CAUSAL_LABELS, SPACELIKE, TIMELIKE, VectorClass, classify_vector, summarize
from .geometry import (
    alpha_max,
    conserved,
    effective_potential,
    embed,
    find_critical_radius,
    proper_acceleration,
    rapidity_between,
    static_frame,
    turning_radius,
)
from .models import IPHI, IT, SpacetimeModel

# 1 光年/年² を m/s² で（光年 = 9460730472580800 m, ユリウス年 = 31557600 s）、標準重力 9.80665 m/s²
LY_PER_YR2_IN_G = 9460730472580800 / 31557600**2 / 9.80665

PHYSICAL_STATUS = "未確立"
COMMON_CAVEATS = [
    "本結果は与えられた計量の中での数学的判定であり、現実の宇宙で時間移動が可能であることを示すものではありません。",
    "物理的実現性は「未確立」です。実現を示す実験的・観測的根拠は存在しません。",
]
GODEL_CAVEATS = [
    "観測される宇宙は膨張しており、宇宙マイクロ波背景放射の等方性は大域的回転を強く制限します。我々の宇宙はGödel解ではありません。",
    "Gödel解は負の宇宙定数 Λ = −1/(2a²) を要求します（観測される加速膨張は正の宇宙定数と整合的）。",
]


class ExperimentInputError(ValueError):
    pass


class StopRequested(Exception):
    pass


class Context:
    def __init__(self, progress: Callable[[float, str], None] | None = None, stop_event: threading.Event | None = None):
        self._progress = progress or (lambda p, m: None)
        self.stop_event = stop_event or threading.Event()

    def progress(self, frac: float, msg: str = "") -> None:
        self._progress(float(min(max(frac, 0.0), 1.0)), msg)

    @property
    def stopped(self) -> bool:
        return self.stop_event.is_set()


# ---------------------------------------------------------------- helpers
def _downsample(arr: np.ndarray, n: int) -> np.ndarray:
    if len(arr) <= n:
        return arr
    idx = np.unique(np.linspace(0, len(arr) - 1, n).round().astype(int))
    return arr[idx]


def _f(x: Any) -> Any:
    """JSON 安全な float（NaN/inf は None）。"""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return x
    return v if math.isfinite(v) else None


def _ev(label: str, formula: str, value: Any, detail: str = "", unit: str = "") -> dict:
    return {"label": label, "formula": formula, "value": _f(value) if isinstance(value, (int, float, np.floating)) else value, "unit": unit, "detail": detail}


def _cmp(label: str, numeric: float | None, analytic: float | None, method: str, analytic_label: str = "解析解") -> dict:
    abs_err = rel_err = None
    if numeric is not None and analytic is not None:
        abs_err = abs(numeric - analytic)
        rel_err = abs_err / abs(analytic) if analytic != 0 else None
    return {
        "label": label,
        "numeric": _f(numeric),
        "analytic": _f(analytic),
        "analytic_label": analytic_label,
        "abs_error": _f(abs_err),
        "rel_error": _f(rel_err),
        "method": method,
    }


def _metric(label: str, value: Any, unit: str = "") -> dict:
    return {"label": label, "value": _f(value), "unit": unit}


def _verdict(math_status: str, label: str, reason: str) -> dict:
    assert math_status in ("成立", "不成立", "判定不能")
    return {"math": math_status, "physical": PHYSICAL_STATUS, "label": label, "reason": reason}


def _caveats(model: SpacetimeModel, extra: list[str] | None = None) -> list[str]:
    out = list(COMMON_CAVEATS)
    if model.id == "godel":
        out += GODEL_CAVEATS
    return out + (extra or [])


def _scale(model: SpacetimeModel, params: dict) -> float:
    return float(model.pvals(params)[0])


def _model_params(model: SpacetimeModel, params: dict) -> dict:
    return {p.key: float(params.get(p.key, p.default)) for p in model.params}


def gphiphi_profile_chart(model: SpacetimeModel, mp: dict, r_hi: float, marks: list[dict]) -> dict:
    rs = np.linspace(1e-3, r_hi, 300)
    data = [{"r": float(r), "g_phiphi": float(model.metric(r, mp)[IPHI, IPHI])} for r in rs]
    rc = model.critical_radius_analytic(mp)
    refs = [{"axis": "y", "value": 0.0, "label": "g_φφ = 0"}] + marks
    if rc is not None:
        refs.append({"axis": "x", "value": rc, "label": "r_c"})
    return {
        "id": "gphiphi_vs_r",
        "title": "g_φφ(r)：負の領域で φ 方向の円が時間的",
        "x": {"key": "r", "label": "r（無次元座標）"},
        "lines": [{"key": "g_phiphi", "label": "g_φφ [光年²]"}],
        "data": data,
        "refs": refs,
    }


# ---------------------------------------------------------------- (a) circle
def run_circle(model: SpacetimeModel, params: dict, ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
    mp = _model_params(model, params)
    R = float(params.get("R", 1.2))
    t0 = float(params.get("t0", 0.0))
    if not (0 < R <= 10):
        raise ExperimentInputError("半径 R は 0 < R ≤ 10 の範囲で指定してください")
    ctx.progress(0.05, "計量を評価")
    g = model.metric(R, mp)
    u = np.array([0.0, 0.0, 1.0, 0.0])
    vc = classify_vector(g, u)

    # 高精度参照値（mpmath 50桁）との差 = 実際の数値誤差
    with mpmath.workdps(50):
        n_hp = model.metric_mp(R, mp)[IPHI][IPHI]
        float_err = float(abs(mpmath.mpf(vc.norm) - n_hp))
        n_hp_str = mpmath.nstr(n_hp, 30)
    ctx.progress(0.3, "臨界半径を求根")
    rc_num = find_critical_radius(model, mp)
    rc_an = model.critical_radius_analytic(mp)
    if ctx.stopped:
        raise StopRequested

    is_ctc: bool | None
    if vc.causal == TIMELIKE and vc.future is True:
        is_ctc = True
        verdict = _verdict("成立", "閉じた時間的曲線（CTC）である（数学的）",
                           f"g_φφ(R) = {vc.norm:.6e} < 0（誤差上界 {vc.bound:.1e} を超えて負）かつ g(∂φ,∂t) < 0 で未来向き。φ ~ φ+2π の同一視により閉曲線。")
    elif vc.causal == SPACELIKE:
        is_ctc = False
        verdict = _verdict("不成立", "CTCではない（円は空間的）",
                           f"g_φφ(R) = {vc.norm:.6e} > 0（誤差上界 {vc.bound:.1e}）のため曲線は空間的。")
    else:
        is_ctc = None
        verdict = _verdict("判定不能", "判定不能（誤差範囲内で g_φφ の符号が決まらない）",
                           f"|g_φφ(R)| = {abs(vc.norm):.3e} ≤ 誤差上界 {vc.bound:.3e}。R が臨界半径にきわめて近い。")

    s_formula = str(model.g_sym[IPHI, IPHI])
    evidence = [
        _ev("接ベクトル", "u = ∂φ（t, r, y 一定、φ ∈ [0, 2π)）", "u^μ = (0, 0, 1, 0)"),
        _ev("ノルム g(u,u) = g_φφ(R)", f"g_φφ = {s_formula}", vc.norm, f"高精度参照値 {n_hp_str}", "光年²"),
        _ev("丸め誤差上界 δ", "δ = 32 ε Σ|g_μν u^μ u^ν|", vc.bound, f"実測誤差 |倍精度 − 50桁| = {float_err:.2e}"),
        _ev("分類", "n < −δ: 時間的 / n > δ: 空間的 / |n| ≤ δ: 判定不能", CAUSAL_LABELS[vc.causal]),
        _ev("時間向き g(u, ∂t) = g_tφ", "未来向き ⇔ g(u,∂t) < 0", vc.time_dot,
            "未来向き" if vc.future else ("過去向き" if vc.future is False else "判定不能")),
        _ev("閉曲線性", "φ と φ+2π は同一点（座標の同一視）", "閉曲線（位相的に厳密）"),
    ]
    comparisons = []
    if rc_an is not None or rc_num is not None:
        comparisons.append(_cmp("臨界半径 r_c（g_φφ = 0）", rc_num, rc_an, "格子走査 + Brent法（倍精度）", "ln(1+√2)"))
        evidence.append(_ev("臨界半径", "g_φφ(r_c) = 0 ⇔ sinh r_c = 1", rc_num, f"解析解 {rc_an!r}"))
    errors = [
        {"label": "g_φφ(R) の数値誤差（倍精度 vs 50桁）", "value": _f(float_err), "note": "mpmath 50桁を参照値とする"},
        {"label": "g_φφ(R) の誤差上界 δ（判定に使用）", "value": _f(vc.bound), "note": "判定は |n| > δ の場合のみ確定"},
    ]
    if rc_an is not None and rc_num is not None:
        errors.append({"label": "r_c 求根誤差", "value": _f(abs(rc_num - rc_an)), "note": "解析解との差"})

    metrics = {"g_phiphi": _metric("g_φφ(R)", vc.norm, "光年²")}
    charts = [gphiphi_profile_chart(model, mp, max(3.0, 1.3 * R), [{"axis": "x", "value": R, "label": "R"}])]
    ctx.progress(0.6, "固有時・加速度を計算")

    def loop_cost(r: float) -> tuple[float, float, float] | None:
        gg = model.metric(r, mp)
        n = gg[IPHI, IPHI]
        if n >= 0:
            return None
        uu = u / np.sqrt(-n)
        acc = proper_acceleration(model, mp, r, uu)
        tau = 2 * np.pi * np.sqrt(-n)
        return tau, acc, acc * tau

    if is_ctc:
        tau, acc, eta = loop_cost(R)
        metrics.update({
            "tau_loop": _metric("1周の固有時間 τ", tau, "年"),
            "accel": _metric("固有加速度 |a|", acc * LY_PER_YR2_IN_G, "g"),
            "eta_loop": _metric("1周に要するラピディティ η = |a|τ", eta, ""),
            "log10_mass_ratio": _metric("理想光子ロケット質量比 log10(M0/M1)", eta / np.log(10), ""),
        })
        evidence += [
            _ev("1周の固有時間", "τ = 2π √(−g_φφ)", tau, "", "年"),
            _ev("固有加速度", "a^μ = Γ^μ_νρ u^ν u^ρ（u = ∂φ/√(−g_φφ)）", acc * LY_PER_YR2_IN_G,
                "測地線ではないため推力が必要", "g"),
            _ev("推進コスト", "質量比 = exp(∫|a|dτ)（排気速度 c の理想ロケット）", f"10^{eta / np.log(10):.3f}"),
        ]
    if rc_an is not None or rc_num is not None:
        rc = rc_num or rc_an
        rs = np.linspace(rc + 0.01, max(3.0, 1.3 * R), 220)
        data = []
        for r in rs:
            c = loop_cost(r)
            if c:
                data.append({"r": float(r), "tau": float(c[0]), "accel_g": float(c[1] * LY_PER_YR2_IN_G), "eta": float(c[2])})
        opt = minimize_scalar(lambda r: (loop_cost(r) or (np.inf,) * 3)[2], bounds=(rc + 1e-4, 6.0), method="bounded")
        charts.append({
            "id": "circle_cost_vs_r",
            "title": "円軌道CTCのコスト（1周あたり）",
            "x": {"key": "r", "label": "R（無次元座標）"},
            "lines": [{"key": "eta", "label": "ラピディティ η = ∫|a|dτ"}, {"key": "tau", "label": "固有時 τ [年]"}],
            "data": data,
            "refs": [{"axis": "x", "value": R, "label": "R"}, {"axis": "x", "value": float(opt.x), "label": "η最小"}],
        })
        evidence.append(_ev("η 最小となる円の半径", "min_R ∫|a|dτ（円軌道族内）", float(opt.x),
                            f"η_min = {opt.fun:.4f}（スケール a に依存しない無次元量）"))
        metrics["eta_min_radius"] = _metric("η最小となる半径", float(opt.x), "")

    ctx.progress(0.9, "3D経路を生成")
    phis = np.linspace(0, 2 * np.pi, 181)
    pts = embed(np.full_like(phis, t0), np.full_like(phis, R), phis)
    path = {
        "segments": [{"label": f"円 r = {R:g}", "points": pts.round(6).tolist(), "causal": vc.causal, "highlight": bool(is_ctc)}],
        "closed": True,
    }
    return {
        "type": "circle",
        "title": f"円軌道 R = {R:g}",
        "model": model.id,
        "params": {**mp, "R": R, "t0": t0},
        "verdict": verdict,
        "is_ctc": is_ctc,
        "classification": summarize([vc]),
        "evidence": evidence,
        "comparisons": comparisons,
        "errors": errors,
        "metrics": metrics,
        "charts": charts,
        "path": path,
        "warnings": [],
        "caveats": _caveats(model, ["円軌道は測地線ではありません。維持には一定の推力（固有加速度）が必要です。"]),
    }


# ---------------------------------------------------------------- (b) geodesic
def run_geodesic(model: SpacetimeModel, params: dict, ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
    mp = _model_params(model, params)
    a = _scale(model, params)
    r0 = float(params.get("r0", 0.01))
    kind = params.get("kind", "null")
    speed = float(params.get("speed", 0.6))
    psi = math.radians(float(params.get("psi_deg", 0.0)))
    elev = math.radians(float(params.get("elev_deg", 0.0)))
    lock_L0 = bool(params.get("lock_L0", True))
    lam_max = float(params.get("lambda_max", 6.0))
    t0 = 0.0
    if kind not in ("null", "timelike"):
        raise ExperimentInputError("kind は 'null' か 'timelike'")
    if not (1e-3 <= r0 <= 8):
        raise ExperimentInputError("r0 は 0.001 ≤ r0 ≤ 8（r = 0 は極座標の特異点）")
    if kind == "timelike" and not (0 <= speed < 1):
        raise ExperimentInputError("時間的測地線の速さは 0 ≤ v < 1")
    if not (0 < lam_max <= 200):
        raise ExperimentInputError("積分区間 λ_max は 0 < λ_max ≤ 200")

    g0 = model.metric(r0, mp)
    fr = static_frame(g0)
    vtot = 1.0 if kind == "null" else speed
    vy = vtot * math.sin(elev)
    if lock_L0:
        e0phi = (g0 @ fr["e0"])[IPHI]
        ephiphi = (g0 @ fr["ephi"])[IPHI]
        vphi = -e0phi / ephiphi
        vr2 = vtot**2 - vy**2 - vphi**2
        if vr2 < 0:
            raise ExperimentInputError(
                f"r0 = {r0} では L = 0 に必要な方位速度 v_φ = {vphi:.4f} が速さ {vtot:.4f} を超えるため、L = 0 の初期条件を作れません。"
            )
        vr = math.sqrt(vr2) * (1 if math.cos(psi) >= 0 else -1)
    else:
        vr = vtot * math.cos(elev) * math.cos(psi)
        vphi = vtot * math.cos(elev) * math.sin(psi)
    n_vec = vr * fr["er"] + vphi * fr["ephi"] + vy * fr["ey"]
    if kind == "null":
        u0 = fr["e0"] + n_vec
        kappa = 0.0
    else:
        gamma = 1 / math.sqrt(1 - vtot**2)
        u0 = gamma * (fr["e0"] + n_vec)
        kappa = 1.0
    x0 = np.array([t0, r0, 0.0, 0.0])
    E0, L0, Py0 = conserved(g0, u0)
    norm0 = float(u0 @ g0 @ u0)

    r_axis = 1e-4
    r_escape = 12.0

    def rhs(_lam, s):
        gam = model.christoffel(s[1], mp)
        u = s[4:]
        return np.concatenate([u, -np.einsum("mij,i,j->m", gam, u, u)])

    def ev_axis(_l, s):
        return s[1] - r_axis
    ev_axis.terminal = True
    ev_axis.direction = -1

    def ev_escape(_l, s):
        return s[1] - r_escape
    ev_escape.terminal = True
    ev_escape.direction = 1

    def ev_rmax(_l, s):
        return s[5]
    ev_rmax.direction = -1

    n_chunks = 40
    edges = np.linspace(0, lam_max, n_chunks + 1)
    lams: list[np.ndarray] = []
    states: list[np.ndarray] = []
    rmax_events: list[np.ndarray] = []
    warnings: list[str] = []
    stopped = False
    state = np.concatenate([x0, u0])
    for k in range(n_chunks):
        if ctx.stopped:
            stopped = True
            break
        sol = solve_ivp(rhs, (edges[k], edges[k + 1]), state, method="DOP853", rtol=1e-11, atol=1e-13,
                        t_eval=np.linspace(edges[k], edges[k + 1], 60), events=[ev_axis, ev_escape, ev_rmax])
        if sol.status == -1:
            warnings.append(f"積分失敗: {sol.message}")
            break
        lams.append(sol.t)
        states.append(sol.y.T)
        if sol.y_events[2].size:
            rmax_events.extend(sol.y_events[2])
        if sol.status == 1:
            if sol.t_events[0].size:
                warnings.append(f"r < {r_axis}（極座標の軸 = 座標特異点）に到達したため λ = {sol.t_events[0][0]:.4f} で積分を終了。")
            elif sol.t_events[1].size:
                warnings.append(f"r > {r_escape} に到達したため積分を終了。")
            break
        state = sol.y[:, -1]
        ctx.progress(0.05 + 0.75 * (k + 1) / n_chunks, f"測地線を積分中 λ = {edges[k + 1]:.3f}")
    if not lams:
        raise StopRequested
    lam = np.concatenate(lams)
    S = np.vstack(states)
    # 重複点（チャンク境界）を除去
    keep = np.concatenate([[True], np.diff(lam) > 0])
    lam, S = lam[keep], S[keep]

    norms, Es, Ls, Pys, classes = [], [], [], [], []
    for s in S:
        g = model.metric(s[1], mp)
        u = s[4:]
        norms.append(float(u @ g @ u))
        e, ang, p = conserved(g, u)
        Es.append(e), Ls.append(ang), Pys.append(p)
    norms = np.array(norms)
    drift = np.abs(norms - norm0)
    max_drift = float(drift.max())
    for s in S:
        classes.append(classify_vector(model.metric(s[1], mp), s[4:], extra_bound=2 * max_drift + 1e-300))
    summary = summarize(classes)
    dE = np.abs(np.array(Es) - E0)
    dL = np.abs(np.array(Ls) - L0)
    dP = np.abs(np.array(Pys) - Py0)

    # 解析比較
    r_num = float(rmax_events[0][1]) if rmax_events else None
    r_semi = turning_radius(model, mp, r0, E0, L0, Py0, kappa)
    r_closed = None
    l_small = abs(L0) <= 1e-9 * abs(E0) * a
    if model.id == "godel" and l_small:
        kp = kappa + Py0**2 / (4 * a**2)
        s2 = (E0**2 - 4 * a**2 * kp) / (E0**2 + 4 * a**2 * kp)
        r_closed = float(np.arcsinh(np.sqrt(s2))) if s2 >= 0 else 0.0
    rc = model.critical_radius_analytic(mp)
    comparisons = []
    if r_num is not None or r_semi is not None:
        comparisons.append(_cmp("最大到達半径 r_max（数値積分 vs 有効ポテンシャル）", r_num, r_semi,
                                "ṙ = 0 イベント（DOP853） vs V(r) = 0 の Brent 求根", "有効ポテンシャル"))
    if r_closed is not None:
        comparisons.append(_cmp("最大到達半径 r_max（数値積分 vs 閉形式, L=0）", r_num, r_closed,
                                "sinh² r_max = (E² − 4a²κ')/(E² + 4a²κ')", "閉形式"))
        if kind == "null" and abs(Py0) < 1e-12 and rc is not None:
            comparisons.append(_cmp("光的測地線の r_max と臨界半径 r_c（既知結果: 一致）", r_num, rc,
                                    "Hawking & Ellis §5.7: 軸からの光的測地線は r_c で転回", "r_c = ln(1+√2)"))

    # 閉曲線検出（始点への回帰）
    P = embed(S[:, 0], S[:, 1], S[:, 2])
    sp_dist = np.sqrt((P[:, 0] - P[0, 0]) ** 2 + (P[:, 2] - P[0, 2]) ** 2 + (S[:, 3] - S[0, 3]) ** 2)
    late = lam > 0.05 * lam[-1]
    min_return = float(sp_dist[late].min()) if late.any() else float("inf")
    closed = bool(min_return < 1e-6 and S[late][np.argmin(sp_dist[late]), 0] <= t0)
    crossed_rc = bool(rc is not None and S[:, 1].max() > rc)

    if closed and summary["overall"] == "timelike_future":
        verdict = _verdict("成立", "閉じた時間的測地線を検出（数学的）", "始点に回帰し、全区間で未来向き時間的。")
        is_ctc = True
    elif summary["overall"] == "undetermined":
        verdict = _verdict("判定不能", "判定不能", summary["label"])
        is_ctc = None
    else:
        is_ctc = False
        known = "既知結果（Gödel時空に閉じた時間的測地線は存在しない）と整合。" if model.id == "godel" else ""
        verdict = _verdict("不成立", "閉じた経路にならない（積分区間内）",
                           f"積分区間 λ ∈ [0, {lam[-1]:.3f}] で始点の空間位置への回帰なし（最小距離 {min_return:.3e}）。{known}")
    ctype = {"timelike_future": "時間的（未来向き）", "null": "光的（誤差範囲内）"}.get(summary["overall"], summary["label"])
    ts = model.time_scale(mp)
    evidence = [
        _ev("測地線方程式", "d²x^μ/dλ² = −Γ^μ_νρ (dx^ν/dλ)(dx^ρ/dλ)", "DOP853, rtol = 1e-11, atol = 1e-13"),
        _ev("初期4元速度", "u = γ(e₀ + v_r e_r + v_φ e_φ + v_y e_y)（静止観測者の正規直交系）",
            f"v_r = {vr:.6f}, v_φ = {vphi:.6f}, v_y = {vy:.6f}"),
        _ev("保存量 E", "E = −g(u, ∂t)", E0),
        _ev("保存量 L", "L = g(u, ∂φ)", L0, "L = 0 に拘束" if lock_L0 else ""),
        _ev("保存量 P_y", "P_y = g(u, ∂y)", Py0),
        _ev("経路の分類", "全点で g(u,u) の符号を誤差上界付きで判定", ctype,
            f"時間的 {summary['timelike']} / 空間的 {summary['spacelike']} / 境界 {summary['boundary']}（全 {summary['total']} 点）"),
        _ev("臨界半径の超過", "max r > r_c ?", "超えた" if crossed_rc else "超えない", f"max r = {S[:, 1].max():.9f}"),
        _ev("始点への回帰", "min |x_spatial(λ) − x_spatial(0)|", min_return),
    ]
    errors = [
        {"label": "拘束 g(u,u) のドリフト max|Δ|", "value": _f(max_drift), "note": "理論値は一定（測地線で保存）"},
        {"label": "E の相対誤差 max|ΔE|/|E₀|", "value": _f(dE.max() / abs(E0)), "note": "Killing ベクトル ∂t に対応"},
        {"label": "L の絶対誤差 max|ΔL|", "value": _f(dL.max()), "note": "Killing ベクトル ∂φ に対応"},
        {"label": "P_y の絶対誤差 max|ΔP_y|", "value": _f(dP.max()), "note": "Killing ベクトル ∂y に対応"},
    ]
    if r_num is None:
        warnings.append("積分区間内で最大半径（ṙ = 0）に到達しませんでした。λ_max を大きくしてください。")

    ctx.progress(0.85, "グラフを生成")
    idx = np.arange(len(lam))
    sel = _downsample(idx, 800)
    data_r = [{"lambda": float(lam[i]), "r": float(S[i, 1]), "t_years": float(S[i, 0] * ts),
               "drift": float(max(drift[i], 1e-18)), "dE": float(max(dE[i] / abs(E0), 1e-18))} for i in sel]
    refs_r = []
    if rc is not None:
        refs_r.append({"axis": "y", "value": rc, "label": "r_c"})
    if r_semi is not None:
        refs_r.append({"axis": "y", "value": r_semi, "label": "r_max（解析）"})
    charts = [
        {"id": "geo_r", "title": "半径 r(λ)", "x": {"key": "lambda", "label": "アフィンパラメータ λ"},
         "lines": [{"key": "r", "label": "r"}], "data": data_r, "refs": refs_r},
        {"id": "geo_t", "title": "座標時間 t(λ)（軸上静止観測者の時間 [年]）", "x": {"key": "lambda", "label": "λ"},
         "lines": [{"key": "t_years", "label": "t [年]"}], "data": data_r, "refs": []},
        {"id": "geo_err", "title": "数値誤差: 拘束ドリフトと E の相対誤差", "x": {"key": "lambda", "label": "λ"},
         "lines": [{"key": "drift", "label": "|Δg(u,u)|"}, {"key": "dE", "label": "|ΔE|/|E₀|"}], "data": data_r,
         "refs": [], "yScale": "log"},
    ]
    vr_grid = np.linspace(max(r0 * 0.5, 1e-3), max(3.0, (r_semi or 1.5) * 1.3), 300)
    charts.append({
        "id": "geo_veff", "title": "有効ポテンシャル V(r) = g_rr ṙ²（V ≥ 0 の領域のみ到達可能）",
        "x": {"key": "r", "label": "r"}, "lines": [{"key": "V", "label": "V(r)"}],
        "data": [{"r": float(r), "V": _f(effective_potential(model, mp, r, E0, L0, Py0, kappa))} for r in vr_grid],
        "refs": [{"axis": "y", "value": 0.0, "label": "0"}] + ([{"axis": "x", "value": rc, "label": "r_c"}] if rc else []),
    })
    pts = _downsample(P, 1500)
    metrics = {
        "r_max": _metric("最大到達半径（数値）", r_num),
        "r_max_analytic": _metric("最大到達半径（有効ポテンシャル）", r_semi),
        "drift": _metric("拘束ドリフト", max_drift),
        "E": _metric("E", E0),
        "L": _metric("L", L0),
    }
    return {
        "type": "geodesic",
        "title": f"{'光的' if kind == 'null' else '時間的'}測地線 r0 = {r0:g}",
        "model": model.id,
        "params": {**mp, "r0": r0, "kind": kind, "speed": speed, "psi_deg": math.degrees(psi),
                   "elev_deg": math.degrees(elev), "lock_L0": lock_L0, "lambda_max": lam_max},
        "verdict": verdict,
        "is_ctc": is_ctc,
        "classification": summary,
        "evidence": evidence,
        "comparisons": comparisons,
        "errors": errors,
        "metrics": metrics,
        "charts": charts,
        "path": {"segments": [{"label": "測地線", "points": pts.round(6).tolist(),
                               "causal": {"timelike_future": TIMELIKE, "null": BOUNDARY}.get(summary["overall"], SPACELIKE),
                               "highlight": False}], "closed": closed},
        "warnings": warnings,
        "stopped": stopped,
        "caveats": _caveats(model),
    }


# ---------------------------------------------------------------- (c) mission
def run_mission(model: SpacetimeModel, params: dict, ctx: Context | None = None) -> dict:
    ctx = ctx or Context()
    mp = _model_params(model, params)
    R = float(params.get("R", 1.2))
    beta = float(params.get("beta", 0.5))
    alpha_mode = params.get("alpha_mode", "fraction")
    alpha_frac = float(params.get("alpha_frac", 0.5))
    alpha_abs = float(params.get("alpha_abs", 0.1))
    auto_loops = bool(params.get("auto_loops", True))
    target_years = float(params.get("target_years", 30.0))
    loops_in = int(params.get("loops", 5))
    t0, phi0 = 0.0, 0.0
    if not (0 < R <= 6):
        raise ExperimentInputError("周回半径 R は 0 < R ≤ 6")
    if not (0 < beta < 1):
        raise ExperimentInputError("半径方向の速さ β は 0 < β < 1（座標速度 dr/dt）")

    g0 = model.metric(0.0, mp)
    ts = float(np.sqrt(-g0[IT, IT]))
    gR = model.metric(R, mp)
    am = alpha_max(gR)
    warnings: list[str] = []
    evidence: list[dict] = []
    rc = model.critical_radius_analytic(mp)

    # α_max(r) のグラフ（ミッション設計用）
    rs = np.linspace(1e-3, max(3.0, 1.3 * R), 260)
    am_data = [{"r": float(r), "alpha_max": _f(alpha_max(model.metric(r, mp)) or 0.0)} for r in rs]
    am_chart = {
        "id": "alpha_max_vs_r", "title": "過去向き周回の最大後退率 α_max(r)（0 = 不可能）",
        "x": {"key": "r", "label": "r"}, "lines": [{"key": "alpha_max", "label": "α_max = 1ラジアンあたり戻せる座標時間"}],
        "data": am_data,
        "refs": [{"axis": "x", "value": R, "label": "R"}] + ([{"axis": "x", "value": rc, "label": "r_c"}] if rc else []),
    }

    evidence.append(_ev("後退率の上限 α_max(R)",
                        "α_max = (g_tφ + √(g_tφ² − g_tt g_φφ)) / g_tt（未来向き時間的条件）",
                        am if am is not None else "存在しない（この半径では過去向き周回は時間的になり得ない）"))
    if alpha_mode == "fraction":
        if am is None:
            verdict = _verdict("不成立", "この半径では過去へ戻る周回は不可能",
                               f"r = {R:g} では g(u,u) < 0 かつ未来向きとなる α > 0 が存在しない"
                               + (f"（r_c = {rc:.6f} より内側）" if rc and R <= rc else "") + "。")
            return _mission_result(model, mp, params, verdict, False, evidence, [], [], {}, [am_chart],
                                   {"segments": [], "closed": False}, warnings, summarize([]))
        if not (0 < alpha_frac < 1):
            raise ExperimentInputError("α の割合は 0 < α/α_max < 1")
        alpha = alpha_frac * am
    else:
        alpha = alpha_abs
        if alpha <= 0:
            raise ExperimentInputError("α > 0 を指定してください")
    if auto_loops:
        if target_years <= 0:
            raise ExperimentInputError("目標年数は正の値")
        need = target_years / ts + 2 * R / beta
        loops = int(math.ceil(need / (2 * math.pi * alpha)))
        evidence.append(_ev("必要周回数", "N = ⌈(T/√(−g_tt(0)) + 2R/β) / (2π α)⌉", loops, f"目標 {target_years:g} 年前"))
    else:
        loops = loops_in
    if not (1 <= loops <= 20000):
        raise ExperimentInputError(f"周回数 {loops} は 1〜20000 の範囲外です（パラメータを見直してください）")

    ctx.progress(0.1, "区分的経路を構成")
    t1 = t0 + R / beta
    t2 = t1 - 2 * math.pi * loops * alpha
    t3 = t2 + R / beta
    dt = t3 - t0
    dt_bound = 8 * np.finfo(float).eps * (abs(t1) + abs(2 * math.pi * loops * alpha) + abs(R / beta))
    arrived_past = dt < -dt_bound
    undetermined_time = abs(dt) <= dt_bound

    legs: list[dict] = []
    eps_l = 1e-4
    lam1 = np.linspace(eps_l, 1, 400)
    legs.append({"label": "① 出発: 軸 → R", "lam": lam1,
                 "x": np.stack([t0 + R * lam1 / beta, R * lam1, np.full_like(lam1, phi0), np.zeros_like(lam1)], 1),
                 "tan": np.tile([R / beta, R, 0, 0], (len(lam1), 1)).astype(float)})
    n2 = int(min(max(200 * loops, 400), 8000))
    lam2 = np.linspace(0, 2 * math.pi * loops, n2)
    legs.append({"label": f"② 周回 ×{loops}（時間を遡る）", "lam": lam2,
                 "x": np.stack([t1 - alpha * lam2, np.full_like(lam2, R), phi0 + lam2, np.zeros_like(lam2)], 1),
                 "tan": np.tile([-alpha, 0, 1, 0], (len(lam2), 1)).astype(float)})
    lam3 = np.linspace(0, 1 - eps_l, 400)
    legs.append({"label": "③ 帰還: R → 軸", "lam": lam3,
                 "x": np.stack([t2 + R * lam3 / beta, R * (1 - lam3), np.full_like(lam3, phi0 + 2 * math.pi * loops), np.zeros_like(lam3)], 1),
                 "tan": np.tile([R / beta, -R, 0, 0], (len(lam3), 1)).astype(float)})
    if arrived_past:
        lam4 = np.linspace(0, 1, 100)
        legs.append({"label": "④ 軸上で待機 → 出発時刻（閉曲線）", "lam": lam4,
                     "x": np.stack([t3 + (t0 - t3) * lam4, np.zeros_like(lam4), np.full_like(lam4, phi0), np.zeros_like(lam4)], 1),
                     "tan": np.tile([t0 - t3, 0, 0, 0], (len(lam4), 1)).astype(float)})

    all_classes: list[VectorClass] = []
    tau_total = 0.0
    accel_int = 0.0
    max_acc = 0.0
    tl_series: list[dict] = []
    tau_cursor = 0.0
    segments = []
    for li, leg in enumerate(legs):
        if ctx.stopped:
            raise StopRequested
        ctx.progress(0.15 + 0.6 * li / len(legs), f"区間 {leg['label']} を検証")
        cls = [classify_vector(model.metric(x[1], mp), tv) for x, tv in zip(leg["x"], leg["tan"], strict=True)]
        all_classes += cls
        leg_sum = summarize(cls)
        norms = np.array([c.norm for c in cls])
        rel = np.array([c.norm / max(np.sum(np.abs(model.metric(x[1], mp)) * np.abs(np.outer(tv, tv))), 1e-300)
                        for c, x, tv in zip(cls, leg["x"], leg["tan"], strict=True)])
        leg["summary"] = leg_sum
        leg["max_norm"] = float(norms.max())
        timelike = leg_sum["overall"] == "timelike_future"
        dtau_dlam = np.sqrt(np.clip(-norms, 0, None))
        tau_leg = float(np.trapezoid(dtau_dlam, leg["lam"])) if timelike else None
        leg["tau"] = tau_leg
        acc = np.zeros(len(norms))
        if timelike and li < 3:
            uhat = leg["tan"] / dtau_dlam[:, None]
            duhat = np.gradient(uhat, leg["lam"], axis=0) / dtau_dlam[:, None]
            for k in range(len(norms)):
                acc[k] = proper_acceleration(model, mp, leg["x"][k][1], uhat[k], duhat[k])
            accel_int += float(np.trapezoid(acc * dtau_dlam, leg["lam"]))
            max_acc = max(max_acc, float(acc.max()))
        if timelike:
            taus = tau_cursor + np.concatenate([[0], np.cumsum(0.5 * (dtau_dlam[1:] + dtau_dlam[:-1]) * np.diff(leg["lam"]))])
            for k in _downsample(np.arange(len(taus)), 300):
                tl_series.append({"tau": float(taus[k]), "t_years": float(leg["x"][k][0] * ts), "rel_norm": float(rel[k]),
                                  "accel_g": float(acc[k] * LY_PER_YR2_IN_G), "leg": li + 1})
            tau_cursor = float(taus[-1])
        if tau_leg is not None:
            tau_total += tau_leg if li < 3 else 0.0
        P = embed(leg["x"][:, 0], leg["x"][:, 1], leg["x"][:, 2])
        segments.append({"label": leg["label"], "points": _downsample(P, 4000 if li == 1 else 300).round(6).tolist(),
                         "causal": TIMELIKE if timelike else (SPACELIKE if leg_sum["overall"] == "violated" else BOUNDARY),
                         "highlight": False})

    # 折れ点（瞬間的な速度変化として理想化）
    ctx.progress(0.8, "折れ点のラピディティを計算")
    u_rest = np.array([1.0, 0, 0, 0])
    kinks = []
    all_timelike = all(leg["summary"]["overall"] == "timelike_future" for leg in legs)
    if all_timelike:
        kinks.append(("出発（静止 → ①）", rapidity_between(g0, u_rest, legs[0]["tan"][0])))
        kinks.append(("① → ②（r = R）", rapidity_between(gR, legs[0]["tan"][-1], legs[1]["tan"][0])))
        kinks.append(("② → ③（r = R）", rapidity_between(gR, legs[1]["tan"][-1], legs[2]["tan"][0])))
        kinks.append(("到着（③ → 静止）", rapidity_between(g0, legs[2]["tan"][-1], u_rest)))
    kink_sum = float(sum(k[1] for k in kinks if math.isfinite(k[1]))) if all_timelike else None
    eta_total = accel_int + kink_sum if kink_sum is not None else None

    summary = summarize(all_classes)
    for leg in legs:
        evidence.append(_ev(f"区間 {leg['label']}", "max g(u,u)（< 0 なら全点時間的）", leg["max_norm"],
                            f"{leg['summary']['label']}（{leg['summary']['total']} 点）"))
    evidence += [
        _ev("採用した後退率 α", "dt/dφ = −α（周回中）", alpha, f"α/α_max = {alpha / am:.4f}" if am else "α_max なし"),
        _ev("到着時刻 − 出発時刻（座標）", "Δt = 2R/β − 2πNα", dt, f"丸め誤差上界 {dt_bound:.1e}"),
        _ev("出発地点の時計で", "Δt_home = √(−g_tt(0)) · Δt", dt * ts, "負なら出発前に到着", "年"),
    ]
    if eta_total is not None:
        evidence += [
            _ev("旅行者の固有時間", "τ = Σ ∫ √(−g(ẋ,ẋ)) dλ（①〜③）", tau_total, "", "年"),
            _ev("総ラピディティ", "η = Σ∫|a|dτ + Σ Δη_折れ点,  cosh Δη = −g(û₁,û₂)", eta_total,
                f"連続加速分 {accel_int:.4f} + 折れ点 {kink_sum:.4f}"),
            _ev("理想光子ロケット質量比", "M₀/M₁ = exp(η)", f"10^{eta_total / math.log(10):.3f}", "排気速度 c の下限評価"),
        ]

    if summary["overall"] == "violated":
        bad = [leg["label"] for leg in legs if leg["summary"]["overall"] == "violated"]
        verdict = _verdict("不成立", "時間的経路として成立しない", f"空間的または過去向きの区間: {', '.join(bad)}。")
        is_ctc = False
    elif summary["overall"] != "timelike_future" or undetermined_time:
        verdict = _verdict("判定不能", "判定不能", summary["label"] if summary["overall"] != "timelike_future"
                           else f"|Δt| = {abs(dt):.2e} が丸め誤差上界 {dt_bound:.1e} 以下。")
        is_ctc = None
    elif arrived_past:
        verdict = _verdict("成立", "出発前の時刻に出発地点へ戻る経路が存在（数学的）",
                           f"全 {summary['total']} 点で未来向き時間的。出発地点の時計で {abs(dt * ts):.4g} 年前に到着し、"
                           "④の待機区間で出発事象に戻る閉じた時間的曲線を構成。")
        is_ctc = True
        for s in segments:
            s["highlight"] = True
    else:
        verdict = _verdict("不成立", "経路は時間的だが過去には戻らない",
                           f"Δt = {dt:.6g} ≥ 0。周回数を増やすか後退率 α を大きくしてください。")
        is_ctc = False

    comparisons = []
    if am is not None:
        # α_max の閉形式（Gödel）と一般式の照合
        if model.id == "godel":
            s = math.sinh(R)
            comparisons.append(_cmp("α_max(R)：一般式 vs Gödel 閉形式", am, math.sqrt(2) * s * s - s * math.sqrt(1 + s * s),
                                    "一般式（計量成分から） vs √2 sinh²R − sinh R √(1+sinh²R)", "閉形式"))
    tau2_analytic = None
    if legs[1].get("tau") is not None:
        n2c = float(np.array([-alpha, 0, 1, 0]) @ gR @ np.array([-alpha, 0, 1, 0]))
        tau2_analytic = 2 * math.pi * loops * math.sqrt(-n2c)
        comparisons.append(_cmp("周回区間の固有時間", legs[1]["tau"], tau2_analytic, "台形則 vs 2πN√(−g(u,u))（成分一定）", "解析解"))
    errors = [{"label": "Δt の丸め誤差上界", "value": _f(dt_bound), "note": "到着時刻の符号判定に使用"}]
    if tau2_analytic is not None:
        errors.append({"label": "周回区間 τ の数値積分誤差", "value": _f(abs(legs[1]["tau"] - tau2_analytic)), "note": ""})

    metrics = {
        "dt_home_years": _metric("出発地点の時計での到着時刻差", dt * ts, "年"),
        "loops": _metric("周回数 N", loops),
        "alpha": _metric("後退率 α", alpha),
        "tau": _metric("旅行者の固有時間", tau_total if eta_total is not None else None, "年"),
        "max_accel_g": _metric("最大固有加速度（連続区間）", max_acc * LY_PER_YR2_IN_G, "g"),
        "eta": _metric("総ラピディティ η", eta_total),
        "log10_mass_ratio": _metric("質量比 log10(M0/M1)", eta_total / math.log(10) if eta_total is not None else None),
    }
    charts = [
        {"id": "mission_time", "title": "旅行者の固有時間 τ と出発地点の時計 t の関係",
         "x": {"key": "tau", "label": "旅行者の固有時間 τ [年]"}, "lines": [{"key": "t_years", "label": "出発地点の時刻 t [年]"}],
         "data": tl_series, "refs": [{"axis": "y", "value": 0.0, "label": "出発時刻"}]},
        {"id": "mission_norm", "title": "正規化ノルム g(u,u)/Σ|g_μν u^μ u^ν|（負 = 時間的）",
         "x": {"key": "tau", "label": "τ [年]"}, "lines": [{"key": "rel_norm", "label": "正規化ノルム"}],
         "data": tl_series, "refs": [{"axis": "y", "value": 0.0, "label": "光的"}]},
        {"id": "mission_accel", "title": "固有加速度（折れ点を除く連続区間）",
         "x": {"key": "tau", "label": "τ [年]"}, "lines": [{"key": "accel_g", "label": "|a| [g]"}],
         "data": tl_series, "refs": []},
        am_chart,
    ]
    extra_caveats = [
        "折れ点は瞬間的な速度変化として理想化しています（実際には有限の加速度で滑らかにする必要があります）。必要な速度変化はラピディティ Δη として計上。",
        "「過去の自分に会う」ことに伴う因果的整合性（パラドックス）の問題は、本計算の対象外で未解決です。",
    ]
    return _mission_result(model, mp, {**params, "loops_used": loops, "alpha_used": alpha}, verdict, is_ctc, evidence,
                           comparisons, errors, metrics, charts, {"segments": segments, "closed": bool(arrived_past)},
                           warnings, summary, extra_caveats, kinks)


def _mission_result(model, mp, params, verdict, is_ctc, evidence, comparisons, errors, metrics, charts, path, warnings,
                    summary, extra_caveats=None, kinks=None) -> dict:
    clean = {k: (v if isinstance(v, (bool, str)) else _f(v)) for k, v in params.items() if k not in mp}
    return {
        "type": "mission",
        "title": f"過去到達ミッション R = {float(params.get('R', 0)):g}",
        "model": model.id,
        "params": {**mp, **clean},
        "verdict": verdict,
        "is_ctc": is_ctc,
        "classification": summary,
        "evidence": evidence + [_ev(f"折れ点 {k}", "cosh Δη = −g(û₁, û₂)", v) for k, v in (kinks or [])],
        "comparisons": comparisons,
        "errors": errors,
        "metrics": metrics,
        "charts": charts,
        "path": path,
        "warnings": warnings,
        "caveats": _caveats(model, extra_caveats),
    }


RUNNERS = {"circle": run_circle, "geodesic": run_geodesic, "mission": run_mission}
EXPERIMENT_TYPES = {
    "circle": {"name": "円軌道CTC検証", "description": "t, r, y 一定の円（φ 方向）が閉じた時間的曲線かを判定し、臨界半径を解析解と照合する。"},
    "geodesic": {"name": "測地線積分", "description": "自由落下（無推力）の経路を数値積分し、保存量と最大到達半径を解析解と照合する。"},
    "mission": {"name": "過去到達ミッション", "description": "軸から出発し、周回で時間を遡って出発前の時刻に帰還する区分的経路を構成し、時間的条件とコストを評価する。"},
}
