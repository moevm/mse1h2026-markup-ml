# AutoML YOLO API

**Сервис для автоматического подбора гиперпараметров моделей YOLO** с удобным веб-интерфейсом, запуском экспериментов и сохранением всех результатов (веса, графики, метрики).

## 🚀 Quick Start

```bash
git clone git@github.com:moevm/mse1h2026-markup-ml.git
cd markup_ml
# Запуск через Docker с GPU
docker compose up --build -d
```

Сервис сразу доступен: **[http://localhost:8000](http://localhost:8000)**

---

## Назначение проекта

Проект —  **AutoML-сервис** для моделей Ultralytics YOLO:

- Автоматический поиск лучших гиперпараметров (Grid Search + Random Search)
- Запуск обучения и сохранение результатов
- Отдача готового фронтенда (SPA)
- Доступ к результатам экспериментов по HTTP

**Основные папки:**

- `runs/` — все эксперименты (графики, `.pt`-веса, логи)
- `static/` — фронтенд (HTML + CSS + JS)
- `app/` — бизнес-логика поиска гиперпараметров

---

## Структура проекта

```text
markup_ml/
├── app/                              # Серверная часть и ML-ядро
│   ├── api/                          # Маршрутизаторы FastAPI
│   │   └── .gitkeep                  
│   └── core/                         # Бизнес-логика платформы
│       ├── .gitkeep                  
│       ├── hyperparameter_search.py  # Скрипт алгоритма Grid Search (Задача 2.1.1)
│       └── random_search_combinations.py # Скрипт алгоритма Random Search (Задача 2.1.2)
│
├── runs/                             # Директория для артефактов YOLO
│   └── detect/                       
│       └── .gitkeep                  
│
├── static/                           # Автономный фронтенд
│   ├── assets/                       # Статические медиа-файлы и заглушки моделей
│   │   ├── dummy.pt                  # Тестовый вес модели для проверки скачивания
│   │   └── test_chart.png            # Тестовый график для визуализации
│   ├── mocks/                        # Локальные заглушки для симуляции ответов сервера
│   │   ├── dummy_logs.txt            # Фейковые логи для парсинга на фронте
│   │   └── dummy_status.json         # Фейковый статус обучения
│   ├── app.js                        # Главный JS-скрипт (логика UI)
│   ├── index.html                    # Главная страница платформы
│   └── style.css                     # Таблицы стилей
│
├── tests/                            # Директория с тестами
│   └── js/                           # Unit-тесты для фронтенда (Jest)
│       ├── formToJson.test.js        # Тест функции сбора данных из формы
│       ├── logsPolling.test.js       # Тест функции интервального опроса логов
│       ├── mockStartTraining.test.js # Тест симуляции отправки формы
│       ├── jest.config.cjs           # Конфигурация тестового фреймворка Jest
│       └── package.json              # Зависимости Node.js (для запуска тестов)
│
├── docker-compose.yml                # Файл оркестрации контейнеров
├── Dockerfile                        # Инструкция сборки образа приложения
├── main.py                           # Точка входа FastAPI
├── requirements.txt                  # Зависимости Python
└── status.json                       # Глобальный файл состояния обучения
```

---

## Требования

### Обязательно для основного запуска

- **Docker** + **Docker Compose**
- **NVIDIA GPU** + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) (для использования всех GPU)

### Для локальной разработки (опционально)

- Python 3.10+
- Git

---

## Способы запуска

### 1. Docker + GPU (рекомендуется для всех)

```bash
# Сборка и запуск в фоне
docker compose up --build -d

# Перезапуск после изменений кода
docker compose restart

# Полная остановка
docker compose down
```

### 2. Локальный запуск (только для разработки)

```bash
cd markup_ml

# Виртуальное окружение
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## Проверка после запуска

Откройте в браузере:

- **Главная страница фронтенда**: [http://localhost:8000](http://localhost:8000)
- **Swagger-документация**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Пинг**:  

  ```bash
  curl http://localhost:8000/ping
  ```

  Ответ: `{"status": "ok"}`

**Результаты экспериментов** доступны по URL:

- `http://localhost:8000/runs/detect/exp1/best.pt`
- `http://localhost:8000/runs/detect/exp1/results.png`

---

## Работа с результатами (`runs/`)

- Папка `runs/` монтируется как volume → все данные сохраняются на хосте
- Доступ только на чтение через HTTP
- Структура результатов соответствует Ultralytics YOLO (папки `detect/`, `train/` и т.д.)
- Если папки нет — создайте её вручную: `mkdir -p runs`

---

## Сборка / обновление фронтенда

1. Соберите фронтенд в папку `dist` или `build` (в отдельном репозитории)
2. Скопируйте всё содержимое в `./static/`
3. Перезапустите сервис:

   ```bash
   docker compose restart
   ```

---

## Дополнительно

- **Статус задач** хранится в `status.json` (монтируется для сохранения между перезапусками)
- **Тесты фронтенда**: `tests/js/` (Jest)
- **Production-рекомендации**:
  - Используйте `restart: unless-stopped` (уже настроено)
  - Для нескольких GPU можно изменить `count: all` в `docker-compose.yml`

---

**Проект готов к использованию и дальнейшему развитию.**

Вопросы, баги, предложения — создавайте Issue или Pull Request.

**Авторы:** команда MSE1H2026
**Версия:** 1.0.0
