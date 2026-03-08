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