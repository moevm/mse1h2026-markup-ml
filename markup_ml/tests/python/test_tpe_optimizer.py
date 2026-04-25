import importlib
from pathlib import Path
import sys
import types

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class DummyStatusManager:
    def __init__(self):
        self.updates = []

    def update_status(self, **updates):
        self.updates.append(dict(updates))
        return updates


class FakeTrialPruned(Exception):
    pass


class FakeTrial:
    def __init__(self, number, params, prune_steps=None):
        self.number = number
        self.params = params
        self.prune_steps = set(prune_steps or [])
        self.reported = []
        self.user_attrs = {}
        self._last_step = None

    def suggest_float(self, name, low, high, log=False):
        return float(self.params.get(name, low))

    def suggest_int(self, name, low, high):
        return int(self.params.get(name, low))

    def suggest_categorical(self, name, choices):
        return self.params.get(name, choices[0])

    def report(self, value, step):
        self.reported.append((value, step))
        self._last_step = step

    def should_prune(self):
        return self._last_step in self.prune_steps

    def set_user_attr(self, key, value):
        self.user_attrs[key] = value


class FakeStudy:
    def __init__(self, module):
        self.module = module

    def optimize(self, objective, n_trials, catch=()):
        for trial in self.module.pending_trials[:n_trials]:
            try:
                objective(trial)
            except self.module.exceptions.TrialPruned:
                continue
            except catch:
                continue


class FakeOptunaModule(types.ModuleType):
    def __init__(self, pending_trials):
        super().__init__("optuna")
        self.pending_trials = pending_trials
        self.exceptions = types.SimpleNamespace(TrialPruned=FakeTrialPruned)
        self.samplers = types.SimpleNamespace(TPESampler=lambda **kwargs: {"kind": "tpe", **kwargs})
        self.pruners = types.SimpleNamespace(
            SuccessiveHalvingPruner=lambda **kwargs: {"kind": "asha", **kwargs}
        )

    def create_study(self, **kwargs):
        return FakeStudy(self)


class FakeTrainer:
    def __init__(self):
        self.epoch = 0
        self.metrics = {}
        self.stop = False


class FakeYOLO:
    scenarios = {}
    train_calls = []

    def __init__(self, *args, **kwargs):
        self.callbacks = {}

    def add_callback(self, event_name, callback):
        self.callbacks[event_name] = callback

    def train(self, **kwargs):
        FakeYOLO.train_calls.append(dict(kwargs))
        trial_name = kwargs["name"]
        metrics_history = list(FakeYOLO.scenarios.get(trial_name, []))
        trainer = FakeTrainer()
        callback = self.callbacks.get("on_fit_epoch_end")

        train_dir = Path(kwargs["project"]) / trial_name
        weights_dir = train_dir / "weights"
        weights_dir.mkdir(parents=True, exist_ok=True)

        rows = [
            "epoch,train/box_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)"
        ]
        for epoch, metric in enumerate(metrics_history):
            trainer.epoch = epoch
            trainer.metrics = {
                "metrics/mAP50-95(B)": metric,
                "metrics/mAP50(B)": min(metric + 0.1, 0.99),
                "metrics/precision(B)": min(metric + 0.15, 0.99),
                "metrics/recall(B)": min(metric + 0.12, 0.99),
            }
            if callback is not None:
                callback(trainer)

            rows.append(
                f"{epoch},{max(0.1, 1.0 - metric):.4f},{min(metric + 0.15, 0.99):.4f},"
                f"{min(metric + 0.12, 0.99):.4f},{min(metric + 0.1, 0.99):.4f},{metric:.4f}"
            )
            if trainer.stop:
                break

        (weights_dir / "best.pt").write_bytes(b"fake-best")
        (weights_dir / "last.pt").write_bytes(b"fake-last")
        (train_dir / "results.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")


def load_tpe_optimizer_module(monkeypatch, pending_trials):
    fake_optuna = FakeOptunaModule(pending_trials)
    fake_ultralytics = types.ModuleType("ultralytics")
    fake_ultralytics.YOLO = FakeYOLO

    monkeypatch.setitem(sys.modules, "optuna", fake_optuna)
    monkeypatch.setitem(sys.modules, "ultralytics", fake_ultralytics)

    module_name = "app.core.tpe_optimizer"
    if module_name in sys.modules:
        return importlib.reload(sys.modules[module_name])
    return importlib.import_module(module_name)


def test_objective_reports_map_and_prunes(monkeypatch, tmp_path: Path):
    optimizer_module = load_tpe_optimizer_module(
        monkeypatch,
        pending_trials=[FakeTrial(0, {"epochs": 2, "batch": 8, "imgsz": 640, "lr0": 0.001, "patience": 3}, prune_steps={0})],
    )
    optimizer = optimizer_module.TPEOptimizer(run_id="run-1", output_root=tmp_path)
    optimizer.status_manager = DummyStatusManager()
    optimizer.total_trials = 1
    optimizer._search_space = {
        "epochs": [2],
        "batch": [8],
        "imgsz": [640],
        "lr0": [0.001],
        "patience": [3],
    }
    optimizer._fixed_params = {"data": "dataset.yaml", "device": "cpu"}

    FakeYOLO.scenarios = {"trial_000": [0.15, 0.12]}
    FakeYOLO.train_calls = []
    trial = FakeTrial(
        0,
        {"epochs": 2, "batch": 8, "imgsz": 640, "lr0": 0.001, "patience": 3},
        prune_steps={0},
    )

    with pytest.raises(optimizer_module.optuna.exceptions.TrialPruned):
        optimizer.objective(trial)

    assert trial.reported == [(0.15, 0)]
    assert optimizer.results[0]["status"] == "pruned"
    assert optimizer.results[0]["score"] == 0.15
    assert FakeYOLO.train_calls[0]["device"] == "cpu"


def test_optimize_returns_best_params(monkeypatch, tmp_path: Path):
    pending_trials = [
        FakeTrial(
            0,
            {
                "epochs": 4,
                "batch": 8,
                "imgsz": 640,
                "lr0": 0.001,
                "patience": 3,
                "optimizer": "SGD",
            },
        ),
        FakeTrial(
            1,
            {
                "epochs": 4,
                "batch": 16,
                "imgsz": 640,
                "lr0": 0.005,
                "patience": 3,
                "optimizer": "AdamW",
            },
        ),
    ]

    optimizer_module = load_tpe_optimizer_module(monkeypatch, pending_trials=pending_trials)
    optimizer = optimizer_module.TPEOptimizer(run_id="run-2", output_root=tmp_path)
    optimizer.status_manager = DummyStatusManager()

    FakeYOLO.scenarios = {
        "trial_000": [0.22, 0.31],
        "trial_001": [0.41, 0.65],
    }
    FakeYOLO.train_calls = []

    result = optimizer.optimize(
        search_space={
            "epochs": [4],
            "batch": [8, 16],
            "imgsz": [640],
            "lr0": (0.001, 0.01),
            "patience": [3],
            "optimizer": ["SGD", "AdamW"],
        },
        n_trials=2,
        fixed_params={"data": "dataset.yaml", "device": "cpu"},
    )

    assert len(result["results"]) == 2
    assert [item["status"] for item in result["results"]] == ["completed", "completed"]
    assert pytest.approx(result["best_value"], rel=1e-6) == 0.65
    assert result["best_params"]["optimizer"] == "AdamW"
    assert result["best_params"]["batch"] == 16
    assert result["best_params"]["device"] == "cpu"
    assert FakeYOLO.train_calls[1]["optimizer"] == "AdamW"
