"""CHRONOS FastAPI アプリケーション。"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .constraints import CONSTRAINTS
from .physics.experiments import EXPERIMENT_TYPES, ExperimentInputError
from .physics.models import MODELS, get_model
from .physics.visual import lightcones, profile
from .runner import ExperimentRunner

DATA_PATH = Path(os.environ.get("CHRONOS_DATA", Path(__file__).resolve().parent.parent / "data" / "experiments.json"))


class ExperimentRequest(BaseModel):
    type: Literal["circle", "geodesic", "mission"]
    model: str = "godel"
    params: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None
    preview: bool = False


def create_app(data_path: Path | None = DATA_PATH, warm: bool = True) -> FastAPI:
    app = FastAPI(title="CHRONOS API", version="0.1.0", description="閉じた時間的曲線の検証研究プラットフォーム")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    runner = ExperimentRunner(data_path)
    app.state.runner = runner

    if warm:
        # 記号計算（Einstein テンソル）は数秒かかるため起動時に裏で温めておく
        threading.Thread(target=lambda: [m.verification() for m in MODELS.values()], daemon=True).start()

    def model_or_404(model_id: str):
        try:
            return get_model(model_id)
        except KeyError:
            raise HTTPException(404, f"未知のモデル: {model_id}") from None

    def params_for(model, a: float | None):
        p = {model.params[0].key: a if a is not None else model.params[0].default}
        return p

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "CHRONOS", "models": list(MODELS)}

    @app.get("/api/models")
    def models():
        return [m.info() for m in MODELS.values()]

    @app.get("/api/models/{model_id}/verification")
    def verification(model_id: str):
        return model_or_404(model_id).verification()

    @app.get("/api/models/{model_id}/profile")
    def model_profile(model_id: str, scale: float | None = Query(None, gt=0), r_max: float = Query(3.0, gt=0.1, le=8)):
        m = model_or_404(model_id)
        return profile(m, params_for(m, scale), r_max=r_max)

    @app.get("/api/models/{model_id}/lightcones")
    def model_lightcones(model_id: str, scale: float | None = Query(None, gt=0), r_max: float = Query(2.4, gt=0.2, le=6),
                         n_r: int = Query(7, ge=2, le=14), n_phi: int = Query(8, ge=3, le=24)):
        m = model_or_404(model_id)
        return lightcones(m, params_for(m, scale), r_max=r_max, n_r=n_r, n_phi=n_phi)

    @app.get("/api/experiment-types")
    def experiment_types():
        return EXPERIMENT_TYPES

    @app.get("/api/constraints")
    def constraints():
        return CONSTRAINTS

    @app.post("/api/experiments")
    def create_experiment(req: ExperimentRequest):
        try:
            if req.preview:
                return {"preview": True, "status": "completed", "result": runner.run_sync(req.type, req.model, req.params)}
            return runner.submit(req.type, req.model, req.params, req.label)
        except ExperimentInputError as exc:
            raise HTTPException(422, str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get("/api/experiments")
    def list_experiments():
        return runner.list()

    def job_or_404(jid: str) -> dict:
        try:
            return runner.get(jid)
        except KeyError:
            raise HTTPException(404, f"実験が見つかりません: {jid}") from None

    @app.get("/api/experiments/{jid}")
    def get_experiment(jid: str):
        return job_or_404(jid)

    @app.post("/api/experiments/{jid}/stop")
    def stop_experiment(jid: str):
        job_or_404(jid)
        return runner.stop(jid)

    @app.delete("/api/experiments/{jid}")
    def delete_experiment(jid: str):
        job_or_404(jid)
        runner.delete(jid)
        return {"deleted": jid}

    @app.get("/api/experiments/{jid}/download")
    def download(jid: str):
        job = job_or_404(jid)
        body = json.dumps(job, ensure_ascii=False, indent=2)
        return Response(body, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{job["name"]}.json"'})

    return app


app = create_app()
