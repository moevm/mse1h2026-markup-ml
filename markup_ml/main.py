from copy import deepcopy
from datetime import datetime, timezone
from itertools import count
from typing import Any, Optional

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

app = FastAPI(
    title="AutoML YOLO API",
    description="API для интерфейса AutoML YOLO",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATASETS: list[dict[str, Any]] = []
DATASET_DETAILS: dict[str, dict[str, Any]] = {}
RUNS: list[dict[str, Any]] = []
RUN_DETAILS: dict[str, dict[str, Any]] = {}
RUN_LOGS: dict[str, str] = {}

DATASET_ID_COUNTER = count(1)
RUN_ID_COUNTER = count(1)

AVAILABLE_METRICS = ["mAP@50", "mAP@50-95", "F1", "Recall"]
AVAILABLE_DEVICES = ["auto", "gpu0", "gpu1", "cpu"]
AVAILABLE_PRIORITIES = ["normal", "high", "low"]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def next_dataset_id() -> str:
    return f"ds-{next(DATASET_ID_COUNTER)}"


def next_run_id() -> str:
    return f"run-{next(RUN_ID_COUNTER)}"


def dataset_summary_from_detail(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": detail["id"],
        "name": detail.get("name"),
        "description": detail.get("description"),
        "taskType": detail.get("taskType"),
        "samples": detail.get("samples"),
        "status": detail.get("status", "ready"),
        "bestModel": detail.get("bestModel"),
        "bestMap": detail.get("bestMap"),
        "lastRunAt": detail.get("lastRunAt"),
    }


def refresh_dataset_summary(dataset_id: str) -> None:
    detail = DATASET_DETAILS.get(dataset_id)
    if not detail:
        return

    summary = dataset_summary_from_detail(detail)

    for index, item in enumerate(DATASETS):
        if item["id"] == dataset_id:
            DATASETS[index] = summary
            return

    DATASETS.append(summary)


def get_dataset_or_404(dataset_id: str) -> dict[str, Any]:
    detail = DATASET_DETAILS.get(dataset_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return detail


def get_run_or_404(run_id: str) -> dict[str, Any]:
    detail = RUN_DETAILS.get(run_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Run not found")
    return detail


def build_empty_dataset_detail(
    dataset_id: str,
    name: str,
    description: str,
    task_type: str,
    source_filename: Optional[str],
) -> dict[str, Any]:
    return {
        "id": dataset_id,
        "name": name,
        "description": description,
        "taskType": task_type,
        "sourceFilename": source_filename,
        "samples": 0,
        "classesCount": 0,
        "classes": [],
        "status": "ready",
        "bestModel": None,
        "bestMap": None,
        "lastRunAt": None,
        "availableMetrics": deepcopy(AVAILABLE_METRICS),
        "availableDevices": deepcopy(AVAILABLE_DEVICES),
        "availablePriorities": deepcopy(AVAILABLE_PRIORITIES),
        "settings": {
            "targetMetric": "",
            "budget": None,
            "device": "auto",
            "priority": "normal",
        },
        "bestModels": [],
    }


def build_empty_run_detail(
    run_id: str,
    dataset_id: str,
    dataset_name: str,
    target_metric: Optional[str],
    budget: Optional[int],
    device: Optional[str],
    notes: Optional[str],
) -> dict[str, Any]:
    started_at = now_iso()
    return {
        "id": run_id,
        "datasetId": dataset_id,
        "datasetName": dataset_name,
        "status": "running",
        "startedAt": started_at,
        "finishedAt": None,
        "targetMetric": target_metric,
        "budget": budget,
        "device": device,
        "notes": notes,
        "summary": {
            "bestModel": None,
            "bestMap": None,
            "bestPrecision": None,
            "bestRecall": None,
        },
        "models": [],
        "edgeCharts": [],
    }


def run_summary_from_detail(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": detail["id"],
        "datasetId": detail["datasetId"],
        "datasetName": detail.get("datasetName"),
        "status": detail.get("status", "running"),
        "startedAt": detail.get("startedAt"),
        "finishedAt": detail.get("finishedAt"),
        "bestModel": detail.get("summary", {}).get("bestModel"),
        "bestMap": detail.get("summary", {}).get("bestMap"),
        "budget": detail.get("budget"),
        "device": detail.get("device"),
    }


def refresh_run_summary(run_id: str) -> None:
    detail = RUN_DETAILS.get(run_id)
    if not detail:
        return

    summary = run_summary_from_detail(detail)

    for index, item in enumerate(RUNS):
        if item["id"] == run_id:
            RUNS[index] = summary
            return

    RUNS.insert(0, summary)


def to_simple_yaml(value: Any, indent: int = 0) -> str:
    pad = "  " * indent

    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{pad}{key}:")
                lines.append(to_simple_yaml(item, indent + 1))
            else:
                lines.append(f"{pad}{key}: {format_yaml_scalar(item)}")
        return "\n".join(lines)

    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{pad}-")
                lines.append(to_simple_yaml(item, indent + 1))
            else:
                lines.append(f"{pad}- {format_yaml_scalar(item)}")
        return "\n".join(lines)

    return f"{pad}{format_yaml_scalar(value)}"


def format_yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace('"', '\\"')
    return f'"{text}"'


@app.get("/ping")
async def ping():
    return {"status": "ok"}


@app.get("/api/dashboard")
async def get_dashboard():
    running_count = len([run for run in RUNS if str(run.get("status", "")).lower() == "running"])
    queued_count = len([run for run in RUNS if str(run.get("status", "")).lower() == "queued"])

    return {
        "summary": {
            "datasetsCount": len(DATASETS),
            "runsCount": len(RUNS),
            "runningCount": running_count,
            "queuedCount": queued_count,
        },
        "topDatasets": DATASETS[:6],
    }


@app.get("/api/datasets")
async def get_datasets():
    return DATASETS


@app.get("/api/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    return get_dataset_or_404(dataset_id)


@app.post("/api/datasets")
async def create_dataset(
    displayName: str = Form(...),
    taskType: str = Form(...),
    description: str = Form(""),
    datasetFile: UploadFile = File(...),
):
    dataset_id = next_dataset_id()

    detail = build_empty_dataset_detail(
        dataset_id=dataset_id,
        name=displayName.strip(),
        description=description.strip(),
        task_type=taskType.strip(),
        source_filename=datasetFile.filename,
    )

    DATASET_DETAILS[dataset_id] = detail
    refresh_dataset_summary(dataset_id)

    return {"id": dataset_id, "filename": datasetFile.filename}


@app.put("/api/datasets/{dataset_id}/settings")
async def update_dataset_settings(
    dataset_id: str,
    payload: dict[str, Any] = Body(...),
):
    detail = get_dataset_or_404(dataset_id)

    detail["name"] = payload.get("name", detail.get("name"))
    detail["description"] = payload.get("description", detail.get("description"))

    next_settings = {
        "targetMetric": payload.get("targetMetric", detail["settings"].get("targetMetric", "")),
        "budget": payload.get("budget", detail["settings"].get("budget")),
        "device": payload.get("device", detail["settings"].get("device", "auto")),
        "priority": payload.get("priority", detail["settings"].get("priority", "normal")),
    }

    detail["settings"] = next_settings
    refresh_dataset_summary(dataset_id)

    return {"status": "ok"}


@app.post("/api/datasets/{dataset_id}/runs")
async def create_run(
    dataset_id: str,
    payload: dict[str, Any] = Body(...),
):
    dataset = get_dataset_or_404(dataset_id)

    run_id = next_run_id()
    detail = build_empty_run_detail(
        run_id=run_id,
        dataset_id=dataset_id,
        dataset_name=dataset.get("name", "Dataset"),
        target_metric=payload.get("targetMetric"),
        budget=payload.get("budget"),
        device=payload.get("device"),
        notes=payload.get("notes"),
    )

    RUN_DETAILS[run_id] = detail
    refresh_run_summary(run_id)

    dataset["lastRunAt"] = detail["startedAt"]
    dataset["status"] = "ready"
    if payload.get("targetMetric"):
        dataset["settings"]["targetMetric"] = payload.get("targetMetric")
    if payload.get("budget") is not None:
        dataset["settings"]["budget"] = payload.get("budget")
    if payload.get("device"):
        dataset["settings"]["device"] = payload.get("device")

    refresh_dataset_summary(dataset_id)

    RUN_LOGS[run_id] = "\n".join(
        [
            f"Run created: {run_id}",
            f"Dataset: {dataset.get('name', dataset_id)}",
            f"Metric: {payload.get('targetMetric') or '-'}",
            f"Device: {payload.get('device') or '-'}",
            f"Budget: {payload.get('budget') if payload.get('budget') is not None else '-'}",
            "Status: running",
        ]
    )

    return {"runId": run_id}


@app.get("/api/runs")
async def get_runs():
    return RUNS


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    return get_run_or_404(run_id)


@app.get("/api/runs/{run_id}/logs", response_class=PlainTextResponse)
async def get_run_logs(run_id: str):
    get_run_or_404(run_id)
    return RUN_LOGS.get(run_id, "")


@app.get("/api/exports/runs/{run_id}")
async def export_run(run_id: str, format: Optional[str] = "json"):
    detail = get_run_or_404(run_id)

    if format == "yaml":
        return PlainTextResponse(to_simple_yaml(detail), media_type="text/yaml")

    return JSONResponse(detail)


app.mount("/runs", StaticFiles(directory="runs"), name="runs")
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)