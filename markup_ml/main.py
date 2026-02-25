from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

app = FastAPI(
    title="AutoML YOLO API",
    description="API для автоматического подбора гиперпараметров YOLO",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
async def ping():
    return {"status": "ok"}


app.mount("/", StaticFiles(directory="static", html=True), name="static")

