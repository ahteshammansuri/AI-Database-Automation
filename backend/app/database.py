from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from backend.app.config import settings

# Engine configuration with sqlite connection optimizations
connect_args = {}
if settings.PLATFORM_DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.PLATFORM_DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True
)

# Enable foreign keys and WAL mode for SQLite
if settings.PLATFORM_DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI database dependency yields isolated session per request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_platform_db():
    """Create platform database tables if they do not exist."""
    Base.metadata.create_all(bind=engine)
