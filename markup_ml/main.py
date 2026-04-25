from copy import deepcopy
from datetime import datetime, timezone
from itertools import count
from pathlib import Path
from typing import Any, Optional
import os
import shutil
import zipfile

import uvicorn
from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.core.file_manager import StatusManager
from app.core.image_validator import validate_images
from app.core.label_validator import validate_label_file
from app.core.orc import AutoMLOrchestrator
from app.core.tpe_optimizer import TPEOptimizer
from app.core.training_results import read_training_history

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

BASE_DIR = Path(__file__).resolve().parent


def resolve_project_path(path_value: str | Path) -> Path:
    candidate = Path(path_value)
    if candidate.is_absolute():
        return candidate
    return (BASE_DIR / candidate).resolve()


STATIC_DIR = resolve_project_path("static")
RUNS_DIR = resolve_project_path(os.getenv("RUNS_DIR", "runs"))
UPLOADS_DIR = resolve_project_path(os.getenv("UPLOADS_DIR", "uploads"))
DATASETS_DIR = resolve_project_path(os.getenv("DATASETS_DIR", "datasets"))
STATUS_MANAGER = StatusManager(os.getenv("STATUS_FILE", str(RUNS_DIR / "status.json")))


def parse_allowed_origins() -> list[str]:
    raw_value = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def allowed_dataset_roots() -> list[Path]:
    raw_value = os.getenv("DATASETS_ROOTS", "").strip()
    roots = [DATASETS_DIR]
    if raw_value:
        roots.extend(resolve_project_path(item.strip()) for item in raw_value.split(",") if item.strip())
    return [root.resolve() for root in roots]

app = FastAPI(
    title="AutoML YOLO API",
    description="API for the AutoML YOLO interface",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
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
AVAILABLE_SEARCH_ALGORITHMS = ["OptunaTPE"]
DEFAULT_SEARCH_ALGORITHM = AVAILABLE_SEARCH_ALGORITHMS[0]
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


def parse_trial_count(value: Any, default: int = 10) -> int:
    if value is None or str(value).strip() == "":
        return default

    parsed = int(str(value).strip())
    return max(1, parsed)


def safe_update_global_status(**updates: Any) -> dict[str, Any]:
    try:
        return STATUS_MANAGER.update_status(updatedAt=now_iso(), **updates)
    except OSError as exc:
        print(f"Failed to persist global status: {exc}")
        merged = STATUS_MANAGER.read_status()
        merged.update(updates)
        merged["updatedAt"] = now_iso()
        return merged


def metric_value(metrics: Optional[dict[str, Any]], *keys: str) -> Optional[float]:
    if not metrics:
        return None

    for key in keys:
        raw_value = metrics.get(key)
        if raw_value is None:
            continue

        try:
            return float(raw_value)
        except (TypeError, ValueError):
            continue

    return None


def path_within_root(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def resolve_dataset_input_path(raw_value: str) -> Path:
    candidate = Path(str(raw_value).strip())
    if not candidate.is_absolute():
        candidate = (DATASETS_DIR / candidate).resolve()
    else:
        candidate = candidate.resolve()

    for root in allowed_dataset_roots():
        if path_within_root(candidate, root):
            return candidate

    allowed_roots_text = ", ".join(str(root) for root in allowed_dataset_roots())
    raise ValueError(f"Dataset path must be located inside one of: {allowed_roots_text}")


def dataset_source_id(source_path: Path) -> str:
    resolved_source = source_path.resolve()

    try:
        relative_to_default_root = resolved_source.relative_to(DATASETS_DIR.resolve())
        relative_id = relative_to_default_root.as_posix()
        return relative_id if relative_id else "."
    except ValueError:
        return str(resolved_source)


def is_supported_dataset_source(source_path: Path) -> bool:
    if source_path.is_dir():
        has_yaml = find_existing_yaml_file(source_path) is not None
        train_folder, val_folder, _ = detect_dataset_split_folders(source_path)
        return has_yaml or bool(train_folder and val_folder)

    return source_path.is_file() and source_path.suffix.lower() in {".zip", ".yaml", ".yml"}


def describe_dataset_source(source_path: Path) -> dict[str, Any]:
    source_path = source_path.resolve()
    source_type = "directory" if source_path.is_dir() else source_path.suffix.lower().lstrip(".")
    train_folder = val_folder = None

    if source_path.is_dir():
        train_folder, val_folder, _ = detect_dataset_split_folders(source_path)

    return {
        "id": dataset_source_id(source_path),
        "name": source_path.name or source_path.as_posix(),
        "relativePath": dataset_source_id(source_path),
        "sourceType": source_type,
        "yamlReady": find_existing_yaml_file(source_path) is not None if source_path.is_dir() else source_path.suffix.lower() in {".yaml", ".yml"},
        "trainFolder": train_folder,
        "valFolder": val_folder,
    }


def discover_dataset_sources() -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    seen_paths: set[Path] = set()

    for root in allowed_dataset_roots():
        root = root.resolve()
        if not root.exists() or not root.is_dir():
            continue

        candidates = [root]
        candidates.extend(sorted((child for child in root.iterdir()), key=lambda item: item.name.lower()))

        for candidate in candidates:
            candidate = candidate.resolve()
            if candidate in seen_paths or not is_supported_dataset_source(candidate):
                continue

            seen_paths.add(candidate)
            sources.append(describe_dataset_source(candidate))

    return sources


def resolve_dataset_source_path(raw_value: str) -> Path:
    value = str(raw_value or "").strip()
    if not value:
        raise ValueError("Dataset source is required")

    return resolve_dataset_input_path(value)


def infer_label_folder(dataset_root: Path, split_folder: Optional[str]) -> Optional[Path]:
    if not split_folder:
        return None

    normalized = Path(split_folder)
    candidates = []

    split_as_text = str(normalized).replace("\\", "/")
    if "images" in split_as_text:
        candidates.append(dataset_root / Path(split_as_text.replace("images", "labels", 1)))

    candidates.append(dataset_root / normalized.parent / "labels")
    candidates.append(dataset_root / "labels" / normalized.name)
    candidates.append(dataset_root / "labels" / normalized)

    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate.resolve()

    return None


def count_images_in_directory(directory: Path) -> int:
    image_suffixes = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    return sum(
        1
        for file_path in directory.rglob("*")
        if file_path.is_file() and file_path.suffix.lower() in image_suffixes
    )


def validate_dataset_assets(detail: dict[str, Any], dataset_root: Path) -> None:
    split_folders = [
        detail.get("trainFolder"),
        detail.get("valFolder"),
        detail.get("testFolder"),
    ]
    sample_count = 0

    for split_folder in split_folders:
        if not split_folder:
            continue

        images_dir = (dataset_root / split_folder).resolve()
        if not images_dir.exists() or not images_dir.is_dir():
            raise ValueError(f"Dataset split folder was not found: {images_dir}")

        bad_images = validate_images(str(images_dir))
        if bad_images:
            raise ValueError(f"Dataset contains unreadable images, first file: {bad_images[0]}")

        label_dir = infer_label_folder(dataset_root, split_folder)
        if label_dir is None and split_folder in {detail.get("trainFolder"), detail.get("valFolder")}:
            raise ValueError(f"Label folder was not found for split '{split_folder}'")
        if label_dir is not None:
            validate_label_file(str(label_dir))

        sample_count += count_images_in_directory(images_dir)

    detail["samples"] = sample_count


def runs_path_to_url(file_path: Path) -> str:
    relative_path = file_path.resolve().relative_to(RUNS_DIR.resolve()).as_posix()
    return f"/runs/{relative_path}"


def build_run_artifacts(train_dir: Optional[Path]) -> dict[str, Optional[str]]:
    if train_dir is None or not train_dir.exists():
        return {
            "bestModelUrl": None,
            "lastModelUrl": None,
            "resultsPlotUrl": None,
        }

    best_model_path = train_dir / "weights" / "best.pt"
    last_model_path = train_dir / "weights" / "last.pt"
    results_plot_path = train_dir / "results.png"

    return {
        "bestModelUrl": runs_path_to_url(best_model_path) if best_model_path.exists() else None,
        "lastModelUrl": runs_path_to_url(last_model_path) if last_model_path.exists() else None,
        "resultsPlotUrl": runs_path_to_url(results_plot_path) if results_plot_path.exists() else None,
    }


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


def configure_dataset_from_source(
    detail: dict[str, Any],
    source_path: Path,
    resolved_num_classes: Optional[int],
    extraction_dir: Optional[Path] = None,
) -> None:
    source_path = source_path.resolve()

    if source_path.is_dir():
        dataset_root = find_dataset_root(source_path)
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
        return

    suffix = source_path.suffix.lower()
    if suffix == ".zip":
        if extraction_dir is None:
            raise ValueError("Extraction directory is required for ZIP datasets")

        if extraction_dir.exists():
            shutil.rmtree(extraction_dir)
        extraction_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(source_path, "r") as zip_ref:
            zip_ref.extractall(extraction_dir)

        configure_dataset_from_source(
            detail=detail,
            source_path=extraction_dir,
            resolved_num_classes=resolved_num_classes,
        )
        return

    if suffix in {".yaml", ".yml"}:
        apply_yaml_metadata_from_file(detail, source_path)
        return

    raise ValueError("Supported dataset sources: directory, .zip archive, .yaml or .yml file")


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
        "availableSearchAlgorithms": deepcopy(AVAILABLE_SEARCH_ALGORITHMS),
        "settings": {
            "targetMetric": "",
            "device": "auto",
            "priority": "normal",
            "searchAlgorithm": DEFAULT_SEARCH_ALGORITHM,
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
        "status": "queued",
        "startedAt": started_at,
        "finishedAt": None,
        "targetMetric": target_metric,
        "device": device,
        "searchAlgorithm": normalize_search_algorithm(search_alg),
        "hyperparams": hyperparams or {},
        "bestParams": {},
        "trialCount": None,
        "notes": notes,
        "errorMessage": None,
        "artifacts": {
            "bestModelUrl": None,
            "lastModelUrl": None,
            "resultsPlotUrl": None,
        },
        "runRoot": str((RUNS_DIR / "detect" / run_id).resolve()),
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


def normalize_search_algorithm(search_alg: Optional[str]) -> str:
    value = str(search_alg or "").strip()
    if value in AVAILABLE_SEARCH_ALGORITHMS:
        return value
    return DEFAULT_SEARCH_ALGORITHM


HYPERPARAMETER_NAME_ALIASES = {
    "learningRate": "lr0",
    "learning_rate": "lr0",
    "lr": "lr0",
    "lr0": "lr0",
    "batchSize": "batch",
    "batch_size": "batch",
    "imageSize": "imgsz",
    "image_size": "imgsz",
    "imgSize": "imgsz",
    "img_size": "imgsz",
}

INTEGER_HYPERPARAMETERS = {"epochs", "batch", "imgsz", "patience", "workers"}


def normalize_hyperparameter_name(raw_name: Any) -> str:
    name = str(raw_name or "").strip()
    return HYPERPARAMETER_NAME_ALIASES.get(name, name)


def normalize_hyperparameter_value(parameter_name: str, raw_value: Any) -> Any:
    if raw_value is None:
        return raw_value

    if parameter_name in INTEGER_HYPERPARAMETERS:
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return raw_value

    if isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return text
        try:
            numeric_value = float(text)
        except ValueError:
            return text

        if numeric_value.is_integer():
            return int(numeric_value)
        return numeric_value

    return raw_value


def normalize_hyperparams_payload(hyperparams: Optional[dict[str, Any]]) -> dict[str, Any]:
    normalized_params: dict[str, Any] = {}

    if not isinstance(hyperparams, dict):
        return normalized_params

    for raw_key, raw_spec in hyperparams.items():
        key = normalize_hyperparameter_name(raw_key)
        if not key:
            continue

        if isinstance(raw_spec, dict):
            spec_type = str(raw_spec.get("type", "list")).strip().lower()

            if spec_type == "range":
                if "min" not in raw_spec or "max" not in raw_spec:
                    raise ValueError(f"Range hyperparameter '{raw_key}' must contain min and max")

                normalized_params[key] = (
                    normalize_hyperparameter_value(key, raw_spec.get("min")),
                    normalize_hyperparameter_value(key, raw_spec.get("max")),
                )
                continue

            values = raw_spec.get("values", [])
            if not isinstance(values, list):
                values = [values]

            normalized_values = [
                normalize_hyperparameter_value(key, item)
                for item in values
                if str(item).strip() != ""
            ]
            if normalized_values:
                normalized_params[key] = normalized_values
            continue

        if isinstance(raw_spec, list):
            normalized_values = [
                normalize_hyperparameter_value(key, item)
                for item in raw_spec
                if str(item).strip() != ""
            ]
            if normalized_values:
                normalized_params[key] = normalized_values
            continue

        if str(raw_spec).strip() != "":
            normalized_params[key] = [normalize_hyperparameter_value(key, raw_spec)]

    return normalized_params



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
        "searchAlgorithm": detail.get("searchAlgorithm"),
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


def model_score(model: dict[str, Any]) -> float:
    return metric_value(model, "map", "mAP") or -1.0


def build_model_entry(result: dict[str, Any]) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    if result.get("status") != "completed":
        return None, None

    train_dir_value = result.get("train_dir")
    train_dir = Path(str(train_dir_value)).resolve() if train_dir_value else None
    metrics = result.get("metrics") or {}
    model_path = Path(str(result["model_path"])).resolve() if result.get("model_path") else None
    history = None

    if train_dir and train_dir.exists():
        try:
            history = read_training_history(train_dir)
        except (OSError, ValueError, KeyError):
            history = None

    model_entry = {
        "name": train_dir.name if train_dir else f"trial_{result.get('trial', 0):03d}",
        "map": metric_value(metrics, "metrics/mAP50-95(B)", "metrics/mAP50-95"),
        "precision": metric_value(metrics, "metrics/precision(B)", "metrics/precision"),
        "recall": metric_value(metrics, "metrics/recall(B)", "metrics/recall"),
        "fps": metric_value(metrics, "speed/inference", "inference_time"),
        "sizeMb": round(model_path.stat().st_size / (1024 * 1024), 2)
        if model_path and model_path.exists()
        else None,
        "trainedParams": {
            "epochs": result.get("config", {}).get("epochs"),
            "batchSize": result.get("config", {}).get("batch"),
            "imageSize": result.get("config", {}).get("imgsz"),
            "learningRate": result.get("config", {}).get("lr0"),
            "optimizer": result.get("config", {}).get("optimizer"),
            "device": result.get("config", {}).get("device"),
        },
        "artifacts": build_run_artifacts(train_dir),
    }

    edge_chart = None
    if history and any(history.values()):
        edge_chart = {
            "model": model_entry["name"],
            "history": history,
        }

    return model_entry, edge_chart


def refresh_dataset_best_models(dataset_id: str) -> None:
    dataset = DATASET_DETAILS.get(dataset_id)
    if not dataset:
        return

    models: list[dict[str, Any]] = []
    for detail in RUN_DETAILS.values():
        if detail.get("datasetId") != dataset_id:
            continue
        models.extend(deepcopy(detail.get("models") or []))

    models.sort(key=model_score, reverse=True)
    dataset["bestModels"] = models[:5]
    dataset["bestModel"] = models[0]["name"] if models else None
    dataset["bestMap"] = metric_value(models[0], "map", "mAP") if models else None
    refresh_dataset_summary(dataset_id)


def hydrate_run_detail_from_results(run_id: str, results: list[dict[str, Any]]) -> None:
    detail = RUN_DETAILS.get(run_id)
    if not detail:
        return

    models: list[dict[str, Any]] = []
    edge_charts: list[dict[str, Any]] = []
    errors = [str(item.get("error")).strip() for item in results if item.get("status") == "failed"]
    errors = [item for item in errors if item]

    for result in results:
        model_entry, edge_chart = build_model_entry(result)
        if model_entry:
            models.append(model_entry)
        if edge_chart:
            edge_charts.append(edge_chart)

    models.sort(key=model_score, reverse=True)
    edge_charts.sort(
        key=lambda item: model_score(next((model for model in models if model["name"] == item["model"]), {})),
        reverse=True,
    )

    detail["models"] = models
    detail["edgeCharts"] = edge_charts
    detail["errorMessage"] = "; ".join(errors[:3]) if errors else None

    if models:
        best_model = models[0]
        detail["summary"]["bestModel"] = best_model["name"]
        detail["summary"]["bestMap"] = metric_value(best_model, "map", "mAP")
        detail["summary"]["bestPrecision"] = best_model.get("precision")
        detail["summary"]["bestRecall"] = best_model.get("recall")
        detail["artifacts"] = deepcopy(best_model.get("artifacts") or {})
    else:
        detail["artifacts"] = build_run_artifacts(None)

    refresh_run_summary(run_id)
    refresh_dataset_best_models(detail["datasetId"])


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


@app.get("/api/status")
async def get_status():
    payload = STATUS_MANAGER.read_status()
    current_model = payload.get("current_model", 0)
    total_models = payload.get("total_models", 0)

    return {
        **payload,
        "modelNumber": current_model,
        "totalCount": total_models,
    }


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


@app.get("/api/dataset-sources")
async def get_dataset_sources():
    return discover_dataset_sources()


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
async def create_dataset(request: Request):
    form = await request.form()
    display_name = str(form.get("displayName") or "").strip()
    description = str(form.get("description") or "").strip()
    class_names_value = str(form.get("classNames") or "")
    dataset_source_value = str(form.get("datasetSource") or "").strip()

    if not display_name:
        raise HTTPException(status_code=400, detail="displayName is required")

    raw_num_classes = str(form.get("numClasses") or "").strip()
    if raw_num_classes:
        try:
            num_classes = int(raw_num_classes)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="numClasses must be an integer") from exc
    else:
        num_classes = None

    raw_dataset_file = form.get("datasetFile")
    dataset_file = raw_dataset_file if hasattr(raw_dataset_file, "filename") and hasattr(raw_dataset_file, "file") else None
    if dataset_file and not (dataset_file.filename or "").strip():
        dataset_file = None

    dataset_id = next_dataset_id()
    upload_dir = UPLOADS_DIR / "datasets"
    upload_dir.mkdir(parents=True, exist_ok=True)

    parsed_class_names = normalize_class_names_input(class_names_value)
    resolved_num_classes = num_classes if num_classes and num_classes > 0 else None
    if parsed_class_names and resolved_num_classes is None:
        resolved_num_classes = len(parsed_class_names)

    if parsed_class_names and resolved_num_classes != len(parsed_class_names):
        raise HTTPException(
            status_code=400,
            detail="classNames count must match numClasses",
        )

    raw_dataset_source = dataset_source_value
    uploaded_filename = (dataset_file.filename or "").strip() if dataset_file else ""

    if raw_dataset_source and uploaded_filename:
        raise HTTPException(status_code=400, detail="Provide either an existing dataset or a datasetFile, not both")
    if not raw_dataset_source and not uploaded_filename:
        raise HTTPException(status_code=400, detail="Choose an existing dataset or upload datasetFile")

    source_name = Path(raw_dataset_source).name if raw_dataset_source else uploaded_filename
    if source_name == ".":
        source_name = DATASETS_DIR.name

    detail = build_empty_dataset_detail(
        dataset_id=dataset_id,
        name=display_name,
        description=description,
        source_filename=source_name,
    )

    if resolved_num_classes is not None:
        detail["classesCount"] = resolved_num_classes
    if parsed_class_names:
        detail["classes"] = parsed_class_names

    try:
        extraction_dir = upload_dir / f"{dataset_id}_extracted"
        source_path: Path

        if raw_dataset_source:
            source_path = resolve_dataset_source_path(raw_dataset_source)
            if not source_path.exists():
                raise HTTPException(status_code=400, detail=f"Dataset source was not found: {source_path}")
            detail["sourcePath"] = str(source_path)
        else:
            source_path = upload_dir / f"{dataset_id}_{uploaded_filename}"
            with source_path.open("wb") as buffer:
                shutil.copyfileobj(dataset_file.file, buffer)
            detail["sourcePath"] = str(source_path.resolve())

        configure_dataset_from_source(
            detail=detail,
            source_path=source_path,
            resolved_num_classes=resolved_num_classes,
            extraction_dir=extraction_dir,
        )

        if not detail.get("datasetRoot"):
            fallback_root = source_path.parent if source_path.is_file() else source_path
            detail["datasetRoot"] = str(fallback_root.resolve())

        validate_dataset_assets(detail, Path(str(detail["datasetRoot"])).resolve())

    except DATASET_CONFIGURATION_EXCEPTIONS as exc:
        raise HTTPException(status_code=400, detail=f"Failed to configure dataset: {exc}") from exc
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    DATASET_DETAILS[dataset_id] = detail
    refresh_dataset_summary(dataset_id)

    return {
        "id": dataset_id,
        "filename": source_name,
        "savedPath": detail.get("sourcePath"),
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
            validate_dataset_assets(detail, Path(str(detail["datasetRoot"])).resolve())
        except DATASET_CONFIGURATION_EXCEPTIONS as exc:
            for key, value in previous_state.items():
                detail[key] = value
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
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
        validate_dataset_assets(dataset, Path(str(dataset["datasetRoot"])).resolve())
    except DATASET_CONFIGURATION_EXCEPTIONS as exc:
        raise HTTPException(status_code=400, detail=f"Dataset YAML is invalid: {exc}") from exc
    except (FileNotFoundError, IsADirectoryError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
        search_alg=normalize_search_algorithm(payload.get("searchAlg")),
        notes=payload.get("notes"),
        hyperparams=payload.get("hyperparams", {}),
    )
    try:
        trial_count = parse_trial_count(payload.get("optunaTrials", payload.get("randomSearchIterations", 10)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="optunaTrials must be a positive integer") from exc

    RUN_DETAILS[run_id] = detail
    refresh_run_summary(run_id)
    detail["trialCount"] = trial_count
    dataset["lastRunAt"] = detail["startedAt"]
    dataset["status"] = "running"
    if payload.get("targetMetric"):
        dataset["settings"]["targetMetric"] = payload.get("targetMetric")
    if payload.get("device"):
        dataset["settings"]["device"] = payload.get("device")
    dataset["settings"]["searchAlgorithm"] = detail["searchAlgorithm"]

    refresh_dataset_summary(dataset_id)

    RUN_LOGS[run_id] = "\n".join(
        [
            f"Run created: {run_id}",
            f"Dataset: {dataset.get('name', dataset_id)}",
            f"Dataset YAML: {dataset_yaml_path}",
            "Status: queued",
        ]
    )
    safe_update_global_status(
        runId=run_id,
        current_model=0,
        total_models=0,
        status="queued",
        current_config=None,
        best_result=None,
        error=None,
    )

    background_tasks.add_task(
        run_training_task,
        run_id=run_id,
        search_alg=detail["searchAlgorithm"],
        hyperparams=detail["hyperparams"],
        trial_count=trial_count,
        dataset_yaml_path=str(dataset_yaml_path),
        device=detail["device"],
    )

    return {
        "runId": run_id,
        "datasetYamlPath": dataset_yaml_path,
        "statusUrl": "/api/status",
        "runUrl": f"/api/runs/{run_id}",
    }


def run_training_task(
    run_id: str,
    search_alg: Optional[str],
    hyperparams: dict,
    trial_count: int,
    dataset_yaml_path: str,
    device: Optional[str] = None,
):
    try:
        resolved_search_algorithm = normalize_search_algorithm(search_alg)
        append_to_run_log(run_id, "Preparing Optuna search space...")
        append_to_run_log(run_id, f"Using dataset YAML: {dataset_yaml_path}")
        training_device = normalize_training_device(device)
        normalized_params = normalize_hyperparams_payload(hyperparams)
        fixed_params = {"data": dataset_yaml_path}
        if training_device is not None:
            fixed_params["device"] = training_device

        append_to_run_log(run_id, f"Search algorithm: {resolved_search_algorithm}")
        append_to_run_log(run_id, f"Planned trials: {trial_count}")
        if normalized_params:
            append_to_run_log(run_id, f"User search space keys: {', '.join(sorted(normalized_params.keys()))}")
        else:
            append_to_run_log(run_id, "User search space is empty; default Optuna space will be used")
        append_to_run_log(run_id, f"Resolved training device: {training_device}")

        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["status"] = "running"
            RUN_DETAILS[run_id]["errorMessage"] = None
            RUN_DETAILS[run_id]["searchAlgorithm"] = resolved_search_algorithm
            RUN_DETAILS[run_id]["trialCount"] = trial_count
            refresh_run_summary(run_id)

        append_to_run_log(run_id, "Training started...")
        optimizer = TPEOptimizer(
            run_id=run_id,
            output_root=RUNS_DIR / "detect" / run_id,
            log_callback=lambda message: append_to_run_log(run_id, message),
        )
        optimization_result = optimizer.optimize(
            search_space=normalized_params,
            n_trials=trial_count,
            fixed_params=fixed_params,
            study_name=run_id,
            reset_storage=True,
        )
        result = optimization_result["results"]
        print("Training finished")

        completed_results = [item for item in result if item.get("status") == "completed"]
        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["finishedAt"] = now_iso()
            RUN_DETAILS[run_id]["status"] = "finished" if completed_results else "error"
            RUN_DETAILS[run_id]["bestParams"] = optimization_result.get("best_params") or {}
            hydrate_run_detail_from_results(run_id, result)
            refresh_run_summary(run_id)

        dataset_id = RUN_DETAILS.get(run_id, {}).get("datasetId")
        if dataset_id and dataset_id in DATASET_DETAILS:
            DATASET_DETAILS[dataset_id]["status"] = "ready"
            refresh_dataset_summary(dataset_id)

        append_to_run_log(run_id, "Training finished" if completed_results else "Training finished with errors")

    except Exception as exc:
        error_message = f"Training error: {exc}"
        print(error_message)
        append_to_run_log(run_id, error_message)
        safe_update_global_status(
            runId=run_id,
            status="error",
            current_config=None,
            error=str(exc),
        )

        if run_id in RUN_DETAILS:
            RUN_DETAILS[run_id]["status"] = "error"
            RUN_DETAILS[run_id]["finishedAt"] = now_iso()
            RUN_DETAILS[run_id]["errorMessage"] = str(exc)
            refresh_run_summary(run_id)
            dataset_id = RUN_DETAILS[run_id]["datasetId"]
            if dataset_id in DATASET_DETAILS:
                DATASET_DETAILS[dataset_id]["status"] = "ready"
                refresh_dataset_summary(dataset_id)


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




RUNS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
DATASETS_DIR.mkdir(parents=True, exist_ok=True)
(UPLOADS_DIR / "datasets").mkdir(parents=True, exist_ok=True)

if not STATUS_MANAGER.status_file.exists():
    safe_update_global_status(
        runId=None,
        current_model=0,
        total_models=0,
        status="idle",
        current_config=None,
        best_result=None,
        error=None,
    )

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/runs", StaticFiles(directory=str(RUNS_DIR)), name="runs")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static-root")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
