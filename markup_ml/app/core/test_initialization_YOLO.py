from ultralytics import YOLO
from callback import create_early_stopping_callback

model = YOLO("yolov8n.pt")
early_stopping = create_early_stopping_callback()

model.add_callback("on_fit_epoch_end", early_stopping)

results = model.train(
    data='coco128.yaml',
    epochs=25,
    imgsz=640,
    batch=16,
    device='cpu',
)