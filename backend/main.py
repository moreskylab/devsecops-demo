import os
import time
import logging
from typing import Annotated, Generator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Field, create_engine, Session, select
from starlette.concurrency import run_in_threadpool  # Added to offload blocking DDL calls

# --- OPENTELEMETRY & PROFILING IMPORTS ---
from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor


# --- RESOURCE DEFINITION ---
resource = Resource.create({"service.name": "backend", "service.version": "1.0.0"})

# --- PROFILING (Pyroscope Graceful Degradation) ---
try:
    import pyroscope
    PYROSCOPE_AVAILABLE = True
except ImportError:
    PYROSCOPE_AVAILABLE = False

if PYROSCOPE_AVAILABLE:
    pyscope_server = os.getenv("PYROSCOPE_SERVER", "http://alloy:4040")
    pyroscope.configure(
        application_name="backend",
        server_address=pyscope_server,
        enable_logging=True,
    )

# --- TRACING SETUP ---
# --- TRACING SETUP ---
ENABLE_OBSERVABILITY = os.getenv("ENABLE_OBSERVABILITY", "false").lower() == "true"

# Define internal container endpoint targeting our Alloy agent
ALLOY_ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "alloy:4317")

if ENABLE_OBSERVABILITY:
    # Explicitly direct endpoints to the Alloy collector
    trace_exporter = OTLPSpanExporter(endpoint=ALLOY_ENDPOINT, insecure=True)
    metric_exporter = OTLPMetricExporter(endpoint=ALLOY_ENDPOINT, insecure=True)
    log_exporter = OTLPLogExporter(endpoint=ALLOY_ENDPOINT, insecure=True)
else:
    from opentelemetry.sdk.trace.export import ConsoleSpanExporter
    from opentelemetry.sdk.metrics.export import ConsoleMetricExporter
    trace_exporter = ConsoleSpanExporter()
    metric_exporter = ConsoleMetricExporter()
    log_exporter = None 


trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
trace.set_tracer_provider(trace_provider)
tracer = trace.get_tracer(__name__)

# --- METRICS SETUP ---
metric_reader = PeriodicExportingMetricReader(metric_exporter)
meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
metrics.set_meter_provider(meter_provider)
meter = metrics.get_meter(__name__)

items_created_counter = meter.create_counter(
    name="items_created_total",
    description="Total number of items successfully created",
)

# --- LOGGING SETUP ---
logger_provider = LoggerProvider(resource=resource)
if log_exporter:
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
set_logger_provider(logger_provider)

# Use LoggingInstrumentor to handle standard logging injection cleanly [1]
LoggingInstrumentor().instrument(set_logging_format=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cloud_native_backend")

# --- DATABASE CONFIGURATION ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:8000")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL, 
    echo=False, 
    pool_pre_ping=True, 
    connect_args=connect_args
)

SQLAlchemyInstrumentor().instrument(
    engine=engine,
    enable_commenter=True,
    commenter_options={}
)

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
    logger.info("Initializing database and tables...")
    
    # ✅ FIXED: Avoid contextvar crash by moving synchronous DDL initialization to a worker thread
    await run_in_threadpool(SQLModel.metadata.create_all, engine)
    
    yield
    logger.info("Application shutting down. Flushing telemetry data...")
    trace_provider.force_flush()
    meter_provider.force_flush()
    logger_provider.force_flush()

# --- FASTAPI INITIALIZATION ---
app = FastAPI(
    title="Cloud-Native SQLModel CRUD Backend",
    version="1.0.0",
    lifespan=lifespan
)

FastAPIInstrumentor.instrument_app(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["traceparent", "tracestate"]
)

def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_db)]

# --- KUBERNETES COMPLIANCE PROBES ---
@app.get("/healthz", status_code=status.HTTP_200_OK, tags=["Probes"])
async def liveness_probe() -> dict[str, str]:
    return {"status": "alive"}

# FIXED: Removed 'async' keyword to keep database call thread-safe and non-blocking
@app.get("/readyz", status_code=status.HTTP_200_OK, tags=["Probes"])
def readiness_probe(db: SessionDep) -> dict[str, str]:
    try:
        db.exec(select(1)).first()
        return {"status": "ready"}
    except Exception as e:
        logger.error(f"Readiness probe failed database check: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, 
            detail="Database unavailable"
        )

# --- CRUD API ENDPOINTS ---
@app.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED, tags=["Items"])
def create_item(item: ItemCreate, db: SessionDep):
    db_item = Item.model_validate(item)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    
    items_created_counter.add(1, {"item.title": db_item.title})
    logger.info(f"Successfully created new item with ID: {db_item.id}")
    
    return db_item

@app.get("/items", response_model=list[ItemResponse], tags=["Items"])
def read_items(db: SessionDep):
    with tracer.start_as_current_span("fetch_all_items_from_db") as span:
        items = db.exec(select(Item)).all()
        span.set_attribute("items.count", len(items))
        return items

@app.put("/items/{item_id}", response_model=ItemResponse, tags=["Items"])
def update_item(item_id: int, updated_item: ItemCreate, db: SessionDep):
    db_item = db.get(Item, item_id)
    if not db_item:
        logger.warning(f"Update failed. Item {item_id} not found.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        
    updated_data = updated_item.model_dump(exclude_unset=True)
    db_item.sqlmodel_update(updated_data)
        
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

# FIXED: Completed the truncated endpoint logic
@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Items"])
def delete_item(item_id: int, db: SessionDep):
    db_item = db.get(Item, item_id)
    if not db_item:
        logger.warning(f"Delete failed. Item {item_id} not found.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    
    db.delete(db_item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
