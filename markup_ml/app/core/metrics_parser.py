#Task 2.2.1

from pathlib import Path
from typing import Dict, Optional, Any
import csv


def parse_metrics_from_folder(train_folder: str) -> Optional[Dict[str, Any]]:

    folder_path = Path(train_folder)

    if not folder_path.exists() or not folder_path.is_dir():
        print(f"Папки {train_folder} не существует")
        return None

    csv_path = folder_path / "results.csv"

    if not csv_path.exists():
        print(f"Файл {csv_path} не найден")
        return None

    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)

            headers = next(reader)

            rows = list(reader)
            if not rows:
                print("ERROR: CSV файл пуст")
                return None

            last_row = rows[-1]

            metrics = {}
            for i, value in enumerate(last_row):
                if i < len(headers):
                    try:
                        if '.' not in value:
                            metrics[headers[i]] = int(value)
                        else:
                            metrics[headers[i]] = float(value)
                    except ValueError:
                        metrics[headers[i]] = value

            return metrics

    except Exception as e:
        print(f"Ошибка при чтении CSV: {e}")
        return None


def get_latest_metrics(runs_dir: str = "runs/detect") -> Optional[Dict[str, Any]]:

    from app.core.artifact_finder import find_latest_train_folder

    latest_folder = find_latest_train_folder(runs_dir)
    if latest_folder:
        return parse_metrics_from_folder(latest_folder)

    return None


def get_epoch_loss(metrics: Dict[str, Any]) -> Optional[float]:
    return metrics.get('train/box_loss')



if __name__ == "__main__":

    #просто пример создания csv, его можно скачать из браузера

    print("\nСоздаем тестовый CSV файл")

    #пример пути - гланое чтобы папка runs была в корне
    test_folder = Path("runs/detect/test_metrics")
    test_folder.mkdir(parents=True, exist_ok=True)

    test_csv = test_folder / "results.csv"

    csv_content = """epoch,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision,metrics/recall,metrics/mAP50,metrics/mAP50-95,val/box_loss,val/cls_loss,val/dfl_loss,lr/pg0,lr/pg1,lr/pg2
0,1.234,2.345,1.456,0.567,0.678,0.789,0.456,1.123,2.234,1.345,0.01,0.01,0.01
1,1.111,2.222,1.333,0.678,0.789,0.890,0.567,1.012,2.123,1.234,0.009,0.009,0.009
2,1.000,2.000,1.200,0.789,0.890,0.901,0.678,0.901,2.012,1.123,0.008,0.008,0.008
"""

    with open(test_csv, 'w', encoding='utf-8') as f:
        f.write(csv_content)

    print(f"ОК: {test_csv}")

    metrics = parse_metrics_from_folder("runs/detect/test_metrics")

    if metrics:
        print(f"   Последняя эпоха: {metrics.get('epoch')}")
        print(f"   train/box_loss: {metrics.get('train/box_loss')}")
        print(f"   metrics/mAP50: {metrics.get('metrics/mAP50')}")
        print(f"   Все метрики: {metrics}")

    print("\ntrain/box_loss")
    loss = get_epoch_loss(metrics) if metrics else None
    print(f"train/box_loss: {loss}")

