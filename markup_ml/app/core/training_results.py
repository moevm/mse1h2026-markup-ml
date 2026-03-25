from __future__ import annotations

import csv
from pathlib import Path


def read_latest_epoch_and_box_loss(training_dir: str | Path) -> dict[str, int | float]:
    """
    Ищет results.csv внутри training_dir, читает последнюю непустую строку
    и возвращает словарь с epoch и train/box_loss в числовом формате
    """

    base_path = Path(training_dir)

    if not base_path.exists():
        raise FileNotFoundError(f"Training directory does not exist: {base_path}")

    if not base_path.is_dir():
        raise NotADirectoryError(f"Expected directory path, got file: {base_path}")

    results_path = _find_results_csv(base_path)

    with results_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)

        if not reader.fieldnames:
            raise ValueError(f"results.csv is empty or has no header: {results_path}")

        last_row: dict[str, str] | None = None

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
            raise ValueError(f"results.csv has no data rows: {results_path}")

    epoch_raw = _get_required_value(last_row, "epoch")
    box_loss_raw = _get_required_value(last_row, "train/box_loss")

    try:
        epoch = int(float(epoch_raw))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid epoch value: {epoch_raw}") from exc

    try:
        box_loss = float(box_loss_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid train/box_loss value: {box_loss_raw}") from exc

    return {
        "epoch": epoch,
        "train/box_loss": box_loss,
    }


def _find_results_csv(base_path: Path) -> Path:
    direct_path = base_path / "results.csv"
    if direct_path.is_file():
        return direct_path

    matches = list(base_path.rglob("results.csv"))
    if not matches:
        raise FileNotFoundError(f"results.csv not found in directory: {base_path}")
    return max(matches, key=lambda p: p.stat().st_mtime)

    return matches[0]


def _get_required_value(row: dict[str, str], key: str) -> str:
    if key not in row:
        available_columns = ", ".join(row.keys())
        raise KeyError(f"Column '{key}' not found. Available columns: {available_columns}")
    return row[key]


def _is_empty_row(row: dict[str, str]) -> bool:
    return all(value in ("", None) for value in row.values())