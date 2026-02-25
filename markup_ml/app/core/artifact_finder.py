# Task 1.2.3

from pathlib import Path
from typing import Optional

def find_latest_train_folder(runs_dir: str = "runs/detect") -> Optional[Path]:
    runs_path = Path(runs_dir)

    if not runs_path.is_dir():
        print(f"'{runs_dir}' не является директорией")
        return None
    
    if not runs_path.exists():
        print(f"Директории {runs_dir} не существует")
        return None
    
    folders = [f for f in runs_path.iterdir() if f.is_dir()]

    if not folders:
        print(f"В Директории {runs_dir} нет поддиректорий")
        return None
    
    latest_folder = max(folders, key=lambda f: f.stat().st_mtime)

    return latest_folder