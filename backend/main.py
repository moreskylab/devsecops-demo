import os
import time
import logging
from typing import Annotated, Generator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Field, create_engine, Session, select

# --- CLOUD OBSERVABILITY & LOGGING ---
logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "message": "%(message)s"}'
)
logger = logging.getLogger("cloud_native_sqlmodel_app")

# --- DATABASE CONFIGURATION ---
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")

# pool_pre_ping=True is essential in cloud-native deployments to verify connection health
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)

# --- SQLMODEL DEFINITIONS ---
class ItemBase(SQLModel):
    title: str = Field(index=True)
    description: str | None = Field(default=None)

class Item(ItemBase, table=True):
    __tablename__: str = "items" # type: ignore
    id: int | None = Field(default=None, primary_key=True, index=True)

class ItemCreate(ItemBase):
    pass

class ItemResponse(ItemBase):
    id: int

# --- LIFESPAN MANAGEMENT ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    logger.info("Initializing database and tables...")
    SQLModel.metadata.create_all(engine)
    yield
    # Shutdown tasks (e.g., closing engine connections cleanly)
    logger.info("Application shutting down...")

# --- FASTAPI INITIALIZATION ---
app = FastAPI(
    title="Cloud-Native SQLModel CRUD Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Enable CORS 
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cloud request-response tracking middleware
@app.middleware("http")
async def track_traffic_metrics(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    logger.info(f"path={request.url.path} method={request.method} duration={duration:.4f}s status={response.status_code}")
    response.headers["X-Process-Time"] = str(duration)
    return response

# Dependency to get DB Session per request
def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

# Modern FastAPI dependency injection pattern
SessionDep = Annotated[Session, Depends(get_db)]

# --- KUBERNETES COMPLIANCE PROBES ---

@app.get("/healthz", status_code=status.HTTP_200_OK, tags=["Kubernetes Probes"])
async def liveness_probe() -> dict[str, str]:
    """Tells Kubernetes if the container is alive."""
    return {"status": "alive"}

@app.get("/readyz", status_code=status.HTTP_200_OK, tags=["Kubernetes Probes"])
async def readiness_probe(db: SessionDep) -> dict[str, str]:
    """Tells Kubernetes if the app can handle traffic by verifying DB connectivity."""
    try:
        db.exec(select(1)).first()
        return {"status": "ready"}
    except Exception as e:
        logger.error(f"Readiness probe failed database check: {str(e)}")
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

@app.get("/startupz", status_code=status.HTTP_200_OK, tags=["Kubernetes Probes"])
async def startup_probe() -> dict[str, str]:
    """Tells Kubernetes if the heavy initialization tasks are complete."""
    return {"status": "started"}

# --- CRUD API ENDPOINTS ---

@app.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED, tags=["Items"])
def create_item(item: ItemCreate, db: SessionDep):
    db_item = Item.model_validate(item)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@app.get("/items", response_model=list[ItemResponse], tags=["Items"])
def read_items(db: SessionDep):
    return db.exec(select(Item)).all()

@app.put("/items/{item_id}", response_model=ItemResponse, tags=["Items"])
def update_item(item_id: int, updated_item: ItemCreate, db: SessionDep):
    db_item = db.get(Item, item_id)
    if not db_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        
    # Merge updated data fields efficiently using SQLModel's built-in update method
    updated_data = updated_item.model_dump(exclude_unset=True)
    db_item.sqlmodel_update(updated_data)
        
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Items"])
def delete_item(item_id: int, db: SessionDep):
    db_item = db.get(Item, item_id)
    if not db_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        
    db.delete(db_item)
    db.commit()
    return None