from __future__ import annotations

from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional

from ultralytics import YOLO

from app.core.artifact_finder import find_latest_train_folder
from app.core.callbacks import create_early_stopping_callback
from app.core.file_manager import StatusManager
from app.core.metrics_parser import parse_metrics_from_folder


REQUIRED_TRAINING_PARAMS = ("data", "epochs", "batch", "imgsz", "lr0", "patience")

PARAMETER_ALIASES = {
    "learningRate": "lr0",
    "learning_rate": "lr0",
    "lr": "lr0",
    "batchSize": "batch",
    "batch_size": "batch",
    "imageSize": "imgsz",
    "image_size": "imgsz",
    "imgSize": "imgsz",
    "img_size": "imgsz",
}

INTEGER_PARAMETERS = {"epochs", "batch", "imgsz", "patience", "workers", "early_stopping_patience", "early_stopping_min_epochs"}


class AutoMLOrchestrator:
    def __init__(
        self,
        base_model: str = "yolov8n.pt",
        run_id: Optional[str] = None,
        output_root: str | Path = "runs/detect/automl",
        log_callback: Optional[Callable[[str], None]] = None,
    ):
        self.base_model = base_model
        self.status_manager = StatusManager()
        self.current_trial = 0
        self.total_trials = 0
        self.run_id = run_id
        self.output_root = Path(output_root)
        self.log_callback = log_callback

    def run_single_trial(self, config: Dict[str, Any], trial_idx: int):
        normalized_config = self._normalize_config(config)
        trial_name = f"trial_{trial_idx:03d}"

        print(f"\n{'=' * 60}")
        print(f"Starting trial {trial_idx + 1}/{self.total_trials}")
        print(f"Configuration: {normalized_config}")
        self._log(f"Starting trial {trial_idx + 1}/{self.total_trials}: {normalized_config}")

        self.status_manager.update_status(
            current_model=trial_idx + 1,
            total_models=self.total_trials,
            status="training",
            current_config=normalized_config,
            runId=self.run_id,
            error=None,
        )

        result: dict[str, Any]
        try:
            train_params = self._build_train_params(normalized_config, trial_name)
            model = YOLO(self.base_model)

            early_stopping_kwargs = {
                "patience": int(normalized_config.get("early_stopping_patience", normalized_config["patience"])),
            }
            if normalized_config.get("early_stopping_min_delta") is not None:
                early_stopping_kwargs["min_delta"] = float(normalized_config["early_stopping_min_delta"])
            if normalized_config.get("early_stopping_min_epochs") is not None:
                early_stopping_kwargs["min_epochs"] = int(normalized_config["early_stopping_min_epochs"])

            early_stopping = create_early_stopping_callback(**early_stopping_kwargs)

            model.add_callback("on_fit_epoch_end", early_stopping)
            model.train(**train_params)

            latest_folder = self.output_root / trial_name
            if not latest_folder.exists():
                fallback_folder = find_latest_train_folder(str(self.output_root))
                latest_folder = Path(fallback_folder) if fallback_folder else latest_folder

            metrics = None
            if latest_folder.exists():
                metrics = parse_metrics_from_folder(str(latest_folder))

            best_model_path = latest_folder / "weights" / "best.pt"
            result = {
                "trial": trial_idx,
                "config": normalized_config,
                "status": "completed",
                "metrics": metrics,
                "train_dir": str(latest_folder) if latest_folder.exists() else None,
                "model_path": str(best_model_path) if best_model_path.exists() else None,
            }
            self._log(f"Trial {trial_idx + 1} completed")

        except Exception as exc:
            print(f"Error: {exc}")
            self._log(f"Trial {trial_idx + 1} failed: {exc}")
            result = {
                "trial": trial_idx,
                "config": normalized_config,
                "status": "failed",
                "error": str(exc),
            }

        return result

    def run(self, config_list: List[Dict[str, Any]]):
        self.total_trials = len(config_list)
        results = []
        self.status_manager.update_status(
            current_model=0,
            total_models=self.total_trials,
            status="starting",
            current_config=None,
            runId=self.run_id,
            error=None,
        )
        self._log(f"AutoML run started with {self.total_trials} trial(s)")

        for i, config in enumerate(config_list):
            result = self.run_single_trial(config, i)
            results.append(result)

            if i < len(config_list) - 1:
                time.sleep(2)

        best_result = self._find_best_result(results)
        completed_results = [item for item in results if item.get("status") == "completed"]
        failure_message = self._collect_failure_message(results)

        self.status_manager.update_status(
            current_model=self.total_trials,
            total_models=self.total_trials,
            status="completed" if completed_results else "error",
            best_result=best_result,
            runId=self.run_id,
            current_config=None,
            error=failure_message if not completed_results else None,
        )

        print(f"Total trials: {self.total_trials}")

        if best_result:
            print(f"Best result: {best_result}")
            self._log(f"Run completed. Best trial: {best_result}")
        elif failure_message:
            self._log(f"Run finished with errors: {failure_message}")

        return results

    def _build_train_params(self, config: Dict[str, Any], trial_name: str) -> dict[str, Any]:
        self._validate_required_training_params(config)

        train_params = {
            "data": config["data"],
            "epochs": config["epochs"],
            "batch": config["batch"],
            "imgsz": config["imgsz"],
            "lr0": config["lr0"],
            "patience": config["patience"],
            "project": str(self.output_root),
            "name": trial_name,
            "exist_ok": True,
            "verbose": False,
        }

        optional_params = (
            "device",
            "workers",
            "optimizer",
            "weight_decay",
            "momentum",
            "dropout",
            "degrees",
            "translate",
            "scale",
            "shear",
            "fliplr",
            "flipud",
            "mosaic",
            "mixup",
            "close_mosaic",
            "cos_lr",
        )

        for key in optional_params:
            value = config.get(key)
            if value is not None:
                train_params[key] = value

        return train_params

    @staticmethod
    def _validate_required_training_params(config: Dict[str, Any]) -> None:
        missing = [
            key
            for key in REQUIRED_TRAINING_PARAMS
            if key not in config or config.get(key) is None or str(config.get(key)).strip() == ""
        ]
        if missing:
            missing_as_text = ", ".join(missing)
            raise ValueError(
                "Missing required training parameter(s): "
                f"{missing_as_text}. Provide them explicitly in the run hyperparameters."
            )

    def _normalize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}

        for raw_key, raw_value in (config or {}).items():
            key = PARAMETER_ALIASES.get(str(raw_key), str(raw_key))
            normalized[key] = self._normalize_value(key, raw_value)

        return normalized

    @staticmethod
    def _normalize_value(key: str, value: Any) -> Any:
        if value is None:
            return value

        if key in INTEGER_PARAMETERS:
            try:
                return int(float(value))
            except (TypeError, ValueError):
                return value

        if key in {"lr0", "weight_decay", "momentum", "dropout", "degrees", "translate", "scale", "shear", "fliplr", "flipud", "mosaic", "mixup"}:
            try:
                return float(value)
            except (TypeError, ValueError):
                return value

        return value

    def _find_best_result(self, results: List[Dict[str, Any]]):
        best = None
        best_score = -1.0

        for result in results:
            if result["status"] != "completed" or not result.get("metrics"):
                continue

            score = self._metric_value(result["metrics"], "metrics/mAP50-95(B)", "metrics/mAP50-95")
            if score > best_score:
                best_score = score
                best = {
                    "trial": result["trial"],
                    "config": result["config"],
                    "score": score,
                    "model_path": result.get("model_path"),
                }

        return best

    def _collect_failure_message(self, results: List[Dict[str, Any]]) -> Optional[str]:
        failures = [str(item.get("error")).strip() for item in results if item.get("status") == "failed"]
        failures = [message for message in failures if message]
        if not failures:
            return None
        return "; ".join(failures[:3])

    def _log(self, message: str) -> None:
        if callable(self.log_callback):
            self.log_callback(message)

    @staticmethod
    def _metric_value(metrics: Dict[str, Any], *keys: str) -> float:
        for key in keys:
            value = metrics.get(key)
            if value is None:
                continue

            try:
                return float(value)
            except (TypeError, ValueError):
                continue

        return 0.0


def run_automl(config_list: List[Dict[str, Any]], base_model: str = "yolov8n.pt"):
    orchestrator = AutoMLOrchestrator(base_model)
    return orchestrator.run(config_list)


if __name__ == "__main__":
    test_configs = [
        {
            "data": "coco8.yaml",
            "epochs": 1,
            "batch": 8,
            "imgsz": 160,
            "lr0": 0.01,
            "patience": 3,
        },
        {
            "data": "coco8.yaml",
            "epochs": 1,
            "batch": 8,
            "imgsz": 160,
            "lr0": 0.001,
            "patience": 3,
        },
    ]

    for i, config in enumerate(test_configs):
        print(f"  {i + 1}. {config}")
    results = run_automl(test_configs)

    print("\nResults:")
    for result in results:
        status = "OK" if result["status"] == "completed" else "-"
        print(f"  {status} Trial {result['trial']}: {result['status']}")
