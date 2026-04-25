import time
from copy import deepcopy
from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from typing import Any, Optional
import os
import shutil
import zipfile

import uvicorn
from fastapi import BackgroundTasks, Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.core.hyperparameter_search import grid_search_params
from app.core.orc import AutoMLOrchestrator
from app.core.random_search_combinations import random_search_params

try:
    import torch
except ModuleNotFoundError:
    torch = None

try:
    import yaml as yaml_module
except ModuleNotFoundError:
    yaml_module = None

YAML_EXCEPTIONS = (ValueError,)
if yaml_module is not None:
    YAML_EXCEPTIONS = YAML_EXCEPTIONS + (yaml_module.YAMLError,)

DATASET_CONFIGURATION_EXCEPTIONS = (OSError, zipfile.BadZipFile) + YAML_EXCEPTIONS

app = FastAPI(
    title="AutoML YOLO API",
    description="API for the AutoML YOLO interface",
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
SUPPORTED_YAML_FILENAMES = ("data.yaml", "data.yml", "dataset.yaml", "dataset.yml")
COMMON_DATASET_LAYOUTS = (
    ("images/train", "images/val", "images/test"),
    ("images/train", "images/valid", "images/test"),
    ("train/images", "val/images", "test/images"),
    ("train/images", "valid/images", "test/images"),
    ("train", "val", "test"),
    ("train", "valid", "test"),
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def run_automl() -> None:
    time.sleep(10)
    print("AutoML task completed")


def next_dataset_id() -> str:
    return f"ds-{next(DATASET_ID_COUNTER)}"


def next_run_id() -> str:
    return f"run-{next(RUN_ID_COUNTER)}"


def parse_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value

    text = str(value).strip()
    if not text:
        return None

    return int(text)


def require_yaml_module():
    if yaml_module is None:
        raise RuntimeError(
            "PyYAML is not available in the Python interpreter used to run Uvicorn"
        )
    return yaml_module


def get_generate_yolo_yaml():
    try:
        from app.core.yaml_generator import generate_yolo_yaml as generator
    except ModuleNotFoundError as exc:
        if exc.name == "yaml":
            raise RuntimeError(
                "PyYAML is not available in the Python interpreter used to run Uvicorn"
            ) from exc
        raise
    return generator


def normalize_class_names_input(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []

    if isinstance(raw_value, (list, tuple, set)):
        values = raw_value
    else:
        values = str(raw_value).replace("\n", ",").split(",")

    return [str(value).strip() for value in values if str(value).strip()]


def normalize_yaml_names(raw_value: Any) -> list[str]:
    if isinstance(raw_value, dict):
        items = sorted(
            raw_value.items(),
            key=lambda item: int(item[0]) if str(item[0]).isdigit() else str(item[0]),
        )
        return [str(value).strip() for _, value in items if str(value).strip()]

    return normalize_class_names_input(raw_value)


def folder_exists(dataset_root: Path, folder: Optional[str]) -> bool:
    if not folder:
        return False
    return (dataset_root / folder).exists()


def read_yaml_file_content(yaml_path: Path) -> str:
    return yaml_path.read_text(encoding="utf-8")


def set_dataset_yaml_info(detail: dict[str, Any], yaml_path: Optional[Path]) -> None:
    if yaml_path is None:
        detail["yamlPath"] = None
        detail["yamlContent"] = None
        detail["yamlUpdatedAt"] = None
        return

    resolved_path = yaml_path.resolve()
    if not resolved_path.exists():
        detail["yamlPath"] = None
        detail["yamlContent"] = None
        detail["yamlUpdatedAt"] = None
        return

    detail["yamlPath"] = str(resolved_path)
    detail["yamlContent"] = read_yaml_file_content(resolved_path)
    detail["yamlUpdatedAt"] = now_iso()


def find_existing_yaml_file(dataset_root: Path) -> Optional[Path]:
    for filename in SUPPORTED_YAML_FILENAMES:
        candidate = dataset_root / filename
        if candidate.exists():
            return candidate
    return None


def detect_dataset_split_folders(dataset_root: Path) -> tuple[Optional[str], Optional[str], Optional[str]]:
    for train_folder, val_folder, test_folder in COMMON_DATASET_LAYOUTS:
        train_path = dataset_root / train_folder
        val_path = dataset_root / val_folder
        if train_path.exists() and val_path.exists():
            test_path = dataset_root / test_folder
            return (
                train_folder,
                val_folder,
                test_folder if test_path.exists() else None,
            )

    return None, None, None


def find_dataset_root(base_dir: Path) -> Path:
    current = base_dir.resolve()
    visited: set[Path] = set()

    while current not in visited:
        visited.add(current)

        train_folder, val_folder, _ = detect_dataset_split_folders(current)
        if train_folder and val_folder:
            return current

        child_dirs = [child for child in current.iterdir() if child.is_dir()]
        matching_children = [
            child
            for child in child_dirs
            if detect_dataset_split_folders(child)[0] and detect_dataset_split_folders(child)[1]
        ]

        if len(matching_children) == 1:
            current = matching_children[0]
            continue

        files = [child for child in current.iterdir() if child.is_file()]
        if len(child_dirs) == 1 and not files:
            current = child_dirs[0]
            continue

        return current

    return base_dir.resolve()


def apply_yaml_metadata_from_file(detail: dict[str, Any], yaml_path: Path) -> None:
    yaml_runtime = require_yaml_module()
    yaml_content = read_yaml_file_content(yaml_path.resolve())
    payload = yaml_runtime.safe_load(yaml_content) or {}
    if not isinstance(payload, dict):
        raise ValueError("Dataset YAML must contain a mapping object")

    class_names = normalize_yaml_names(payload.get("names"))
    class_count = parse_optional_int(payload.get("nc"))
    if class_count is None and class_names:
        class_count = len(class_names)

    if class_names:
        detail["classes"] = class_names
    if class_count is not None:
        detail["classesCount"] = class_count

    raw_root = payload.get("path")
    if raw_root:
        candidate_root = Path(str(raw_root))
        if not candidate_root.is_absolute():
            candidate_root = (yaml_path.parent / candidate_root).resolve()
        detail["datasetRoot"] = str(candidate_root)
    elif not detail.get("datasetRoot"):
        detail["datasetRoot"] = str(yaml_path.parent.resolve())

    if payload.get("train"):
        detail["trainFolder"] = str(payload["train"])
    if payload.get("val"):
        detail["valFolder"] = str(payload["val"])
    if "test" in payload:
        detail["testFolder"] = str(payload["test"]) if payload["test"] else None

    set_dataset_yaml_info(detail, yaml_path.resolve())


def sync_dataset_yaml(detail: dict[str, Any], force_generate: bool = False) -> Path:
    existing_yaml_path = detail.get("yamlPath")
    if existing_yaml_path and not force_generate:
        existing_yaml = Path(existing_yaml_path)
        if existing_yaml.exists():
            set_dataset_yaml_info(detail, existing_yaml)
            return existing_yaml.resolve()

    dataset_root_value = detail.get("datasetRoot")
    if not dataset_root_value:
        raise ValueError("Dataset root is not configured")

    dataset_root = Path(str(dataset_root_value)).resolve()
    train_detected, val_detected, test_detected = detect_dataset_split_folders(dataset_root)

    train_folder = detail.get("trainFolder")
    if not folder_exists(dataset_root, train_folder):
        train_folder = train_detected

    val_folder = detail.get("valFolder")
    if not folder_exists(dataset_root, val_folder):
        val_folder = val_detected

    test_folder = detail.get("testFolder")
    if not folder_exists(dataset_root, test_folder):
        test_folder = test_detected

    if not train_folder or not val_folder:
        raise ValueError(
            "Could not detect dataset folders. Configure trainFolder and valFolder in Settings."
        )

    class_names = normalize_class_names_input(detail.get("classes"))
    class_count = parse_optional_int(detail.get("classesCount"))
    if class_count is None and class_names:
        class_count = len(class_names)

    if class_count is None or class_count <= 0:
        raise ValueError("Specify classesCount to generate data.yaml")

    if class_names and len(class_names) != class_count:
        raise ValueError("classNames count must match classesCount")

    generate_yolo_yaml = get_generate_yolo_yaml()
    generated_yaml_path = Path(
        generate_yolo_yaml(
            dataset_path=dataset_root,
            num_classes=class_count,
            class_names=class_names or None,
            output_path=dataset_root / "data.yaml",
            train_folder=train_folder,
            val_folder=val_folder,
            test_folder=test_folder,
        )
    ).resolve()

    detail["classesCount"] = class_count
    detail["classes"] = class_names or [f"class_{index}" for index in range(class_count)]
    detail["trainFolder"] = train_folder
    detail["valFolder"] = val_folder
    detail["testFolder"] = test_folder
    set_dataset_yaml_info(detail, generated_yaml_path)

    return generated_yaml_path


def dataset_summary_from_detail(detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": detail["id"],
        "name": detail.get("name"),
        "description": detail.get("description"),
        "samples": detail.get("samples"),
        "status": detail.get("status", "ready"),
        "bestModel": detail.get("bestModel"),
        "bestMap": detail.get("bestMap"),
        "lastRunAt": detail.get("lastRunAt"),
        "yamlReady": bool(detail.get("yamlPath")),
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
    source_filename: Optional[str],
) -> dict[str, Any]:
    return {
        "id": dataset_id,
        "name": name,
        "description": description,
        "sourceFilename": source_filename,
        "sourcePath": None,
        "datasetRoot": None,
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
            "device": "auto",
            "priority": "normal",
        },
        "yamlPath": None,
        "yamlContent": None,
        "yamlUpdatedAt": None,
        "yamlError": None,
        "trainFolder": None,
        "valFolder": None,
        "testFolder": None,
        "bestModels": [],
    }


def build_empty_run_detail(
    run_id: str,
    dataset_id: str,
    dataset_name: str,
    dataset_yaml_path: str,
    target_metric: Optional[str],
    device: Optional[str],
    search_alg: Optional[str],
    notes: Optional[str],
    hyperparams: Optional[dict] = None,
) -> dict[str, Any]:
    started_at = now_iso()
    return {
        "id": run_id,
        "datasetId": dataset_id,
        "datasetName": dataset_name,
        "datasetYamlPath": dataset_yaml_path,
        "status": "running",
        "startedAt": started_at,
        "finishedAt": None,
        "targetMetric": target_metric,
        "device": device,
        "search_alg": search_alg,
        "hyperparams": hyperparams or {},
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


def runtime_gpu_available() -> bool:
    try:
        return bool(torch is not None and torch.cuda.is_available())
    except Exception:
        return False


def normalize_training_device(device: Optional[str]) -> str | int:
    requested = device or os.getenv("AUTOML_DEVICE", "auto")
    normalized = str(requested).strip().lower()

    if not normalized or normalized == "auto":
        return 0 if runtime_gpu_available() else "cpu"
    if normalized == "cpu":
        return "cpu"
    if normalized == "gpu0":
        return 0 if runtime_gpu_available() else "cpu"
    if normalized == "gpu1":
        return 1 if runtime_gpu_available() and (torch is None or torch.cuda.device_count() > 1) else "cpu"

    return requested


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
        "device": detail.get("device"),
        "search_alg": detail.get("search_alg"),
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


@app.get("/api/datasets/{dataset_id}/yaml", response_class=PlainTextResponse)
async def get_dataset_yaml(dataset_id: str):
    detail = get_dataset_or_404(dataset_id)
    yaml_path = detail.get("yamlPath")
    if not yaml_path:
        raise HTTPException(status_code=404, detail="Dataset YAML is not configured")

    yaml_file = Path(str(yaml_path))
    if not yaml_file.exists():
        raise HTTPException(status_code=404, detail="Dataset YAML file was not found")

    detail["yamlContent"] = read_yaml_file_content(yaml_file)
    return PlainTextResponse(detail["yamlContent"], media_type="text/yaml")


@app.post("/api/datasets")
async def create_dataset(
    displayName: str = Form(...),
    description: str = Form(""),
    numClasses: Optional[int] = Form(None),
    classNames: str = Form(""),
    datasetFile: UploadFile = File(...),
    yamlFile: Optional[UploadFile] = File(None),
    generateYaml: str = Form("false"),
):
    if generateYaml == "true":
        print("Generate Yaml!")
    else:
        print("Uploading Yaml")
    dataset_id = next_dataset_id()
    upload_dir = Path("uploads/datasets")
    upload_dir.mkdir(parents=True, exist_ok=True)

    original_name = datasetFile.filename or "dataset"
    file_path = upload_dir / f"{dataset_id}_{original_name}"

    parsed_class_names = normalize_class_names_input(classNames)
    resolved_num_classes = numClasses if numClasses and numClasses > 0 else None
    if parsed_class_names and resolved_num_classes is None:
        resolved_num_classes = len(parsed_class_names)

    if parsed_class_names and resolved_num_classes != len(parsed_class_names):
        raise HTTPException(
            status_code=400,
            detail="classNames count must match numClasses",
        )

    with file_path.open("wb") as buffer:
        shutil.copyfileobj(datasetFile.file, buffer)

    detail = build_empty_dataset_detail(
        dataset_id=dataset_id,
        name=displayName.strip(),
        description=description.strip(),
        source_filename=original_name,
    )
    detail["sourcePath"] = str(file_path.resolve())

    if resolved_num_classes is not None:
        detail["classesCount"] = resolved_num_classes
    if parsed_class_names:
        detail["classes"] = parsed_class_names

    suffix = file_path.suffix.lower()
    try:
        if suffix == ".zip":
            extract_dir = upload_dir / f"{dataset_id}_extracted"
            with zipfile.ZipFile(file_path, "r") as zip_ref:
                zip_ref.extractall(extract_dir)

            dataset_root = find_dataset_root(extract_dir)
            detail["datasetRoot"] = str(dataset_root)

            train_folder, val_folder, test_folder = detect_dataset_split_folders(dataset_root)
            detail["trainFolder"] = train_folder
            detail["valFolder"] = val_folder
            detail["testFolder"] = test_folder

            existing_yaml = find_existing_yaml_file(dataset_root)
            if existing_yaml:
                apply_yaml_metadata_from_file(detail, existing_yaml)
                sync_dataset_yaml(detail, force_generate=True)
            elif resolved_num_classes is not None:
                sync_dataset_yaml(detail, force_generate=True)

        elif suffix in {".yaml", ".yml"}:
            apply_yaml_metadata_from_file(detail, file_path)

        else:
            detail["datasetRoot"] = str(file_path.parent.resolve())

    except DATASET_CONFIGURATION_EXCEPTIONS as exc:
        raise HTTPException(status_code=400, detail=f"Failed to configure dataset: {exc}") from exc

    if not detail.get("datasetRoot"):
        detail["datasetRoot"] = str(file_path.parent.resolve())

    DATASET_DETAILS[dataset_id] = detail
    refresh_dataset_summary(dataset_id)

    return {
        "id": dataset_id,
        "filename": original_name,
        "savedPath": str(file_path.resolve()),
        "yamlPath": detail.get("yamlPath"),
        "yamlReady": bool(detail.get("yamlPath")),
    }


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
        "device": payload.get("device", detail["settings"].get("device", "auto")),
        "priority": payload.get("priority", detail["settings"].get("priority", "normal")),
    }
    detail["settings"] = next_settings

    yaml_fields_present = any(
        key in payload for key in ("classesCount", "classNames", "trainFolder", "valFolder", "testFolder")
    )

    if yaml_fields_present:
        previous_state = {
            key: deepcopy(detail.get(key))
            for key in (
                "classesCount",
                "classes",
                "trainFolder",
                "valFolder",
                "testFolder",
                "yamlPath",
                "yamlContent",
                "yamlUpdatedAt",
                "yamlError",
            )
        }

        if "classesCount" in payload:
            detail["classesCount"] = parse_optional_int(payload.get("classesCount")) or 0
        if "classNames" in payload:
            detail["classes"] = normalize_class_names_input(payload.get("classNames"))
        if "trainFolder" in payload:
            detail["trainFolder"] = str(payload.get("trainFolder") or "").strip() or None
        if "valFolder" in payload:
            detail["valFolder"] = str(payload.get("valFolder") or "").strip() or None
        if "testFolder" in payload:
            detail["testFolder"] = str(payload.get("testFolder") or "").strip() or None

        detail["yamlError"] = None

        try:
            sync_dataset_yaml(detail, force_generate=True)
        except DATASET_CONFIGURATION_EXCEPTIONS as exc:
            for key, value in previous_state.items():
                detail[key] = value
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    refresh_dataset_summary(dataset_id)
    return {"status": "ok", "yamlPath": detail.get("yamlPath")}


@app.post("/api/datasets/{dataset_id}/runs")
async def create_run(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    payload: dict[str, Any] = Body(...),
):
    dataset = get_dataset_or_404(dataset_id)

    try:
        dataset_yaml_path = str(sync_dataset_yaml(dataset, force_generate=True))
    except DATASET_CONFIGURATION_EXCEPTIONS as exc:
        raise HTTPException(status_code=400, detail=f"Dataset YAML is invalid: {exc}") from exc

    if not dataset_yaml_path:
        raise HTTPException(
            status_code=400,
            detail="Dataset YAML is not configured. Open Settings and configure classes/folders first.",
        )

    if not Path(str(dataset_yaml_path)).exists():
        raise HTTPException(status_code=400, detail="Dataset YAML file was not found on disk")

    run_id = next_run_id()
    detail = build_empty_run_detail(
        run_id=run_id,
        dataset_id=dataset_id,
        dataset_name=dataset.get("name", "Dataset"),
        dataset_yaml_path=str(dataset_yaml_path),
        target_metric=payload.get("targetMetric"),
        device=payload.get("device"),
        search_alg=payload.get("searchAlg"),
        notes=payload.get("notes"),
        hyperparams=payload.get("hyperparams", {}),
    )
    random_search_iterations = int(payload.get("randomSearchIterations", 10))

    RUN_DETAILS[run_id] = detail
    refresh_run_summary(run_id)
    detail["randomSearchIterations"] = random_search_iterations
    dataset["lastRunAt"] = detail["startedAt"]
    dataset["status"] = "ready"
    if payload.get("targetMetric"):
        dataset["settings"]["targetMetric"] = payload.get("targetMetric")
    if payload.get("device"):
        dataset["settings"]["device"] = payload.get("device")

    refresh_dataset_summary(dataset_id)

    RUN_LOGS[run_id] = "\n".join(
        [
            f"Run created: {run_id}",
            f"Dataset: {dataset.get('name', dataset_id)}",
            f"Dataset YAML: {dataset_yaml_path}",
            "Status: running",
        ]
    )

    background_tasks.add_task(
        run_training_task,
        run_id=run_id,
        search_alg=detail["search_alg"],
        hyperparams=detail["hyperparams"],
        random_search_iterations=random_search_iterations,
        dataset_yaml_path=str(dataset_yaml_path),
        device=detail["device"],
    )

    return {"runId": run_id, "datasetYamlPath": dataset_yaml_path}


def run_training_task(
    run_id: str,
    search_alg: Optional[str],
    hyperparams: dict,
    random_search_iterations: int,
    dataset_yaml_path: str,
    device: Optional[str] = None,
):
    try:
        append_to_run_log(run_id, "Preparing hyperparameters...")
        append_to_run_log(run_id, f"Using dataset YAML: {dataset_yaml_path}")
        training_device = normalize_training_device(device)
        normalized_params = {}
        for key in hyperparams.keys():
            if hyperparams[key]['type'] == "list":
                normalized_params[key] = hyperparams[key]['values']
            else:
                normalized_params[key] = tuple([hyperparams[key]["min"], hyperparams[key]["max"]])
        if search_alg == "GridSearch":
            hyperparams_combinations = grid_search_params(normalized_params)
        elif search_alg == "RandomSearch":
            hyperparams_combinations = random_search_params(normalized_params, random_search_iterations)
        else:
            hyperparams_combinations = [{}]

        if not hyperparams_combinations:
            hyperparams_combinations = [{}]
        for combination in hyperparams_combinations:
            combination["data"] = dataset_yaml_path
            if training_device is not None and not combination.get("device"):
                combination["device"] = training_device

        append_to_run_log(run_id, f"Generated {len(hyperparams_combinations)} combinations")
        append_to_run_log(run_id, f"Resolved training device: {training_device}")

        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["status"] = "running"
            refresh_run_summary(run_id)

        append_to_run_log(run_id, "Training started...")
        orchestrator = AutoMLOrchestrator()
        result = orchestrator.run(hyperparams_combinations)
        print("Training finished")

        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["status"] = "finished"
            RUN_DETAILS[run_id]["finishedAt"] = now_iso()

            if result:
                best_result = max(
                    (
                        item
                        for item in result
                        if item.get("status") == "completed" and item.get("metrics")
                    ),
                    key=lambda item: item.get("metrics", {}).get("metrics/mAP50-95", 0),
                    default=None,
                )
                if best_result:
                    RUN_DETAILS[run_id]["summary"]["bestModel"] = best_result.get("model_path")
                    RUN_DETAILS[run_id]["summary"]["bestMap"] = best_result.get("metrics", {}).get(
                        "metrics/mAP50-95"
                    )

            refresh_run_summary(run_id)

        append_to_run_log(run_id, "Training finished")

    except Exception as exc:
        error_message = f"Training error: {exc}"
        print(error_message)
        append_to_run_log(run_id, error_message)

        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["status"] = "failed"
            refresh_run_summary(run_id)


def append_to_run_log(run_id: str, message: str):
    current_log = RUN_LOGS.get(run_id, "")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    new_entry = f"[{timestamp}] {message}"

    if current_log:
        RUN_LOGS[run_id] = f"{current_log}\n{new_entry}"
    else:
        RUN_LOGS[run_id] = new_entry


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


@app.post("/api/start")
async def start_automl(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_automl)
    return {"message": "AutoML process started", "status": "200"}


app.mount("/", StaticFiles(directory="static", html=True), name="static")
Path("runs").mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/runs", StaticFiles(directory="runs"), name="runs")
app.mount("/", StaticFiles(directory="static", html=True), name="static-root")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
