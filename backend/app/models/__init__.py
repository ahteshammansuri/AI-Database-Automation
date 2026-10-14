from datetime import datetime, timezone
import json
from typing import Any, Dict, Optional
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index, Float
)
from sqlalchemy.orm import relationship
from backend.app.database import Base


def utc_now():
    return datetime.now(timezone.utc)


class ConnectionProfile(Base):
    __tablename__ = "connection_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    db_type = Column(String(20), default="mysql", nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(Integer, default=3306, nullable=False)
    database = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    encrypted_password = Column(Text, nullable=False)
    use_ssl = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_tested_at = Column(DateTime, nullable=True)
    last_status = Column(String(50), default="UNTESTED")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    automations = relationship("Automation", back_populates="connection", cascade="all, delete-orphan")


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_type = Column(String(10), nullable=False)  # "md", "txt", "pdf"
    file_size_bytes = Column(Integer, nullable=False)
    chunk_count = Column(Integer, default=0)
    status = Column(String(30), default="PENDING")  # PENDING, INDEXED, FAILED
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)

    chunks = relationship("KnowledgeChunk", back_populates="document", cascade="all, delete-orphan")


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("knowledge_documents.id"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)

    document = relationship("KnowledgeDocument", back_populates="chunks")


class Automation(Base):
    __tablename__ = "automations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    connection_id = Column(Integer, ForeignKey("connection_profiles.id"), nullable=False)
    target_table = Column(String(100), nullable=False)
    operation = Column(String(20), default="INSERT", nullable=False)  # INSERT, UPDATE
    mode = Column(String(30), default="AI_GENERATED", nullable=False)  # AI_GENERATED, MANUAL
    field_mappings_json = Column(Text, nullable=False)  # JSON array of mappings
    ai_config_json = Column(Text, nullable=True)  # JSON of prompt, tone, provider, topic
    schedule_config_json = Column(Text, nullable=False)  # JSON of frequency, times, timezone
    approval_policy_json = Column(Text, nullable=False)  # JSON of reviewer_email, timeout, max_regens
    status = Column(String(20), default="ACTIVE", nullable=False)  # ACTIVE, PAUSED, DISABLED
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    connection = relationship("ConnectionProfile", back_populates="automations")
    executions = relationship("AutomationExecution", back_populates="automation", cascade="all, delete-orphan")


class AutomationExecution(Base):
    __tablename__ = "automation_executions"

    id = Column(Integer, primary_key=True, index=True)
    automation_id = Column(Integer, ForeignKey("automations.id"), nullable=False)
    status = Column(String(30), default="DRAFT", nullable=False)
    # Status: DRAFT, GENERATING, VALIDATING, PENDING_APPROVAL, APPROVED, REJECTED, EXECUTING, PUBLISHED, FAILED, NEEDS_REVIEW
    mode = Column(String(30), default="AI_GENERATED")
    trigger_type = Column(String(30), default="SCHEDULED")  # SCHEDULED, RUN_NOW, MANUAL
    idempotency_key = Column(String(128), unique=True, nullable=False, index=True)
    scheduled_generation_time = Column(DateTime, nullable=True)
    scheduled_publication_time = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    target_record_id = Column(String(100), nullable=True)
    regeneration_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)

    automation = relationship("Automation", back_populates="executions")
    versions = relationship("ContentVersion", back_populates="execution", cascade="all, delete-orphan")
    tokens = relationship("ApprovalToken", back_populates="execution", cascade="all, delete-orphan")


class ContentVersion(Base):
    __tablename__ = "content_versions"

    id = Column(Integer, primary_key=True, index=True)
    execution_id = Column(Integer, ForeignKey("automation_executions.id"), nullable=False)
    automation_id = Column(Integer, ForeignKey("automations.id"), nullable=False)
    version_number = Column(Integer, default=1, nullable=False)
    payload_json = Column(Text, nullable=False)
    status = Column(String(30), default="PENDING_APPROVAL")  # PENDING_APPROVAL, APPROVED, REJECTED, SUPERSEDED, PUBLISHED
    rejection_feedback = Column(Text, nullable=True)
    retrieved_chunks_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)

    execution = relationship("AutomationExecution", back_populates="versions")
    tokens = relationship("ApprovalToken", back_populates="version", cascade="all, delete-orphan")


class ApprovalToken(Base):
    __tablename__ = "approval_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    execution_id = Column(Integer, ForeignKey("automation_executions.id"), nullable=False)
    version_id = Column(Integer, ForeignKey("content_versions.id"), nullable=False)
    action = Column(String(20), nullable=False)  # APPROVE, REJECT
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)

    execution = relationship("AutomationExecution", back_populates="tokens")
    version = relationship("ContentVersion", back_populates="tokens")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(50), nullable=True)
    actor = Column(String(100), default="system")
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now)
