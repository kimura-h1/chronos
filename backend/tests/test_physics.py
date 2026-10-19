import math

import numpy as np
import pytest

from chronos.physics.classify import BOUNDARY, SPACELIKE, TIMELIKE, classify_vector
from chronos.physics.experiments import ExperimentInputError, run_circle, run_geodesic, run_mission
from chronos.physics.geometry import alpha_max, find_critical_radius, static_frame
from chronos.physics.models import IPHI, IT, get_model
from chronos.physics.visual import lightcones, profile

RC = math.log(1 + math.sqrt(2))
GODEL = get_model("godel")
MINK = get_model("minkowski")


def test_metric_symmetric_and_matches_closed_form():
    for r in [0.0, 0.3, RC, 1.7]:
        g = GODEL.metric(r, {"a": 1.3})
        assert np.allclose(g, g.T)
        s = math.sinh(r)
        a2 = 4 * 1.3**2
        assert g[IT, IT] == pytest.approx(-a2)
        assert g[IPHI, IPHI] == pytest.approx(a2 * (s**2 - s**4), abs=1e-12)
        assert g[IT, IPHI] == pytest.approx(-a2 * math.sqrt(2) * s**2)


def test_godel_field_equations_dust_with_negative_lambda():
    v = GODEL.verification()
    assert v["solved"] is True
    assert v["Lambda"]["text"] == "-1/(2*a**2)"
    assert v["eight_pi_rho"]["text"] == "a**(-2)"


def test_minkowski_is_vacuum():
    v = MINK.verification()
    assert v["solved"] and v["Lambda"]["text"] == "0" and v["rho"]["text"] == "0"


def test_critical_radius_numeric_matches_analytic():
    rc = find_critical_radius(GODEL, {"a": 1.0})
    assert rc == pytest.approx(RC, abs=1e-14)
    assert GODEL.critical_radius_analytic({"a": 5.0}) == pytest.approx(RC)
    assert find_critical_radius(MINK, {"L": 1.0}) is None


def test_classify_vector_signs_and_boundary():
    g = np.diag([-1.0, 1.0, 1.0, 1.0])
    assert classify_vector(g, np.array([1.0, 0.5, 0, 0])).causal == TIMELIKE
    assert classify_vector(g, np.array([0.5, 1.0, 0, 0])).causal == SPACELIKE
    assert classify_vector(g, np.array([1.0, 1.0, 0, 0])).causal == BOUNDARY
    past = classify_vector(g, np.array([-1.0, 0.1, 0, 0]))
    assert past.causal == TIMELIKE and past.future is False


@pytest.mark.parametrize("R,expected", [(0.5, "不成立"), (1.2, "成立"), (2.5, "成立")])
def test_circle_verdicts(R, expected):
    res = run_circle(GODEL, {"a": 1.0, "R": R})
    assert res["verdict"]["math"] == expected
    assert res["verdict"]["physical"] == "未確立"
    assert res["is_ctc"] is (expected == "成立")


def test_circle_at_critical_radius_is_undetermined():
    res = run_circle(GODEL, {"a": 1.0, "R": RC})
    assert res["verdict"]["math"] == "判定不能"
    assert res["is_ctc"] is None


def test_circle_numeric_error_within_bound():
    res = run_circle(GODEL, {"a": 1.0, "R": 1.4})
    actual = res["errors"][0]["value"]
    bound = res["errors"][1]["value"]
    assert actual <= bound


def test_circle_minkowski_never_ctc():
    for R in [0.1, 1.0, 5.0]:
        assert run_circle(MINK, {"R": R})["verdict"]["math"] == "不成立"


def test_null_geodesic_from_axis_turns_at_critical_radius():
    """Hawking & Ellis §5.7: 軸から出た光的測地線は r = ln(1+√2) で転回する。"""
    res = run_geodesic(GODEL, {"a": 1.0, "r0": 0.01, "kind": "null", "lock_L0": True, "lambda_max": 6})
    assert res["metrics"]["r_max"]["value"] == pytest.approx(RC, abs=1e-9)
    assert res["classification"]["overall"] == "null"
    assert res["verdict"]["math"] == "不成立"  # 閉じた時間的測地線ではない


@pytest.mark.parametrize("v", [0.3, 0.6, 0.9])
def test_timelike_geodesic_rmax_closed_form(v):
    res = run_geodesic(GODEL, {"a": 2.0, "r0": 0.01, "kind": "timelike", "speed": v, "lock_L0": True, "lambda_max": 40})
    E = None
    for e in res["evidence"]:
        if e["label"] == "保存量 E":
            E = e["value"]
    a = 2.0
    s2 = (E**2 - 4 * a**2) / (E**2 + 4 * a**2)
    assert res["metrics"]["r_max"]["value"] == pytest.approx(math.asinh(math.sqrt(s2)), abs=1e-8)
    assert res["metrics"]["r_max"]["value"] < RC
    assert res["classification"]["overall"] == "timelike_future"


def test_geodesic_conservation_errors_small():
    res = run_geodesic(GODEL, {"a": 1.0, "r0": 0.5, "kind": "timelike", "speed": 0.5, "lock_L0": False,
                               "psi_deg": 30, "lambda_max": 10})
    errs = {e["label"]: e["value"] for e in res["errors"]}
    assert errs["拘束 g(u,u) のドリフト max|Δ|"] < 1e-9
    assert errs["E の相対誤差 max|ΔE|/|E₀|"] < 1e-9


def test_geodesic_l0_impossible_beyond_rc():
    with pytest.raises(ExperimentInputError):
        run_geodesic(GODEL, {"a": 1.0, "r0": 1.2, "kind": "null", "lock_L0": True})


def test_alpha_max_godel_closed_form_and_minkowski_none():
    for R in [1.0, 1.5, 2.2]:
        s = math.sinh(R)
        assert alpha_max(GODEL.metric(R, {"a": 1.0})) == pytest.approx(math.sqrt(2) * s * s - s * math.sqrt(1 + s * s))
    assert alpha_max(GODEL.metric(0.5, {"a": 1.0})) is None
    assert alpha_max(MINK.metric(1.0, {"L": 1.0})) is None


def test_mission_reaches_past_in_godel():
    res = run_mission(GODEL, {"a": 1.0, "R": 1.2, "beta": 0.5, "alpha_frac": 0.5, "auto_loops": True, "target_years": 30})
    assert res["verdict"]["math"] == "成立"
    assert res["verdict"]["physical"] == "未確立"
    assert res["metrics"]["dt_home_years"]["value"] <= -30
    assert res["path"]["closed"] is True
    assert res["metrics"]["eta"]["value"] > 0


def test_mission_eta_is_scale_invariant():
    p = {"R": 1.3, "beta": 0.4, "alpha_frac": 0.6, "auto_loops": False, "loops": 8}
    e1 = run_mission(GODEL, {**p, "a": 1.0})["metrics"]["eta"]["value"]
    e2 = run_mission(GODEL, {**p, "a": 1000.0})["metrics"]["eta"]["value"]
    assert e1 == pytest.approx(e2, rel=1e-9)


def test_mission_violations():
    # r_c より内側では過去向き周回は不可能
    assert run_mission(GODEL, {"a": 1.0, "R": 0.6})["verdict"]["math"] == "不成立"
    # α を上限より大きく取ると空間的区間が生じる
    s = math.sinh(1.2)
    am = math.sqrt(2) * s * s - s * math.sqrt(1 + s * s)
    res = run_mission(GODEL, {"a": 1.0, "R": 1.2, "alpha_mode": "absolute", "alpha_abs": am * 1.5, "auto_loops": False, "loops": 3})
    assert res["verdict"]["math"] == "不成立"
    # Minkowski
    assert run_mission(MINK, {"R": 1.2})["verdict"]["math"] == "不成立"


def test_static_frame_orthonormal():
    g = GODEL.metric(1.4, {"a": 1.0})
    fr = static_frame(g)
    E = np.array([fr["e0"], fr["er"], fr["ephi"], fr["ey"]])
    assert np.allclose(E @ g @ E.T, np.diag([-1, 1, 1, 1]), atol=1e-12)


def test_lightcones_tip_beyond_critical_radius():
    data = lightcones(GODEL, {"a": 1.0}, r_max=2.4, n_r=6)
    for c in data["cones"]:
        assert c["tipped"] == c["beyond_critical"], c["r"]
    assert not any(c["tipped"] for c in lightcones(MINK, {"L": 1.0})["cones"])


def test_profile_cone_tilt_changes_sign_at_rc():
    rows = profile(GODEL, {"a": 1.0}, r_max=2.0, n=400)["rows"]
    for row in rows:
        if abs(row["r"] - RC) > 1e-2:
            assert (row["cone_tilt"] < 0) == (row["r"] > RC)
