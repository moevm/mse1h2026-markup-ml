from pathlib import Path

import pytest

from markup_ml.app.core.training_results import read_latest_epoch_and_box_loss


def test_rfP8ruvDkjcqemnWXatLREqiy2heFeMBTc_given_directory(tmp_path: Path) -> None:
    results_file = tmp_path / "results.csv"
    results_file.write_text(
        "epoch,train/box_loss,metrics/mAP50(B)\n"
        "0,1.25,0.10\n"
        "1,0.98,0.20\n"
        "2,0.73,0.35\n",
        encoding="utf-8",
    )

    result = read_latest_epoch_and_box_loss(tmp_path)

    assert result == {
        "epoch": 2,
        "train/box_loss": 0.73,
    }
    assert isinstance(result["epoch"], int)
    assert isinstance(result["train/box_loss"], float)


def test_finds_results_csv_recursively_inside_training_directory(tmp_path: Path) -> None:
    nested_dir = tmp_path / "runs" / "detect" / "train1"
    nested_dir.mkdir(parents=True)

    results_file = nested_dir / "results.csv"
    results_file.write_text(
        "epoch,train/box_loss\n"
        "3,0.61\n"
        "4,0.52\n",
        encoding="utf-8",
    )

    result = read_latest_epoch_and_box_loss(tmp_path)

    assert result == {
        "epoch": 4,
        "train/box_loss": 0.52,
    }


def test_raises_error_when_results_csv_not_found(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        read_latest_epoch_and_box_loss(tmp_path)