#Task 2.3.1

from typing import List, Dict, Any
from pathlib import Path
import time
from ultralytics import YOLO

from app.core.file_manager import StatusManager
from app.core.training_results import read_latest_epoch_and_box_loss
from app.core.artifact_finder import find_latest_train_folder
from app.core.callbacks import create_early_stopping_callback


class AutoMLOrchestrator:
    def __init__(self, base_model: str = "yolov8n.pt"):

        self.base_model = base_model
        self.status_manager = StatusManager()
        self.current_trial = 0
        self.total_trials = 0

    def run_single_trial(self, config: Dict[str, Any], trial_idx: int):

        print(f"\n{'=' * 60}")
        print(f"Запуск попытки {trial_idx + 1}/{self.total_trials}")
        print(f"Конфигурация: {config}")

        self.status_manager.update_status(
            current_model=trial_idx + 1,
            total_models=self.total_trials,
            status="training",
            current_config=config
        )
        model = YOLO(self.base_model)
        data_path = config.get('data', 'coco8.yaml')
        train_params = {
            'data': data_path,
            'epochs': config.get('epochs', 10),
            'batch': config.get('batch', 16),
            'imgsz': config.get('imgsz', 640),
            'lr0': config.get('lr0', 0.01),
            'device': config.get('device'),
            'project': 'runs/detect/automl',
            'name': f'trial_{trial_idx:03d}',
            'exist_ok': True,
            'verbose': False
        }

        if config.get('device') is not None:
            train_params['device'] = config.get('device')

        early_stopping = create_early_stopping_callback()

        #обучение
        try:
            model.add_callback('on_fit_epoch_end', early_stopping)
            model.train(**train_params)

            #папка с результатами
            latest_folder = find_latest_train_folder("runs/detect/automl")

            #получаем метрики
            metrics = None
            if latest_folder:
                metrics = read_latest_epoch_and_box_loss(latest_folder)

            result = {
                'trial': trial_idx,
                'config': config,
                'status': 'completed',
                'metrics': metrics,
                'model_path': str(Path(latest_folder) / 'weights/best.pt') if latest_folder else None
            }

        except Exception as e:
            print(f"Ошибка: {e}")
            result = {
                'trial': trial_idx,
                'config': config,
                'status': 'failed',
                'error': str(e)
            }

        return result

    def run(self, config_list: List[Dict[str, Any]]):
        self.total_trials = len(config_list)
        results = []
        self.status_manager.update_status(
            current_model=0,
            total_models=self.total_trials,
            status="starting",
            current_config=None
        )

        for i, config in enumerate(config_list):
            result = self.run_single_trial(config, i)
            results.append(result)

            if i < len(config_list) - 1:
                time.sleep(2)

        best_result = self._find_best_result(results)
        self.status_manager.update_status(
            current_model=self.total_trials,
            total_models=self.total_trials,
            status="completed",
            best_result=best_result
        )

        print(f"Всего попыток: {self.total_trials}")

        if best_result:
            print(f"Лучший результат: {best_result}")

        return results

    def _find_best_result(self, results: List[Dict[str, Any]]):

        best = None
        best_score = -1

        for r in results:
            if r['status'] == 'completed' and r.get('metrics'):
                score = r['metrics'].get('metrics/mAP50-95', 0)
                if score > best_score:
                    best_score = score
                    best = {
                        'trial': r['trial'],
                        'config': r['config'],
                        'score': score,
                        'model_path': r['model_path']
                    }

        return best


def run_automl(config_list: List[Dict[str, Any]], base_model: str = "yolov8n.pt"):
    orchestrator = AutoMLOrchestrator(base_model)
    return orchestrator.run(config_list)


#пример работы
if __name__ == "__main__":

    test_configs = [
        {
            'data': 'coco8.yaml',
            'epochs': 1,
            'batch': 8,
            'imgsz': 160,
            'lr0': 0.01
        },
        {
            'data': 'coco8.yaml',
            'epochs': 1,
            'batch': 8,
            'imgsz': 160,
            'lr0': 0.001
        }
    ]

    for i, config in enumerate(test_configs):
        print(f"  {i + 1}. {config}")
    results = run_automl(test_configs)

    print(f"\nРезультаты:")
    for r in results:
        status = "OK" if r['status'] == 'completed' else "-"
        print(f"  {status} Попытка {r['trial']}: {r['status']}")
