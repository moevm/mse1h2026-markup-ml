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






'''
# Task 2.2.2 and Task 2.2.3

from collections import deque

def on_fit_epoch_end(trainer):
    # Каркас для Early Stopping (2.2.2)
    epoch = trainer.epoch
    loss = trainer.loss
    print(f"Epoch: {epoch}, Loss: {loss}")

class EarlyStopping:
    patience = 3
    min_delta = 0.15
    min_epochs = 20

    def __init__(self):
        self.loss_history = deque(maxlen=EarlyStopping.patience)
        self.best_loss = float('inf')
        self.best_epoch = 0

    def __call__(self, trainer):
        epoch = trainer.epoch
        loss = trainer.loss

        on_fit_epoch_end(trainer)

        #опционально
        if loss < self.best_loss:
            self.best_loss = loss
            self.best_epoch = epoch
            print(f"   (новый минимум loss = {loss:.4f})")
        else:
            print(f"   (лучший: {self.best_loss:.4f})")

        self.check_early_stopping(trainer, loss)
        self.loss_history.append(loss)

    def check_early_stopping(self, trainer, loss):
        epoch = trainer.epoch
        if epoch <= EarlyStopping.min_epochs:
            return
        if len(self.loss_history) < EarlyStopping.patience:
            return

        recent_losses = list(self.loss_history)
        min_recent = min(recent_losses)
        threshold = min_recent * (1 + EarlyStopping.min_delta)
        if loss > threshold:
            print(f"\nОстанов на эпохе {epoch}!")
            print(f"Loss вырос на >{EarlyStopping.min_delta*100}% от минимума за последние {EarlyStopping.patience} эпох: {loss:.4f} > {threshold:.4f}")
            print(f"Минимум за последние 3: {min_recent:.4f}")
            trainer.stop = True
        else:
            print(f"Обучение продолжается (loss: {loss:.4f} <= порог: {threshold:.4f})")

    @classmethod
    def set_parameters(cls, patience: int = None, min_delta: float = None, min_epochs: int = None):
        if patience is not None:
            cls.patience = patience
        if min_delta is not None:
            cls.min_delta = min_delta
        if min_epochs is not None:
            cls.min_epochs = min_epochs
        print(f"Параметры обновлены: patience={cls.patience}, min_delta={cls.min_delta}, min_epochs={cls.min_epochs}")

def create_early_stopping_callback():
    return EarlyStopping()

'''



'''
# Task 2.2.2 and Task 2.2.3

from collections import deque

def on_fit_epoch_end(trainer):
    # Каркас для Early Stopping (2.2.2)
    epoch = trainer.epoch
    loss = trainer.loss
    print(f"Epoch: {epoch}, Loss: {loss}")

class EarlyStopping:
    patience = 3
    min_delta = 0.15
    min_epochs = 20

    def __init__(self):
        self.loss_history = deque(maxlen=EarlyStopping.patience)
        self.best_loss = float('inf')
        self.best_epoch = 0

    def __call__(self, trainer):
        epoch = trainer.epoch
        loss = trainer.loss

        on_fit_epoch_end(trainer)

        #опционально
        if loss < self.best_loss:
            self.best_loss = loss
            self.best_epoch = epoch
            print(f"   (новый минимум loss = {loss:.4f})")
        else:
            print(f"   (лучший: {self.best_loss:.4f})")

        self.check_early_stopping(trainer, loss)
        self.loss_history.append(loss)

    def check_early_stopping(self, trainer, loss):
        epoch = trainer.epoch
        if epoch <= EarlyStopping.min_epochs:
            return
        if len(self.loss_history) < EarlyStopping.patience:
            return

        recent_losses = list(self.loss_history)
        min_recent = min(recent_losses)
        threshold = min_recent * (1 + EarlyStopping.min_delta)
        if loss > threshold:
            print(f"\nОстанов на эпохе {epoch}!")
            print(f"Loss вырос на >{EarlyStopping.min_delta*100}% от минимума за последние {EarlyStopping.patience} эпох: {loss:.4f} > {threshold:.4f}")
            print(f"Минимум за последние 3: {min_recent:.4f}")
            trainer.stop = True
        else:
            print(f"Обучение продолжается (loss: {loss:.4f} <= порог: {threshold:.4f})")

    @classmethod
    def set_parameters(cls, patience: int = None, min_delta: float = None, min_epochs: int = None):
        if patience is not None:
            cls.patience = patience
        if min_delta is not None:
            cls.min_delta = min_delta
        if min_epochs is not None:
            cls.min_epochs = min_epochs
        print(f"Параметры обновлены: patience={cls.patience}, min_delta={cls.min_delta}, min_epochs={cls.min_epochs}")

def create_early_stopping_callback():
    return EarlyStopping()

# Просто пример работы
if __name__ == "__main__":

    class MockTrainer:
        def __init__(self):
            self.epoch = 0
            self.loss = 0
            self.stop = False

    # пример для фронта
    EarlyStopping.set_parameters(patience=3, min_delta=0.15, min_epochs=5)

    trainer = MockTrainer()
    early_stopping = EarlyStopping()

    losses = [2.0, 1.8, 1.5, 1.3, 1.1, 1.0, 0.9, 0.8, 0.75, 0.7]

    for epoch, loss in enumerate(losses, start=1):  # Эпохи с 1
        trainer.epoch = epoch
        trainer.loss = loss
        early_stopping(trainer)

        if trainer.stop:
            print(f"Остановлено на эпохе {epoch}")
            break

    if not trainer.stop:
        print("Обучение завершилось без ранней остановки")

    print("\nОстанов (loss вырос >15% от min предыдущих 3)")
    trainer = MockTrainer()
    early_stopping = EarlyStopping()

    losses = [2.0, 1.8, 1.5, 1.3, 1.2, 1.05, 0.95, 0.90, 0.85, 1.20]

    for epoch, loss in enumerate(losses, start=1):
        trainer.epoch = epoch
        trainer.loss = loss
        early_stopping(trainer)

        if trainer.stop:
            print(f"Остановлено на эпохе {epoch}")
            break

    # Пример изменения параметров
    EarlyStopping.set_parameters(min_epochs=20)  # Возврат к дефолту

    print("\n: 2.2.2")
    trainer.epoch = 10
    trainer.loss = 1.234
    on_fit_epoch_end(trainer)
'''
'''
import numpy as np
from collections import deque

class EarlyStopping:

    def __init__(self, patience: int = 3, min_delta: float = 0.15, min_epochs: int = 20):
        self.patience = patience
        self.min_delta = min_delta
        self.min_epochs = min_epochs
        self.loss_history = deque(maxlen=patience)
        self.best_loss = float('inf')
        self.best_epoch = 0

    def __call__(self, trainer):

        epoch = trainer.epoch
        loss = trainer.loss
        self.loss_history.append(loss)

        if loss < self.best_loss:
            self.best_loss = loss
            self.best_epoch = epoch
            print(f"Эпоха {epoch}: новый минимум loss = {loss:.4f}")
        else:
            print(f"Эпоха {epoch}: loss = {loss:.4f} (лучший: {self.best_loss:.4f})")

        self.check_early_stopping(trainer)

    def check_early_stopping(self, trainer):
        epoch = trainer.epoch
        if epoch < self.min_epochs:
            return
        if len(self.loss_history) < self.patience:
            return
        recent_losses = list(self.loss_history)
        avg_recent_loss = np.mean(recent_losses)
        threshold = self.best_loss * (1 + self.min_delta)

        if avg_recent_loss > threshold:
            print(f"\nОстановка на эпохе {epoch}!")
            print(f"Средний loss за последние {self.patience} эпох: {avg_recent_loss:.4f}")
            print(f"Лучший loss: {self.best_loss:.4f} (порог: {threshold:.4f})")
            trainer.stop = True
        else:
            print(f"Обучение продолжается (avg loss: {avg_recent_loss:.4f} < порог: {threshold:.4f})")


def simple_callback(trainer):
    epoch = trainer.epoch
    loss = trainer.loss
    print(f"Эпоха: {epoch}, Loss: {loss}")


def create_early_stopping_callback(patience: int = 3, min_delta: float = 0.15, min_epochs: int = 20):
    return EarlyStopping(patience, min_delta, min_epochs)


#просто пример работы
if __name__ == "__main__":

    class MockTrainer:
        def __init__(self):
            self.epoch = 0
            self.loss = 0
            self.stop = False


    print("\n1")
    trainer = MockTrainer()
    early_stopping = EarlyStopping(patience=3, min_delta=0.15, min_epochs=5)

    losses = [2.0, 1.8, 1.5, 1.3, 1.1, 1.0, 0.9, 0.8, 0.75, 0.7]

    for epoch, loss in enumerate(losses):
        trainer.epoch = epoch
        trainer.loss = loss
        early_stopping(trainer)

        if trainer.stop:
            print(f"Остановлено на эпохе {epoch}")
            break

    if not trainer.stop:
        print("Обучение завершилось без ранней остановки")


    print("\n2")
    trainer = MockTrainer()
    early_stopping = EarlyStopping(patience=3, min_delta=0.15, min_epochs=5)

    losses = [2.0, 1.8, 1.5, 1.3, 1.2, 1.4, 1.6, 1.5, 1.7, 1.8]

    for epoch, loss in enumerate(losses):
        trainer.epoch = epoch
        trainer.loss = loss
        early_stopping(trainer)

        if trainer.stop:
            print(f"Остановлено на эпохе {epoch}")
            break

    print("\n3")
    trainer.epoch = 10
    trainer.loss = 1.234
    simple_callback(trainer)
'''