import base64
from pathlib import Path
import sys
import types

from fastapi.testclient import TestClient
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class _FakeImage:
    shape = (1, 1, 3)


fake_cv2 = types.ModuleType("cv2")
fake_cv2.imread = lambda path: _FakeImage() if Path(path).exists() else None
sys.modules.setdefault("cv2", fake_cv2)


class _PlaceholderYOLO:
    def __init__(self, *args, **kwargs):
        pass

    def add_callback(self, *args, **kwargs):
        return None

    def train(self, **kwargs):
        return None


fake_ultralytics = types.ModuleType("ultralytics")
fake_ultralytics.YOLO = _PlaceholderYOLO
sys.modules.setdefault("ultralytics", fake_ultralytics)


class _FakeCuda:
    @staticmethod
    def is_available():
        return False

    @staticmethod
    def device_count():
        return 0


fake_torch = types.ModuleType("torch")
fake_torch.cuda = _FakeCuda()
sys.modules.setdefault("torch", fake_torch)

import main as main_module
from app.core.file_manager import StatusManager


MINIMAL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z7mQAAAAASUVORK5CYII="
)


def write_dataset(dataset_root: Path) -> None:
    for split in ("train", "val"):
        images_dir = dataset_root / split / "images"
        labels_dir = dataset_root / split / "labels"
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)
        (images_dir / f"{split}_sample.png").write_bytes(MINIMAL_PNG)
        (labels_dir / f"{split}_sample.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")


def reset_runtime_state() -> None:
    main_module.DATASETS.clear()
    main_module.DATASET_DETAILS.clear()
    main_module.RUNS.clear()
    main_module.RUN_DETAILS.clear()
    main_module.RUN_LOGS.clear()
    main_module.DATASET_ID_COUNTER = make_counter(1)
    main_module.RUN_ID_COUNTER = make_counter(1)


def make_counter(start: int = 1):
    current = start
    while True:
        yield current
        current += 1


def repoint_static_mounts(runs_dir: Path) -> None:
    for route in main_module.app.routes:
        if getattr(route, "path", None) != "/runs":
            continue

        route.app.directory = str(runs_dir)
        route.app.all_directories = [str(runs_dir)]
        route.app.config_checked = False


class FakeOrchestrator:
    def __init__(self, base_model="yolov8n.pt", run_id=None, output_root="runs/detect/automl", log_callback=None):
        self.run_id = run_id
        self.output_root = Path(output_root)
        self.log_callback = log_callback

    def run(self, config_list):
        trial_dir = self.output_root / "trial_000"
        weights_dir = trial_dir / "weights"
        weights_dir.mkdir(parents=True, exist_ok=True)
        (weights_dir / "best.pt").write_bytes(b"fake-pt")
        (weights_dir / "last.pt").write_bytes(b"fake-last-pt")
        (trial_dir / "results.png").write_bytes(MINIMAL_PNG)
        (trial_dir / "results.csv").write_text(
            "epoch,train/box_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)\n"
            "0,1.10,0.51,0.47,0.60,0.42\n"
            "1,0.82,0.74,0.69,0.81,0.67\n",
            encoding="utf-8",
        )

        if callable(self.log_callback):
            self.log_callback("Fake orchestrator finished trial_000")

        main_module.safe_update_global_status(
            runId=self.run_id,
            current_model=1,
            total_models=1,
            status="completed",
            current_config=config_list[0] if config_list else None,
            best_result={"trial": 0, "score": 0.67},
            error=None,
        )

        return [
            {
                "trial": 0,
                "config": config_list[0] if config_list else {},
                "status": "completed",
                "metrics": {
                    "train/box_loss": 0.82,
                    "metrics/precision(B)": 0.74,
                    "metrics/recall(B)": 0.69,
                    "metrics/mAP50(B)": 0.81,
                    "metrics/mAP50-95(B)": 0.67,
                },
                "train_dir": str(trial_dir),
                "model_path": str(weights_dir / "best.pt"),
            }
        ]


def test_e2e_dataset_path_to_artifact_download(monkeypatch, tmp_path: Path) -> None:
    reset_runtime_state()

    runs_dir = tmp_path / "runs"
    uploads_dir = tmp_path / "uploads"
    datasets_dir = tmp_path / "datasets"
    status_file = runs_dir / "status.json"
    dataset_root = datasets_dir / "sample"

    write_dataset(dataset_root)

    monkeypatch.setattr(main_module, "RUNS_DIR", runs_dir)
    monkeypatch.setattr(main_module, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(main_module, "DATASETS_DIR", datasets_dir)
    monkeypatch.setattr(main_module, "STATUS_MANAGER", StatusManager(str(status_file)))
    monkeypatch.setattr(main_module, "allowed_dataset_roots", lambda: [datasets_dir.resolve(), uploads_dir.resolve()])
    monkeypatch.setattr(main_module, "AutoMLOrchestrator", FakeOrchestrator)
    monkeypatch.setattr(main_module, "DATASET_ID_COUNTER", make_counter(1))
    monkeypatch.setattr(main_module, "RUN_ID_COUNTER", make_counter(1))

    runs_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    datasets_dir.mkdir(parents=True, exist_ok=True)
    repoint_static_mounts(runs_dir)

    client = TestClient(main_module.app)

    dataset_response = client.post(
        "/api/datasets",
        data={
            "displayName": "Sample Dataset",
            "description": "Synthetic dataset for integration test",
            "numClasses": "1",
            "classNames": "object",
            "datasetSource": "sample",
        },
        files={"datasetFile": ("", b"", "application/octet-stream")},
    )

    assert dataset_response.status_code == 200
    dataset_payload = dataset_response.json()
    assert dataset_payload["id"] == "ds-1"
    assert dataset_payload["yamlReady"] is True

    run_response = client.post(
        "/api/datasets/ds-1/runs",
        json={
            "targetMetric": "mAP@50-95",
            "device": "cpu",
            "searchAlg": "GridSearch",
            "hyperparams": {
                "epochs": {"type": "list", "values": [1]},
                "batchSize": {"type": "list", "values": [2]},
                "imageSize": {"type": "list", "values": [160]},
                "learningRate": {"type": "list", "values": [0.01]},
                "patience": {"type": "list", "values": [1]},
            },
        },
    )

    assert run_response.status_code == 200
    assert run_response.json()["runId"] == "run-1"

    status_response = client.get("/api/status")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "completed"
    assert status_payload["runId"] == "run-1"

    run_detail_response = client.get("/api/runs/run-1")
    assert run_detail_response.status_code == 200
    run_detail = run_detail_response.json()

    assert run_detail["status"] == "finished"
    assert run_detail["summary"]["bestModel"] == "trial_000"
    assert run_detail["summary"]["bestMap"] == 0.67
    assert run_detail["artifacts"]["bestModelUrl"].endswith("/runs/detect/run-1/trial_000/weights/best.pt")
    assert run_detail["artifacts"]["resultsPlotUrl"].endswith("/runs/detect/run-1/trial_000/results.png")

    logs_response = client.get("/api/runs/run-1/logs")
    assert logs_response.status_code == 200
    assert "Training finished" in logs_response.text

    weights_response = client.get(run_detail["artifacts"]["bestModelUrl"])
    assert weights_response.status_code == 200
    assert weights_response.content == b"fake-pt"

    plot_response = client.get(run_detail["artifacts"]["resultsPlotUrl"])
    assert plot_response.status_code == 200
    assert plot_response.content == MINIMAL_PNG


def test_invalid_dataset_path_returns_400(monkeypatch, tmp_path: Path) -> None:
    reset_runtime_state()

    runs_dir = tmp_path / "runs"
    uploads_dir = tmp_path / "uploads"
    datasets_dir = tmp_path / "datasets"
    status_file = runs_dir / "status.json"

    monkeypatch.setattr(main_module, "RUNS_DIR", runs_dir)
    monkeypatch.setattr(main_module, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr(main_module, "DATASETS_DIR", datasets_dir)
    monkeypatch.setattr(main_module, "STATUS_MANAGER", StatusManager(str(status_file)))
    monkeypatch.setattr(main_module, "allowed_dataset_roots", lambda: [datasets_dir.resolve(), uploads_dir.resolve()])
    monkeypatch.setattr(main_module, "DATASET_ID_COUNTER", make_counter(1))

    runs_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    datasets_dir.mkdir(parents=True, exist_ok=True)
    repoint_static_mounts(runs_dir)

    client = TestClient(main_module.app)

    response = client.post(
        "/api/datasets",
        data={
            "displayName": "Broken Dataset",
            "description": "Missing folder",
            "numClasses": "1",
            "classNames": "object",
            "datasetSource": "missing",
        },
        files={"datasetFile": ("", b"", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "Dataset source was not found" in response.text


def test_orchestrator_requires_explicit_training_params(tmp_path: Path) -> None:
    orchestrator = main_module.AutoMLOrchestrator(output_root=tmp_path)

    with pytest.raises(ValueError, match="Missing required training parameter"):
        orchestrator._build_train_params({"data": "dataset.yaml"}, "trial_000")

    config = orchestrator._normalize_config(
        {
            "data": "dataset.yaml",
            "epochs": "1",
            "batchSize": "2",
            "imageSize": "160",
            "learningRate": "0.01",
            "patience": "1",
        }
    )
    train_params = orchestrator._build_train_params(config, "trial_000")

    assert train_params["data"] == "dataset.yaml"
    assert train_params["epochs"] == 1
    assert train_params["batch"] == 2
    assert train_params["imgsz"] == 160
    assert train_params["lr0"] == 0.01
    assert train_params["patience"] == 1
