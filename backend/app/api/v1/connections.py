from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models import ConnectionProfile, AuditLog
from backend.app.schemas.connection import (
    ConnectionCreate, ConnectionUpdate, ConnectionResponse,
    ConnectionTestRequest, ConnectionTestResponse, SchemaResponse
)
from backend.app.security.encryption import encrypt_secret, decrypt_secret
from backend.app.connectors.mysql import MySQLConnector
from backend.app.security.guardrails import DatabaseSecurityViolation

router = APIRouter(prefix="/connections", tags=["Database Connections"])


def _get_connector_for_profile(profile: ConnectionProfile) -> MySQLConnector:
    plain_password = decrypt_secret(profile.encrypted_password)
    return MySQLConnector(
        host=profile.host,
        port=profile.port,
        database=profile.database,
        username=profile.username,
        password=plain_password,
        use_ssl=profile.use_ssl
    )


@router.get("", response_model=List[ConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    return db.query(ConnectionProfile).order_by(ConnectionProfile.created_at.desc()).all()


@router.post("", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
def create_connection(payload: ConnectionCreate, db: Session = Depends(get_db)):
    encrypted_pwd = encrypt_secret(payload.password)
    profile = ConnectionProfile(
        name=payload.name,
        db_type=payload.db_type,
        host=payload.host,
        port=payload.port,
        database=payload.database,
        username=payload.username,
        encrypted_password=encrypted_pwd,
        use_ssl=payload.use_ssl,
        last_status="UNTESTED"
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    # Log audit
    audit = AuditLog(
        action="CONNECTION_CREATED",
        entity_type="connection_profile",
        entity_id=str(profile.id),
        details_json=f'{{"name": "{profile.name}", "host": "{profile.host}", "db": "{profile.database}"}}'
    )
    db.add(audit)
    db.commit()

    return profile


@router.get("/{connection_id}", response_model=ConnectionResponse)
def get_connection(connection_id: int, db: Session = Depends(get_db)):
    profile = db.query(ConnectionProfile).filter(ConnectionProfile.id == connection_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Connection profile not found")
    return profile


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(connection_id: int, db: Session = Depends(get_db)):
    profile = db.query(ConnectionProfile).filter(ConnectionProfile.id == connection_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Connection profile not found")
    db.delete(profile)
    db.commit()
    return None


@router.post("/test", response_model=ConnectionTestResponse)
def test_ad_hoc_connection(payload: ConnectionTestRequest):
    connector = MySQLConnector(
        host=payload.host,
        port=payload.port,
        database=payload.database,
        username=payload.username,
        password=payload.password,
        use_ssl=payload.use_ssl
    )
    return connector.test_connection()


@router.post("/{connection_id}/test", response_model=ConnectionTestResponse)
def test_saved_connection(connection_id: int, db: Session = Depends(get_db)):
    profile = db.query(ConnectionProfile).filter(ConnectionProfile.id == connection_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Connection profile not found")

    connector = _get_connector_for_profile(profile)
    result = connector.test_connection()

    profile.last_tested_at = datetime.now(timezone.utc)
    profile.last_status = "CONNECTED" if result.success else "FAILED"
    db.commit()

    return result


@router.get("/{connection_id}/schema", response_model=SchemaResponse)
def get_connection_schema(connection_id: int, db: Session = Depends(get_db)):
    profile = db.query(ConnectionProfile).filter(ConnectionProfile.id == connection_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Connection profile not found")

    connector = _get_connector_for_profile(profile)
    try:
        schema = connector.introspect_schema(connection_id=profile.id)
        return schema
    except DatabaseSecurityViolation as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to inspect database schema: {str(e)}")


@router.post("/seed-demo", response_model=ConnectionResponse)
def seed_demo_connection(db: Session = Depends(get_db)):
    """Seed or update the default synthetic demo connection in platform database."""
    existing = db.query(ConnectionProfile).filter(
        ConnectionProfile.database == settings.DEMO_MYSQL_DATABASE
    ).first()

    encrypted_pwd = encrypt_secret(settings.DEMO_MYSQL_PASSWORD)
    if existing:
        existing.name = "Synthetic Demo Blog CMS"
        existing.host = settings.DEMO_MYSQL_HOST
        existing.port = settings.DEMO_MYSQL_PORT
        existing.username = settings.DEMO_MYSQL_USER
        existing.encrypted_password = encrypted_pwd
        existing.last_status = "CONNECTED"
        existing.last_tested_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        return existing

    profile = ConnectionProfile(
        name="Synthetic Demo Blog CMS",
        db_type="mysql",
        host=settings.DEMO_MYSQL_HOST,
        port=settings.DEMO_MYSQL_PORT,
        database=settings.DEMO_MYSQL_DATABASE,
        username=settings.DEMO_MYSQL_USER,
        encrypted_password=encrypted_pwd,
        use_ssl=False,
        last_status="CONNECTED",
        last_tested_at=datetime.now(timezone.utc)
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile
