"""Test environment setup.

This module is imported by pytest before any test module, so the database
override below is guaranteed to land before `app.config.Settings` is
instantiated by an application import — regardless of which test file is
collected first. Without it, a test module that imports `app.*` ahead of
`test_review_api` would freeze DATABASE_URL from `.env` (or the Postgres
default) and the suite would run against the developer database.
"""

import atexit
import os
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

TEST_DATABASE_DIR = Path(tempfile.mkdtemp(prefix="doctor-auditor-tests-"))
TEST_DATABASE_PATH = TEST_DATABASE_DIR / f"{uuid4().hex}.sqlite3"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DATABASE_PATH}"
atexit.register(shutil.rmtree, TEST_DATABASE_DIR, True)
