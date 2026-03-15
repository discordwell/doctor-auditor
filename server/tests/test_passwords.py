import bcrypt

from app.auth.passwords import (
    hash_password,
    verify_and_rehash_password,
    verify_password,
)


LEGACY_PASSLIB_PBKDF2_HASH = (
    "$pbkdf2-sha256$29000$3puTsvYeQ2gNAcCYE4JwLg$"
    "J6fHCX.t1P76ujANSDYcPFzQEOZfCsRT0FsvYnSGDsk"
)


def test_hash_password_round_trip() -> None:
    password_hash = hash_password("demo-reviewer")

    assert password_hash.startswith("doctor-auditor-pbkdf2-sha256$")
    assert verify_password("demo-reviewer", password_hash) is True
    assert verify_password("wrong-password", password_hash) is False


def test_verify_and_rehash_upgrades_legacy_passlib_pbkdf2_hash() -> None:
    is_valid, replacement_hash = verify_and_rehash_password(
        "demo-reviewer",
        LEGACY_PASSLIB_PBKDF2_HASH,
    )

    assert is_valid is True
    assert replacement_hash is not None
    assert replacement_hash.startswith("doctor-auditor-pbkdf2-sha256$")
    assert verify_password("demo-reviewer", replacement_hash) is True


def test_verify_and_rehash_upgrades_legacy_bcrypt_hash() -> None:
    legacy_bcrypt_hash = bcrypt.hashpw(
        b"demo-reviewer",
        bcrypt.gensalt(),
    ).decode("utf-8")

    is_valid, replacement_hash = verify_and_rehash_password(
        "demo-reviewer",
        legacy_bcrypt_hash,
    )

    assert is_valid is True
    assert replacement_hash is not None
    assert replacement_hash.startswith("doctor-auditor-pbkdf2-sha256$")
    assert verify_password("demo-reviewer", replacement_hash) is True
