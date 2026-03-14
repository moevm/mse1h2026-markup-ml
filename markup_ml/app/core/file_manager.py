# Task 1.2.1

import json
from pathlib import Path
from typing import Dict, Any


class StatusManager:
    def __init__(self, status_file: str = "status.json"):
        file_path = Path(status_file)
        if file_path.is_absolute():
            self.status_file = file_path
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self.status_file = project_root / file_path

    def read_status(self) -> Dict[str, Any]:
        if not self.status_file.exists():
            return {
                "current_model": 0,
                "total_models": 0,
                "status": "idle",
                "current_config": None,
                "best_result": None
            }
        try:
            with open(self.status_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Ошибка: файл {self.status_file} поврежден")
            return {}
        except Exception as e:
            print(f"Ошибка чтения: {e}")
            return {}

    def write_status(self, data: Dict[str, Any]) -> bool:
        try:
            self.status_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.status_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Ошибка записи статуса: {e}")
            return False