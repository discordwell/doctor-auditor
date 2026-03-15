import base64
import hashlib
import hmac
import secrets

import bcrypt


PBKDF2_SCHEME = "doctor-auditor-pbkdf2-sha256"
LEGACY_PASSLIB_PBKDF2_SCHEME = "pbkdf2-sha256"
PBKDF2_ITERATIONS = 310_000
PBKDF2_SALT_BYTES = 16
PBKDF2_DERIVED_KEY_BYTES = 32
_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def _ab64_encode(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii").rstrip("=").replace("+", ".")


def _ab64_decode(value: str) -> bytes:
    padded = value.replace(".", "+")
    padded += "=" * (-len(padded) % 4)
    return base64.b64decode(padded)


def _pbkdf2_digest(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
        dklen=PBKDF2_DERIVED_KEY_BYTES,
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(PBKDF2_SALT_BYTES)
    digest = _pbkdf2_digest(password, salt, PBKDF2_ITERATIONS)
    return (
        f"{PBKDF2_SCHEME}${PBKDF2_ITERATIONS}$"
        f"{_ab64_encode(salt)}${_ab64_encode(digest)}"
    )


def _verify_current_pbkdf2(password: str, stored_hash: str) -> tuple[bool, bool]:
    try:
        scheme, iterations_value, salt_value, digest_value = stored_hash.split("$")
    except ValueError:
        return False, False

    if scheme != PBKDF2_SCHEME:
        return False, False

    try:
        iterations = int(iterations_value)
    except ValueError:
        return False, False

    salt = _ab64_decode(salt_value)
    expected_digest = _ab64_decode(digest_value)
    actual_digest = _pbkdf2_digest(password, salt, iterations)
    is_valid = hmac.compare_digest(actual_digest, expected_digest)
    needs_rehash = iterations < PBKDF2_ITERATIONS
    return is_valid, needs_rehash


def _verify_legacy_passlib_pbkdf2(password: str, stored_hash: str) -> bool:
    try:
        _, scheme, iterations_value, salt_value, digest_value = stored_hash.split("$")
    except ValueError:
        return False

    if scheme != LEGACY_PASSLIB_PBKDF2_SCHEME:
        return False

    try:
        iterations = int(iterations_value)
    except ValueError:
        return False

    salt = _ab64_decode(salt_value)
    expected_digest = _ab64_decode(digest_value)
    actual_digest = _pbkdf2_digest(password, salt, iterations)
    return hmac.compare_digest(actual_digest, expected_digest)


def verify_and_rehash_password(
    password: str,
    stored_hash: str,
) -> tuple[bool, str | None]:
    if stored_hash.startswith(f"{PBKDF2_SCHEME}$"):
        is_valid, needs_rehash = _verify_current_pbkdf2(password, stored_hash)
        if not is_valid:
            return False, None
        return True, hash_password(password) if needs_rehash else None

    if stored_hash.startswith(f"${LEGACY_PASSLIB_PBKDF2_SCHEME}$"):
        if not _verify_legacy_passlib_pbkdf2(password, stored_hash):
            return False, None
        return True, hash_password(password)

    if stored_hash.startswith(_BCRYPT_PREFIXES):
        is_valid = bcrypt.checkpw(
            password.encode("utf-8"),
            stored_hash.encode("utf-8"),
        )
        if not is_valid:
            return False, None
        return True, hash_password(password)

    return False, None


def verify_password(password: str, stored_hash: str) -> bool:
    is_valid, _ = verify_and_rehash_password(password, stored_hash)
    return is_valid
