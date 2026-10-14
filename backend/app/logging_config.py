import logging
import re
from typing import Any
from backend.app.config import settings

# Patterns for sensitive keys and credentials to redact
SENSITIVE_PATTERNS = [
    re.compile(r"(password|pwd|secret|api[_-]?key|token|auth|bearer)[\"']?\s*[:=]\s*[\"']?([^\"',\s]+)", re.IGNORECASE),
    re.compile(r"(mysql://[^:]+:)([^@]+)(@)", re.IGNORECASE),
    re.compile(r"(postgresql://[^:]+:)([^@]+)(@)", re.IGNORECASE),
]


class SensitiveDataRedactor(logging.Filter):
    """Filter that intercepts and redacts credentials, passwords, and tokens from logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.redact_string(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: self.redact_value(v) for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple(self.redact_value(arg) for arg in record.args)
        return True

    @classmethod
    def redact_string(cls, text: str) -> str:
        redacted = text
        for pattern in SENSITIVE_PATTERNS:
            if pattern.groups == 3:  # Database URI pattern
                redacted = pattern.sub(r"\1********\3", redacted)
            else:  # Key-value pattern
                redacted = pattern.sub(r"\1=********", redacted)
        return redacted

    @classmethod
    def redact_value(cls, val: Any) -> Any:
        if isinstance(val, str):
            return cls.redact_string(val)
        return val


def setup_logging():
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logger = logging.getLogger()
    logger.setLevel(log_level)

    # Clear existing handlers to prevent duplicate formatting
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s:%(lineno)d]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    console_handler.setFormatter(formatter)
    console_handler.addFilter(SensitiveDataRedactor())
    logger.addHandler(console_handler)

    # Silence verbose 3rd party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    return logger
