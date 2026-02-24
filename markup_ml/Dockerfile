# Используем официальный образ PyTorch с поддержкой CUDA для инференса YOLO
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файл с базовыми зависимостями проекта
COPY requirements.txt .

# Устанавливаем зависимости (fastapi, uvicorn, ultralytics, pyyaml)
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь исходный код в контейнер
COPY . .

# Открываем порт для FastAPI
EXPOSE 8000

# Точка входа приложения
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]