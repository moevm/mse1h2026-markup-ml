from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

#Task 1.1.4
# app.mount("/static", StaticFiles(directory="static"), name="static")
# app.mount("/runs", StaticFiles(directory="runs"), name="runs")

#Task 1.1.3
@app.get("/ping")
async def ping():
    return {"status": "ok"}

@app.get("/")
async def root():
    return {
        "message": "AutoML YOLO API is running",
        "docs": "/docs",
        "test_endpoint": "/ping"
    }