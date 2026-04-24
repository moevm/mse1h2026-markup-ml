import csv
from pathlib import Path


def read_latest_epoch_and_box_loss(training_dir: str | Path) -> dict[str, int | float]:
    """
    Reads results.csv inside training_dir, takes the last non-empty row,
    and returns epoch plus train/box_loss as numeric values.
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


def read_training_history(training_dir: str | Path) -> dict[str, list[float]]:
    """
    Reads results.csv inside training_dir and returns metric history arrays
    that can be rendered directly by the frontend.
    """

    results_path = _find_results_csv(Path(training_dir))

    history = {
        "loss": [],
        "map": [],
        "precision": [],
        "recall": [],
    }

    with results_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)

        if not reader.fieldnames:
            raise ValueError(f"results.csv is empty or has no header: {results_path}")

        for row in reader:
            normalized_row = {
                str(key).strip(): value.strip() if isinstance(value, str) else value
                for key, value in row.items()
                if key is not None
            }

            if _is_empty_row(normalized_row):
                continue

            _append_numeric_metric(history["loss"], normalized_row, "train/box_loss")
            _append_numeric_metric(
                history["map"],
                normalized_row,
                "metrics/mAP50-95(B)",
                "metrics/mAP50-95",
            )
            _append_numeric_metric(
                history["precision"],
                normalized_row,
                "metrics/precision(B)",
                "metrics/precision",
            )
            _append_numeric_metric(
                history["recall"],
                normalized_row,
                "metrics/recall(B)",
                "metrics/recall",
            )

    return history


def _find_results_csv(base_path: Path) -> Path:
    direct_path = base_path / "results.csv"
    if direct_path.is_file():
        return direct_path

    nested_matches = sorted(base_path.rglob("results.csv"))
    if nested_matches:
        return nested_matches[0]

    raise FileNotFoundError(f"results.csv was not found inside: {base_path}")


def _get_required_value(row: dict[str, str], key: str) -> str:
    if key not in row:
        raise KeyError(f"Column '{key}' not found in results.csv")

    value = row[key]
    if value in ("", None):
        raise ValueError(f"Column '{key}' is empty in results.csv")

    return value


def _is_empty_row(row: dict[str, str]) -> bool:
    return all(value in ("", None) for value in row.values())


def _append_numeric_metric(target: list[float], row: dict[str, str], *keys: str) -> None:
    for key in keys:
        raw_value = row.get(key)
        if raw_value in ("", None):
            continue

        try:
            target.append(float(raw_value))
            return
        except (TypeError, ValueError):
            continue
