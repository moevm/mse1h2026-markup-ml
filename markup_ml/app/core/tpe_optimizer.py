from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, Optional

try:
    import optuna
except ModuleNotFoundError:
    optuna = None

from ultralytics import YOLO

from app.core.artifact_finder import find_latest_train_folder
from app.core.file_manager import StatusManager
from app.core.metrics_parser import parse_metrics_from_folder


DEFAULT_SEARCH_SPACE: dict[str, Any] = {
    "epochs": [10],
    "batch": [8, 16],
    "imgsz": [640],
    "lr0": (1e-4, 1e-2),
    "patience": [5],
    "optimizer": ["SGD", "AdamW"],
    "weight_decay": (0.0, 1e-3),
    "momentum": (0.8, 0.98),
}

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

INTEGER_PARAMETERS = {
    "epochs",
    "batch",
    "imgsz",
    "patience",
    "workers",
    "close_mosaic",
}

FLOAT_PARAMETERS = {
    "lr0",
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
}

LOG_SCALE_PARAMETERS = {"lr0", "weight_decay"}
MAP_METRIC_KEYS = (
    "metrics/mAP50-95(B)",
    "metrics/mAP50-95",
    "metrics/mAP50(B)",
    "metrics/mAP50",
    "mAP50-95",
    "mAP50",
    "map",
)
OPTIONAL_TRAINING_PARAMS = (
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


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None

    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "item"):
        try:
            return float(value.item())
        except (TypeError, ValueError, RuntimeError):
            pass

    if isinstance(value, (list, tuple)):
        converted = [_to_float(item) for item in value]
        converted = [item for item in converted if item is not None]
        if not converted:
            return None
        return sum(converted) / len(converted)

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _metric_from_mapping(payload: Any, *keys: str) -> Optional[float]:
    if not isinstance(payload, dict):
        return None

    for key in keys:
        value = _to_float(payload.get(key))
        if value is not None:
            return value

    return None


def _extract_map_metric(trainer: Any) -> Optional[float]:
    metric = _metric_from_mapping(getattr(trainer, "metrics", None), *MAP_METRIC_KEYS)
    if metric is not None:
        return metric

    validator = getattr(trainer, "validator", None)
    metric = _metric_from_mapping(getattr(validator, "metrics", None), *MAP_METRIC_KEYS)
    if metric is not None:
        return metric

    metrics_box = getattr(getattr(validator, "metrics", None), "box", None)
    for attr_name in ("map", "map50", "map75"):
        metric = _to_float(getattr(metrics_box, attr_name, None))
        if metric is not None:
            return metric

    return None


class _OptunaPruningCallback:
    def __init__(
        self,
        trial: Any,
        log_callback: Optional[Callable[[str], None]] = None,
    ):
        self.trial = trial
        self.log_callback = log_callback
        self.best_metric: Optional[float] = None
        self.last_metric: Optional[float] = None
        self.last_epoch = -1
        self.was_pruned = False
        self.prune_message: Optional[str] = None

    def __call__(self, trainer: Any) -> None:
        epoch = int(getattr(trainer, "epoch", 0) or 0)
        score = _extract_map_metric(trainer)
        if score is None:
            return

        self.last_epoch = epoch
        self.last_metric = score
        if self.best_metric is None or score > self.best_metric:
            self.best_metric = score

        self.trial.report(score, step=epoch)
        self._log(f"Trial {getattr(self.trial, 'number', '?')} epoch {epoch}: mAP={score:.5f}")

        if self.trial.should_prune():
            self.was_pruned = True
            self.prune_message = f"Trial {getattr(self.trial, 'number', '?')} pruned at epoch {epoch} with mAP={score:.5f}"
            self._log(self.prune_message)
            trainer.stop = True

    def _log(self, message: str) -> None:
        if callable(self.log_callback):
            self.log_callback(message)


class TPEOptimizer:
    def __init__(
        self,
        base_model: str = "yolov8n.pt",
        run_id: Optional[str] = None,
        output_root: str | Path = "runs/detect/automl",
        log_callback: Optional[Callable[[str], None]] = None,
        seed: Optional[int] = 42,
    ):
        self.base_model = base_model
        self.status_manager = StatusManager()
        self.run_id = run_id
        self.output_root = Path(output_root)
        self.log_callback = log_callback
        self.seed = seed
        self.total_trials = 0
        self.results: list[dict[str, Any]] = []
        self._search_space: dict[str, Any] = {}
        self._fixed_params: dict[str, Any] = {}
        self._best_result: Optional[dict[str, Any]] = None

    def optimize(
        self,
        search_space: Optional[dict[str, Any]] = None,
        n_trials: int = 10,
        fixed_params: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        self._ensure_optuna_available()

        self.results = []
        self._best_result = None
        self.total_trials = max(1, int(n_trials))
        self._search_space = self._prepare_search_space(search_space)
        self._fixed_params = self._normalize_config(fixed_params or {})

        if not self._fixed_params.get("data"):
            raise ValueError("Fixed training parameter 'data' is required for Optuna optimization")

        sampler_kwargs = {"seed": self.seed} if self.seed is not None else {}
        sampler = optuna.samplers.TPESampler(**sampler_kwargs)
        pruner = optuna.pruners.SuccessiveHalvingPruner(min_resource=1, reduction_factor=2)
        study = optuna.create_study(
            direction="maximize",
            sampler=sampler,
            pruner=pruner,
        )

        self.status_manager.update_status(
            current_model=0,
            total_models=self.total_trials,
            status="starting",
            current_config=None,
            best_result=None,
            runId=self.run_id,
            error=None,
        )
        self._log(f"Optuna TPE optimization started with {self.total_trials} trial(s)")

        study.optimize(self.objective, n_trials=self.total_trials, catch=(Exception,))

        completed = [item for item in self.results if item.get("status") == "completed"]
        status = "completed" if completed else "error"
        error = None if completed else self._collect_failure_message()

        self.status_manager.update_status(
            current_model=self.total_trials,
            total_models=self.total_trials,
            status=status,
            current_config=None,
            best_result=self._best_result,
            runId=self.run_id,
            error=error,
        )

        best_params = self._best_result.get("config") if self._best_result else None
        best_value = self._best_result.get("score") if self._best_result else None

        if best_params:
            self._log(f"Best parameters: {best_params}")
        elif error:
            self._log(f"Optimization finished without successful trials: {error}")

        return {
            "results": list(self.results),
            "best_params": best_params,
            "best_value": best_value,
            "study": study,
        }

    def objective(self, trial: Any) -> float:
        trial_index = int(getattr(trial, "number", len(self.results)))
        trial_name = f"trial_{trial_index:03d}"
        suggested_params = self._suggest_params(trial)
        config = {**suggested_params, **self._fixed_params}

        self.status_manager.update_status(
            current_model=trial_index + 1,
            total_models=self.total_trials,
            status="training",
            current_config=config,
            runId=self.run_id,
            error=None,
        )
        self._log(f"Starting trial {trial_index + 1}/{self.total_trials}: {config}")

        train_dir: Optional[Path] = None
        try:
            model = YOLO(self.base_model)
            callback = _OptunaPruningCallback(trial, self.log_callback)
            train_params = self._build_train_params(config, trial_name)

            if hasattr(trial, "set_user_attr"):
                trial.set_user_attr("resolved_params", config)

            model.add_callback("on_fit_epoch_end", callback)
            model.train(**train_params)

            train_dir = self._resolve_train_dir(trial_name)
            metrics = self._read_metrics(train_dir)

            if callback.was_pruned:
                result = self._build_result(
                    trial_index=trial_index,
                    config=config,
                    status="pruned",
                    train_dir=train_dir,
                    metrics=metrics,
                    score=callback.last_metric,
                    error=callback.prune_message,
                )
                self.results.append(result)
                raise optuna.exceptions.TrialPruned(callback.prune_message)

            score = self._resolve_score(metrics, callback.best_metric)
            result = self._build_result(
                trial_index=trial_index,
                config=config,
                status="completed",
                train_dir=train_dir,
                metrics=metrics,
                score=score,
            )
            self.results.append(result)
            self._update_best_result(result)
            self._log(f"Trial {trial_index + 1} completed with mAP={score:.5f}")
            return score

        except optuna.exceptions.TrialPruned:
            raise
        except Exception as exc:
            result = self._build_result(
                trial_index=trial_index,
                config=config,
                status="failed",
                train_dir=train_dir,
                metrics=self._read_metrics(train_dir) if train_dir else None,
                error=str(exc),
            )
            self.results.append(result)
            self._log(f"Trial {trial_index + 1} failed: {exc}")
            raise

    def _prepare_search_space(self, search_space: Optional[dict[str, Any]]) -> dict[str, Any]:
        prepared = self._normalize_config(DEFAULT_SEARCH_SPACE)
        for raw_key, raw_value in (search_space or {}).items():
            prepared[self._normalize_parameter_name(raw_key)] = raw_value
        return prepared

    def _suggest_params(self, trial: Any) -> dict[str, Any]:
        params: dict[str, Any] = {}
        for key, spec in self._search_space.items():
            params[key] = self._suggest_param(trial, key, spec)
        return params

    def _suggest_param(self, trial: Any, name: str, spec: Any) -> Any:
        if isinstance(spec, tuple):
            if len(spec) != 2:
                raise ValueError(f"Range hyperparameter '{name}' must contain exactly two values")

            low = self._normalize_value(name, spec[0])
            high = self._normalize_value(name, spec[1])
            if low is None or high is None:
                raise ValueError(f"Range hyperparameter '{name}' contains empty boundary values")

            if isinstance(low, int) and isinstance(high, int):
                return trial.suggest_int(name, low, high)

            if isinstance(low, (int, float)) and isinstance(high, (int, float)):
                use_log_scale = name in LOG_SCALE_PARAMETERS and float(low) > 0 and float(high) > 0
                return trial.suggest_float(name, float(low), float(high), log=use_log_scale)

            raise TypeError(f"Unsupported range type for hyperparameter '{name}'")

        if isinstance(spec, list):
            normalized_values = [self._normalize_value(name, value) for value in spec]
            normalized_values = [value for value in normalized_values if value is not None and value != ""]
            if not normalized_values:
                raise ValueError(f"Categorical hyperparameter '{name}' must contain at least one value")
            if len(normalized_values) == 1:
                return normalized_values[0]
            return trial.suggest_categorical(name, normalized_values)

        return self._normalize_value(name, spec)

    def _build_train_params(self, config: dict[str, Any], trial_name: str) -> dict[str, Any]:
        train_params = {
            "data": config["data"],
            "epochs": int(config["epochs"]),
            "batch": int(config["batch"]),
            "imgsz": int(config["imgsz"]),
            "lr0": float(config["lr0"]),
            "patience": int(config["patience"]),
            "project": str(self.output_root),
            "name": trial_name,
            "exist_ok": True,
            "verbose": False,
        }

        for key in OPTIONAL_TRAINING_PARAMS:
            value = config.get(key)
            if value is not None:
                train_params[key] = value

        return train_params

    def _resolve_train_dir(self, trial_name: str) -> Optional[Path]:
        direct_dir = self.output_root / trial_name
        if direct_dir.exists():
            return direct_dir

        fallback_dir = find_latest_train_folder(str(self.output_root))
        if not fallback_dir:
            return None

        resolved = Path(fallback_dir)
        return resolved if resolved.exists() else None

    def _read_metrics(self, train_dir: Optional[Path]) -> Optional[dict[str, Any]]:
        if train_dir is None or not train_dir.exists():
            return None
        return parse_metrics_from_folder(str(train_dir))

    def _build_result(
        self,
        trial_index: int,
        config: dict[str, Any],
        status: str,
        train_dir: Optional[Path],
        metrics: Optional[dict[str, Any]] = None,
        score: Optional[float] = None,
        error: Optional[str] = None,
    ) -> dict[str, Any]:
        model_path = None
        if train_dir is not None:
            best_model = train_dir / "weights" / "best.pt"
            if best_model.exists():
                model_path = str(best_model)

        result = {
            "trial": trial_index,
            "config": config,
            "status": status,
            "metrics": metrics,
            "score": score,
            "train_dir": str(train_dir) if train_dir is not None else None,
            "model_path": model_path,
        }
        if error:
            result["error"] = error
        return result

    def _update_best_result(self, result: dict[str, Any]) -> None:
        score = self._resolve_score(result.get("metrics"), result.get("score"))
        if self._best_result is not None and score <= self._best_result.get("score", float("-inf")):
            return

        self._best_result = {
            "trial": result["trial"],
            "config": result["config"],
            "score": score,
            "model_path": result.get("model_path"),
        }
        self.status_manager.update_status(
            best_result=self._best_result,
            runId=self.run_id,
        )

    def _collect_failure_message(self) -> Optional[str]:
        failures = [
            str(result.get("error")).strip()
            for result in self.results
            if result.get("status") == "failed" and str(result.get("error", "")).strip()
        ]
        if not failures:
            return None
        return "; ".join(failures[:3])

    def _log(self, message: str) -> None:
        if callable(self.log_callback):
            self.log_callback(message)

    @staticmethod
    def _resolve_score(metrics: Optional[dict[str, Any]], fallback: Optional[float]) -> float:
        for key in MAP_METRIC_KEYS:
            value = _metric_from_mapping(metrics, key)
            if value is not None:
                return value
        return float(fallback or 0.0)

    @classmethod
    def _normalize_config(cls, config: Optional[dict[str, Any]]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        for raw_key, raw_value in (config or {}).items():
            key = cls._normalize_parameter_name(raw_key)
            normalized[key] = cls._normalize_value(key, raw_value)
        return normalized

    @staticmethod
    def _normalize_parameter_name(raw_key: Any) -> str:
        key = str(raw_key or "").strip()
        return PARAMETER_ALIASES.get(key, key)

    @staticmethod
    def _normalize_value(key: str, value: Any) -> Any:
        if value is None:
            return None

        if isinstance(value, tuple):
            return tuple(TPEOptimizer._normalize_value(key, item) for item in value)

        if isinstance(value, list):
            return [TPEOptimizer._normalize_value(key, item) for item in value]

        if key in INTEGER_PARAMETERS:
            try:
                return int(float(value))
            except (TypeError, ValueError):
                return value

        if key in FLOAT_PARAMETERS:
            try:
                return float(value)
            except (TypeError, ValueError):
                return value

        if isinstance(value, str):
            text = value.strip()
            if text.lower() in {"true", "false"}:
                return text.lower() == "true"

        return value

    @staticmethod
    def _ensure_optuna_available() -> None:
        if optuna is None:
            raise RuntimeError("Optuna is not installed. Install dependencies from requirements.txt first.")
