from __future__ import annotations

from collections import deque
from typing import Any, Optional


def _to_float(value: Any) -> Optional[float]:
    """Best-effort conversion for Ultralytics scalar/tensor/list loss values."""
    if value is None:
        return None

    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "item"):
        try:
            return float(value.item())
        except (TypeError, ValueError, RuntimeError):
            pass

    if isinstance(value, (list, tuple)):
        converted = [_to_float(item) for item in value]
        converted = [item for item in converted if item is not None]
        if not converted:
            return None
        return sum(converted) / len(converted)

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_loss(trainer: Any) -> Optional[float]:
    """Reads the most common loss fields exposed by Ultralytics trainers."""
    for attr_name in ("loss", "tloss"):
        loss = _to_float(getattr(trainer, attr_name, None))
        if loss is not None:
            return loss

    metrics = getattr(trainer, "metrics", None)
    if isinstance(metrics, dict):
        for key in ("train/box_loss", "val/box_loss", "loss"):
            loss = _to_float(metrics.get(key))
            if loss is not None:
                return loss

    return None


class EarlyStopping:
    """
    Lightweight safety callback for YOLO training.

    Ultralytics already has a built-in `patience` argument. This callback is an
    additional guard that stops training when the current loss grows too much
    compared with the recent loss window. It never raises if the trainer object
    does not expose a loss value.
    """

    def __init__(self, patience: int = 3, min_delta: float = 0.15, min_epochs: int = 3):
        self.patience = max(1, int(patience))
        self.min_delta = max(0.0, float(min_delta))
        self.min_epochs = max(0, int(min_epochs))
        self.loss_history: deque[float] = deque(maxlen=self.patience)
        self.best_loss = float("inf")
        self.best_epoch = 0

    def __call__(self, trainer: Any) -> None:
        epoch = int(getattr(trainer, "epoch", 0) or 0)
        loss = _extract_loss(trainer)

        if loss is None:
            print(f"Epoch: {epoch}, loss is not available; early-stopping callback skipped")
            return

        print(f"Epoch: {epoch}, Loss: {loss:.6f}")

        if loss < self.best_loss:
            self.best_loss = loss
            self.best_epoch = epoch
            print(f"   New best loss = {loss:.6f}")
        else:
            print(f"   Best loss so far = {self.best_loss:.6f} at epoch {self.best_epoch}")

        self._check_early_stopping(trainer, epoch, loss)
        self.loss_history.append(loss)

    def _check_early_stopping(self, trainer: Any, epoch: int, loss: float) -> None:
        if epoch < self.min_epochs:
            return
        if len(self.loss_history) < self.patience:
            return

        recent_losses = list(self.loss_history)
        min_recent = min(recent_losses)
        threshold = min_recent * (1 + self.min_delta)

        if loss > threshold:
            print(
                f"Early stopping at epoch {epoch}: "
                f"loss {loss:.6f} > threshold {threshold:.6f}"
            )
            trainer.stop = True
        else:
            print(f"Training continues: loss {loss:.6f} <= threshold {threshold:.6f}")


def create_early_stopping_callback(
    patience: int = 3,
    min_delta: float = 0.15,
    min_epochs: int = 3,
) -> EarlyStopping:
    return EarlyStopping(patience=patience, min_delta=min_delta, min_epochs=min_epochs)
