import time

import pytest
from fastapi.testclient import TestClient

from chronos.api import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(tmp_path / "exp.json", warm=False)
    with TestClient(app) as c:
        yield c


def wait(client, jid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        job = client.get(f"/api/experiments/{jid}").json()
        if job["status"] in ("completed", "stopped", "failed"):
            return job
        time.sleep(0.05)
    raise TimeoutError


def test_health_and_models(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ids = [m["id"] for m in client.get("/api/models").json()]
    assert ids == ["godel", "minkowski"]
    assert len(client.get("/api/constraints").json()) >= 5


def test_profile_and_lightcones(client):
    p = client.get("/api/models/godel/profile", params={"scale": 1}).json()
    assert p["critical_radius"] == pytest.approx(0.881373587, abs=1e-8)
    lc = client.get("/api/models/godel/lightcones").json()
    assert any(c["tipped"] for c in lc["cones"])
    assert client.get("/api/models/nope/profile").status_code == 404


def test_experiment_lifecycle_and_download(client):
    r = client.post("/api/experiments", json={"type": "circle", "model": "godel", "params": {"a": 1, "R": 1.2}})
    assert r.status_code == 200
    job = wait(client, r.json()["id"])
    assert job["status"] == "completed"
    assert job["result"]["verdict"]["math"] == "成立"
    listed = client.get("/api/experiments").json()
    assert listed[0]["id"] == job["id"] and listed[0]["verdict"]["math"] == "成立"
    d = client.get(f"/api/experiments/{job['id']}/download")
    assert d.headers["content-type"].startswith("application/json")
    assert "attachment" in d.headers["content-disposition"]
    assert d.json()["result"]["type"] == "circle"
    assert client.delete(f"/api/experiments/{job['id']}").status_code == 200
    assert client.get(f"/api/experiments/{job['id']}").status_code == 404


def test_stop_long_geodesic(client):
    r = client.post("/api/experiments", json={"type": "geodesic", "model": "godel",
                                              "params": {"a": 1, "r0": 0.5, "kind": "timelike", "speed": 0.4,
                                                         "lock_L0": False, "psi_deg": 60, "lambda_max": 200}})
    jid = r.json()["id"]
    time.sleep(0.3)
    client.post(f"/api/experiments/{jid}/stop")
    job = wait(client, jid)
    assert job["status"] in ("stopped", "completed")


def test_preview_and_input_error(client):
    r = client.post("/api/experiments", json={"type": "mission", "model": "godel", "preview": True,
                                              "params": {"a": 1, "R": 1.2}})
    assert r.json()["result"]["verdict"]["math"] == "成立"
    assert client.get("/api/experiments").json() == []  # preview は履歴に保存しない
    bad = client.post("/api/experiments", json={"type": "circle", "model": "godel", "preview": True, "params": {"R": -1}})
    assert bad.status_code == 422


def test_history_persists(tmp_path):
    path = tmp_path / "exp.json"
    with TestClient(create_app(path, warm=False)) as c:
        jid = c.post("/api/experiments", json={"type": "circle", "params": {"R": 2}}).json()["id"]
        wait(c, jid)
    with TestClient(create_app(path, warm=False)) as c:
        assert c.get(f"/api/experiments/{jid}").json()["status"] == "completed"
