import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class StatusManager:
    def __init__(self, status_file: str = "runs/status.json"):
        status_path = os.getenv("STATUS_FILE", status_file)
        file_path = Path(status_path)
        if file_path.is_absolute():
            self.status_file = file_path
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self.status_file = project_root / file_path

    def _get_default_status(self) -> Dict[str, Any]:
        return {
            "current_model": 0,
            "total_models": 0,
            "status": "idle",
            "current_config": None,
            "best_result": None,
            "runId": None,
            "error": None,
            "updatedAt": None,
        }

    def read_status(self) -> Dict[str, Any]:
        if not self.status_file.exists():
            return self._get_default_status()

        try:
            with open(self.status_file, "r", encoding="utf-8") as file:
                return json.load(file)
        except json.JSONDecodeError:
            logging.error("Status file is corrupted: %s", self.status_file)
            return self._get_default_status()
        except Exception as exc:
            logging.error("Failed to read status file: %s", exc)
            return self._get_default_status()

    def write_status(self, data: Dict[str, Any]) -> bool:
        temp_file = self.status_file.with_suffix(".tmp")
        try:
            self.status_file.parent.mkdir(parents=True, exist_ok=True)

            with open(temp_file, "w", encoding="utf-8") as file:
                json.dump(data, file, indent=2, ensure_ascii=False)
                file.flush()
                os.fsync(file.fileno())

            temp_file.replace(self.status_file)
            return True
        except Exception as exc:
            logging.error("Failed to write status file: %s", exc)
            if temp_file.exists():
                temp_file.unlink()
            return False

    def update_status(self, **updates: Any) -> Dict[str, Any]:
        merged_status = self._get_default_status()
        merged_status.update(self.read_status())
        merged_status.update(updates)

        if not self.write_status(merged_status):
            raise OSError(f"Failed to write status file: {self.status_file}")

        return merged_status

'''
import json
import logging
import os
from pathlib import Path
from typing import Dict, Any

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class StatusManager:
    def __init__(self, status_file: str = "status.json"):
        file_path = Path(status_file)
        if file_path.is_absolute():
            self.status_file = file_path
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self.status_file = project_root / file_path

    def _get_default_status(self) -> Dict[str, Any]:
        return {
            "current_model": 0,
            "total_models": 0,
            "status": "idle",
            "current_config": None,
            "best_result": None
        }

    def read_status(self) -> Dict[str, Any]:
        if not self.status_file.exists():
            return self._get_default_status()
        try:
            with open(self.status_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            logging.error(f"Ошибка: файл {self.status_file} поврежден")
            return self._get_default_status()
        except Exception as e:
            logging.error(f"Ошибка чтения файла статуса: {e}")
            return self._get_default_status()

    def write_status(self, data: Dict[str, Any]) -> bool:
        temp_file = self.status_file.with_suffix('.tmp')
        try:
            self.status_file.parent.mkdir(parents=True, exist_ok=True)

            with open(temp_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())

            temp_file.replace(self.status_file)
            return True

        except Exception as e:
            logging.error(f"Ошибка записи статуса: {e}")
            if temp_file.exists():
                temp_file.unlink()
            return False

    def update_status(self, **updates: Any) -> Dict[str, Any]:
        merged_status = self._get_default_status()
        merged_status.update(self.read_status())
        merged_status.update(updates)

        if not self.write_status(merged_status):
            raise OSError(f"Failed to write status file: {self.status_file}")

        return merged_status

'''