import base64
import hashlib
import hmac
import secrets
from typing import Optional
from cryptography.fernet import Fernet
from backend.app.config import settings


def _get_fernet_key() -> bytes:
    """Derive a consistent 32-byte urlsafe base64 key from settings.SECRET_KEY."""
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plain_text: str) -> str:
    """Encrypt a secret string (e.g. database password)."""
    if not plain_text:
        return ""
    f = Fernet(_get_fernet_key())
    return f.encrypt(plain_text.encode()).decode()


def decrypt_secret(cipher_text: str) -> str:
    """Decrypt an encrypted secret string."""
    if not cipher_text:
        return ""
    f = Fernet(_get_fernet_key())
    return f.decrypt(cipher_text.encode()).decode()


def mask_secret(secret: Optional[str]) -> str:
    """Return a masked representation for API and display."""
    if not secret:
        return ""
    return "********"


def generate_secure_token() -> str:
    """Generate a high-entropy URL-safe random token string."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash token for persistent database storage (prevent plaintext exposure)."""
    return hashlib.sha256(token.encode()).hexdigest()
