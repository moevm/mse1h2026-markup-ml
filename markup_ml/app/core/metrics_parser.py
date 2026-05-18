from pathlib import Path
from typing import Dict, Optional, Any
import csv


def parse_metrics_from_folder(train_folder: str) -> Optional[Dict[str, Any]]:
    folder_path = Path(train_folder)

    if not folder_path.exists() or not folder_path.is_dir():
        print(f"Training folder does not exist: {train_folder}")
        return None

    csv_path = folder_path / "results.csv"
    if not csv_path.exists():
        print(f"results.csv was not found: {csv_path}")
        return None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)

            if not reader.fieldnames:
                print(f"results.csv has no header: {csv_path}")
                return None

            last_row: Optional[dict[str, Any]] = None
            for row in reader:
                normalized_row = {
                    str(key).strip(): value.strip() if isinstance(value, str) else value
                    for key, value in row.items()
                    if key is not None
                }

                if _is_empty_row(normalized_row):
                    continue

                last_row = normalized_row

            if last_row is None:
                print(f"results.csv has no metric rows: {csv_path}")
                return None

        raw_metrics: dict[str, Any] = {}
        for key, value in last_row.items():
            normalized_key = str(key).strip()
            if value in ("", None):
                continue

            try:
                numeric_value = float(value)
                raw_metrics[normalized_key] = int(numeric_value) if numeric_value.is_integer() else numeric_value
            except (TypeError, ValueError):
                raw_metrics[normalized_key] = value

        normalized_metrics = {
            "epoch": _first_metric(raw_metrics, "epoch"),
            "train_box_loss": _first_metric(raw_metrics, "train/box_loss"),
            "train_cls_loss": _first_metric(raw_metrics, "train/cls_loss"),
            "train_dfl_loss": _first_metric(raw_metrics, "train/dfl_loss"),
            "precision": _first_metric(raw_metrics, "metrics/precision(B)", "metrics/precision"),
            "recall": _first_metric(raw_metrics, "metrics/recall(B)", "metrics/recall"),
            "mAP50": _first_metric(raw_metrics, "metrics/mAP50(B)", "metrics/mAP50"),
            "mAP": _first_metric(raw_metrics, "metrics/mAP50-95(B)", "metrics/mAP50-95"),
            "val_box_loss": _first_metric(raw_metrics, "val/box_loss"),
            "val_cls_loss": _first_metric(raw_metrics, "val/cls_loss"),
            "val_dfl_loss": _first_metric(raw_metrics, "val/dfl_loss"),
            "inference_time": _first_metric(raw_metrics, "speed/inference", "inference_time"),
        }

        return {
            "raw": raw_metrics,
            "normalized": normalized_metrics,
            **raw_metrics,
        }

    except Exception as exc:
        print(f"Failed to parse results.csv: {exc}")
        return None


def get_latest_metrics(runs_dir: str = "runs/detect") -> Optional[Dict[str, Any]]:
    from app.core.artifact_finder import find_latest_train_folder

    latest_folder = find_latest_train_folder(runs_dir)
    if latest_folder:
        return parse_metrics_from_folder(latest_folder)

    return None


def get_epoch_loss(metrics: Dict[str, Any]) -> Optional[float]:
    return _first_metric(metrics, "train/box_loss")


def _is_empty_row(row: dict[str, Any]) -> bool:
    return all(value in ("", None) for value in row.values())


def _first_metric(metrics: dict[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        value = metrics.get(key)
        if value in ("", None):
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return None
