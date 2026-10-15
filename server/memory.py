"""Long-term memory: the conversation log and the facts it keeps about you."""

import sqlite3
import time
from contextlib import contextmanager

from . import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    ts   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    ts   REAL NOT NULL
);
"""


@contextmanager
def _db():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def add_message(role: str, text: str) -> None:
    with _db() as db:
        db.execute("INSERT INTO messages (role, text, ts) VALUES (?, ?, ?)", (role, text, time.time()))


def recent_messages(turns: int) -> list[dict]:
    """The last `turns` exchanges as API-ready messages, oldest first, starting with a user turn."""
    with _db() as db:
        rows = db.execute(
            "SELECT role, text FROM messages ORDER BY id DESC LIMIT ?", (turns * 2,)
        ).fetchall()
    msgs = [{"role": r["role"], "content": r["text"]} for r in reversed(rows)]
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


def transcript(limit: int = 30) -> list[dict]:
    with _db() as db:
        rows = db.execute(
            "SELECT role, text, ts FROM messages ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def clear_history() -> None:
    with _db() as db:
        db.execute("DELETE FROM messages")


def add_fact(text: str) -> int:
    with _db() as db:
        cur = db.execute("INSERT INTO facts (text, ts) VALUES (?, ?)", (text, time.time()))
        return cur.lastrowid


def list_facts() -> list[dict]:
    with _db() as db:
        return [dict(r) for r in db.execute("SELECT id, text, ts FROM facts ORDER BY id")]


def delete_fact(fact_id: int) -> bool:
    with _db() as db:
        return db.execute("DELETE FROM facts WHERE id = ?", (fact_id,)).rowcount > 0
