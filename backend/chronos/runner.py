"""実験ジョブ管理: 非同期実行・停止・履歴の JSON 永続化。"""
from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .physics.experiments import RUNNERS, Context, ExperimentInputError, StopRequested
from .physics.models import get_model

QUEUED, RUNNING, COMPLETED, STOPPED, FAILED = "queued", "running", "completed", "stopped", "failed"


class ExperimentRunner:
    def __init__(self, data_path: Path | None, max_workers: int = 2):
        self.data_path = data_path
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._lock = threading.RLock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._stops: dict[str, threading.Event] = {}
        self._seq = 0
        self._load()

    # ---- persistence ----------------------------------------------------
    def _load(self) -> None:
        if not self.data_path or not self.data_path.exists():
            return
        try:
            jobs = json.loads(self.data_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        for j in jobs:
            if j.get("status") in (QUEUED, RUNNING):
                j["status"] = FAILED
                j["error"] = "サーバー再起動により中断"
            self._jobs[j["id"]] = j
            self._seq = max(self._seq, int(j.get("seq", 0)))

    def _save(self) -> None:
        if not self.data_path:
            return
        with self._lock:
            data = sorted(self._jobs.values(), key=lambda j: j["seq"])
            self.data_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.data_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.data_path)

    # ---- api ------------------------------------------------------------
    @staticmethod
    def validate(exp_type: str, model_id: str) -> None:
        if exp_type not in RUNNERS:
            raise ExperimentInputError(f"未知の実験タイプ: {exp_type}")
        get_model(model_id)

    @staticmethod
    def run_sync(exp_type: str, model_id: str, params: dict) -> dict:
        ExperimentRunner.validate(exp_type, model_id)
        return RUNNERS[exp_type](get_model(model_id), params, Context())

    def submit(self, exp_type: str, model_id: str, params: dict, label: str | None = None) -> dict:
        self.validate(exp_type, model_id)
        with self._lock:
            self._seq += 1
            jid = uuid.uuid4().hex[:10]
            job = {
                "id": jid,
                "seq": self._seq,
                "name": f"CHRONOS-001-{self._seq:03d}",
                "label": label,
                "type": exp_type,
                "model": model_id,
                "params": params,
                "status": QUEUED,
                "progress": 0.0,
                "message": "待機中",
                "created_at": time.time(),
                "started_at": None,
                "finished_at": None,
                "result": None,
                "error": None,
            }
            self._jobs[jid] = job
            self._stops[jid] = threading.Event()
        self._pool.submit(self._run, jid)
        return self.summary(job)

    def _run(self, jid: str) -> None:
        job = self._jobs[jid]
        stop = self._stops[jid]
        if stop.is_set():
            self._finish(job, STOPPED, message="開始前に停止")
            return
        job.update(status=RUNNING, started_at=time.time(), message="計算中")

        def progress(frac: float, msg: str) -> None:
            job["progress"] = frac
            if msg:
                job["message"] = msg

        try:
            result = RUNNERS[job["type"]](get_model(job["model"]), job["params"], Context(progress, stop))
            if result.get("stopped") or stop.is_set():
                result.setdefault("warnings", []).append("ユーザーの停止要求により途中までの結果です。")
                self._finish(job, STOPPED, result=result, message="停止（部分結果）")
            else:
                self._finish(job, COMPLETED, result=result, message="完了")
        except StopRequested:
            self._finish(job, STOPPED, message="停止")
        except ExperimentInputError as exc:
            self._finish(job, FAILED, error=str(exc), message="入力エラー")
        except Exception as exc:  # noqa: BLE001 - 研究ツールとして失敗内容を記録する
            self._finish(job, FAILED, error=f"{type(exc).__name__}: {exc}", message="計算エラー",
                         trace=traceback.format_exc(limit=5))

    def _finish(self, job: dict, status: str, result: dict | None = None, error: str | None = None,
                message: str = "", trace: str | None = None) -> None:
        job.update(status=status, result=result, error=error, message=message, finished_at=time.time(),
                   progress=1.0 if status == COMPLETED else job.get("progress", 0.0))
        if trace:
            job["trace"] = trace
        self._save()

    def stop(self, jid: str) -> dict:
        job = self.get(jid)
        self._stops.get(jid, threading.Event()).set()
        if job["status"] == QUEUED:
            self._finish(job, STOPPED, message="停止")
        return self.summary(job)

    def get(self, jid: str) -> dict:
        if jid not in self._jobs:
            raise KeyError(jid)
        return self._jobs[jid]

    def delete(self, jid: str) -> None:
        job = self.get(jid)
        if job["status"] in (QUEUED, RUNNING):
            self._stops[jid].set()
        with self._lock:
            self._jobs.pop(jid, None)
        self._save()

    def list(self) -> list[dict]:
        return [self.summary(j) for j in sorted(self._jobs.values(), key=lambda j: -j["seq"])]

    @staticmethod
    def summary(job: dict) -> dict:
        res = job.get("result") or {}
        return {
            k: job.get(k)
            for k in ("id", "seq", "name", "label", "type", "model", "params", "status", "progress", "message",
                      "created_at", "started_at", "finished_at", "error")
        } | {
            "title": res.get("title"),
            "verdict": res.get("verdict"),
            "is_ctc": res.get("is_ctc"),
            "metrics": res.get("metrics"),
        }
