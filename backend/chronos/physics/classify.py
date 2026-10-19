"""計量による経路（接ベクトル）の因果的分類と誤差上界。"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = float(np.finfo(float).eps)
# 二次形式 Σ g_μν u^μ u^ν の丸め誤差の上界係数（16項の和 + sinh 評価誤差に対する保守的な倍率）
ROUNDING_FACTOR = 32.0

TIMELIKE = "timelike"
SPACELIKE = "spacelike"
BOUNDARY = "boundary"

CAUSAL_LABELS = {
    TIMELIKE: "時間的",
    SPACELIKE: "空間的",
    BOUNDARY: "境界（光的／誤差範囲内）",
}


@dataclass
class VectorClass:
    norm: float  # g(u,u)
    bound: float  # |g(u,u)| の誤差上界
    causal: str
    time_dot: float  # g(u, ∂t)
    time_dot_bound: float
    future: bool | None  # None = 判定不能

    def as_dict(self) -> dict:
        return {
            "norm": self.norm,
            "bound": self.bound,
            "causal": self.causal,
            "time_dot": self.time_dot,
            "future": self.future,
        }


def quad(g: np.ndarray, u: np.ndarray, v: np.ndarray | None = None) -> float:
    v = u if v is None else v
    return float(u @ g @ v)


def rounding_bound(g: np.ndarray, u: np.ndarray, v: np.ndarray | None = None) -> float:
    v = u if v is None else v
    return ROUNDING_FACTOR * EPS * float(np.sum(np.abs(g) * np.abs(np.outer(u, v))))


def classify_vector(g: np.ndarray, u: np.ndarray, extra_bound: float = 0.0) -> VectorClass:
    """n = g(u,u) を誤差上界 δ と比較して分類。|n| ≤ δ は BOUNDARY（符号を決められない）。

    時間向き付けは ∂t（両モデルで全域時間的: g_tt < 0）で行う。u が未来向き ⇔ g(u, ∂t) < 0。
    """
    n = quad(g, u)
    bound = rounding_bound(g, u) + extra_bound
    if n < -bound:
        causal = TIMELIKE
    elif n > bound:
        causal = SPACELIKE
    else:
        causal = BOUNDARY
    e_t = np.array([1.0, 0.0, 0.0, 0.0])
    f = quad(g, u, e_t)
    fb = rounding_bound(g, u, e_t) + extra_bound
    future = True if f < -fb else (False if f > fb else None)
    return VectorClass(n, bound, causal, f, fb, future)


def summarize(classes: list[VectorClass]) -> dict:
    counts = {TIMELIKE: 0, SPACELIKE: 0, BOUNDARY: 0}
    past = undetermined_dir = 0
    for c in classes:
        counts[c.causal] += 1
        if c.causal == TIMELIKE:
            if c.future is False:
                past += 1
            elif c.future is None:
                undetermined_dir += 1
    total = len(classes)
    if total and counts[TIMELIKE] == total and past == 0 and undetermined_dir == 0:
        overall = "timelike_future"
        label = "全区間で未来向き時間的"
    elif counts[SPACELIKE] > 0 or past > 0:
        overall = "violated"
        label = "時間的条件を満たさない区間あり（空間的または過去向き）"
    elif counts[BOUNDARY] == total and total:
        overall = "null"
        label = "全区間で光的（誤差範囲内）"
    else:
        overall = "undetermined"
        label = "誤差範囲内で符号が決まらない点を含むため判定不能"
    return {
        "total": total,
        "timelike": counts[TIMELIKE],
        "spacelike": counts[SPACELIKE],
        "boundary": counts[BOUNDARY],
        "past_directed": past,
        "direction_undetermined": undetermined_dir,
        "overall": overall,
        "label": label,
    }
