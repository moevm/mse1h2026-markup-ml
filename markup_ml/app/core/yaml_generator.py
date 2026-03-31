from pathlib import Path
from typing import Optional, Sequence

import yaml


def normalize_class_names(
    num_classes: int,
    class_names: Optional[Sequence[str]] = None,
) -> list[str]:
    if num_classes <= 0:
        raise ValueError("num_classes must be greater than 0")

    if class_names is None:
        return [f"class_{index}" for index in range(num_classes)]

    normalized = [str(name).strip() for name in class_names if str(name).strip()]
    if len(normalized) != num_classes:
        raise ValueError(
            "The number of class names must match num_classes"
        )

    return normalized


def build_yolo_yaml_payload(
    dataset_path: str | Path,
    num_classes: int,
    class_names: Optional[Sequence[str]] = None,
    train_folder: str = "images/train",
    val_folder: str = "images/val",
    test_folder: Optional[str] = "images/test",
) -> dict:
    dataset_root = Path(dataset_path).resolve()
    payload = {
        "path": str(dataset_root),
        "train": train_folder,
        "val": val_folder,
        "nc": num_classes,
        "names": normalize_class_names(num_classes, class_names),
    }

    if test_folder:
        payload["test"] = test_folder

    return payload


def generate_yolo_yaml(
    dataset_path: str | Path,
    num_classes: int,
    class_names: Optional[Sequence[str]] = None,
    output_path: Optional[str | Path] = None,
    train_folder: str = "images/train",
    val_folder: str = "images/val",
    test_folder: Optional[str] = "images/test",
) -> str:
    dataset_root = Path(dataset_path).resolve()
    dataset_root.mkdir(parents=True, exist_ok=True)

    payload = build_yolo_yaml_payload(
        dataset_path=dataset_root,
        num_classes=num_classes,
        class_names=class_names,
        train_folder=train_folder,
        val_folder=val_folder,
        test_folder=test_folder,
    )

    yaml_path = Path(output_path).resolve() if output_path else dataset_root / "data.yaml"
    yaml_path.parent.mkdir(parents=True, exist_ok=True)

    with yaml_path.open("w", encoding="utf-8") as file:
        yaml.safe_dump(payload, file, default_flow_style=False, sort_keys=False, allow_unicode=True)

    return str(yaml_path)
