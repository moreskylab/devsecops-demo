import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from typing import List

# 1. Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 2. Database Model
class DBItem(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    description = Column(String, nullable=True)

# Create tables automatically on startup
Base.metadata.create_all(bind=engine)

# 3. Pydantic Schemas for Validation
class ItemBase(BaseModel):
    title: str
    description: str | None = None

class ItemCreate(ItemBase):
    pass

class ItemResponse(ItemBase):
    id: int

    class Config:
        from_attributes = True

# 4. FastAPI Initialization
app = FastAPI(title="Vanilla-TS CRUD Backend")

# Enable CORS for the Vanilla TS frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],  # Adjust this to match your frontend dev server domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency to get DB Session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 5. CRUD API Endpoints

@app.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(item: ItemCreate, db: Session = Depends(get_db)):
    db_item = DBItem(title=item.title, description=item.description)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@app.get("/items", response_model=List[ItemResponse])
def read_items(db: Session = Depends(get_db)):
    return db.query(DBItem).all()

@app.put("/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, updated_item: ItemCreate, db: Session = Depends(get_db)):
    db_item = db.query(DBItem).filter(DBItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    db_item.title = updated_item.title
    db_item.description = updated_item.description
    db.commit()
    db.refresh(db_item)
    return db_item

@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(DBItem).filter(DBItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(db_item)
    db.commit()
    return None
