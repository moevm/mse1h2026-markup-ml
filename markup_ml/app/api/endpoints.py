#Task 2.3.2


from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from app.core.orchestrator import run_automl
from app.core.file_manager import StatusManager
from app.core.hyperparameter_search import grid_search_params, random_search_params

router = APIRouter()


class HyperParameterRange(BaseModel):
    epochs: List[int] = Field(default=[10, 20, 30], description="Количество эпох")
    lr0: List[float] = Field(default=[0.01, 0.001, 0.0001], description="Начальная скорость обучения")
    batch: List[int] = Field(default=[8, 16], description="Размер батча")
    imgsz: List[int] = Field(default=[640], description="Размер изображения")
    momentum: Optional[List[float]] = Field(default=[0.937], description="Момент")
    weight_decay: Optional[List[float]] = Field(default=[0.0005], description="Легуляризация")


class AutoMLRequest(BaseModel):
    dataset_path: str = Field(..., description="Путь к data.yaml файлу")
    search_algorithm: str = Field(..., description="grid или random")
    n_iter: Optional[int] = Field(default=10, description="Количество итераций для random search")
    base_model: str = Field(default="yolov8n.pt", description="Базовая модель YOLO")
    hyperparameters: HyperParameterRange = Field(default_factory=HyperParameterRange)
    early_stop_patience: int = Field(default=3, description="Коэффициент для early stopping")
    early_stop_delta: float = Field(default=0.15, description="Дельта для early stopping")


class AutoMLResponse(BaseModel):
    status: str
    message: str
    total_configs: int
    search_algorithm: str


@router.post("/start", response_model=AutoMLResponse)
async def start_automl(request: AutoMLRequest, background_tasks: BackgroundTasks):

    try:
        param_grid = request.hyperparameters.dict(exclude_none=True)

        if request.search_algorithm.lower() == "grid":
            config_list = grid_search_params(param_grid)
            algo_name = "Grid Search"
        elif request.search_algorithm.lower() == "random":
            config_list = random_search_params(param_grid, request.n_iter)
            algo_name = "Random Search"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Ошибка: {request.search_algorithm} используйте 'grid' или 'random'"
            )

        for config in config_list:
            config['data'] = request.dataset_path
            config['early_stop_patience'] = request.early_stop_patience
            config['early_stop_delta'] = request.early_stop_delta

        status_manager = StatusManager()
        status_manager.update_status(
            status="starting",
            total_models=len(config_list),
            current_model=0,
            search_algorithm=algo_name,
            dataset_path=request.dataset_path
        )

        background_tasks.add_task(
            run_automl,
            config_list=config_list,
            base_model=request.base_model
        )

        return AutoMLResponse(
            status="started",
            message=f"AutoML {algo_name} запущен с {len(config_list)} конфигурациями",
            total_configs=len(config_list),
            search_algorithm=algo_name
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_status():
    status_manager = StatusManager()
    return status_manager.read_status()


@router.get("/configs")
async def get_configs(
        algorithm: str = "grid",
        n_iter: int = 10,
        epochs: str = "10,20,30",
        lr0: str = "0.01,0.001",
        batch: str = "8,16"
):

    param_grid = {
        'epochs': [int(x) for x in epochs.split(',')],
        'lr0': [float(x) for x in lr0.split(',')],
        'batch': [int(x) for x in batch.split(',')]
    }

    if algorithm == "grid":
        configs = grid_search_params(param_grid)
    else:
        configs = random_search_params(param_grid, n_iter)

    return {
        "algorithm": algorithm,
        "total_configs": len(configs),
        "configs": configs
    }