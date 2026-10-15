"""Settings, read once from the environment (and a local .env file)."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Identity — rename the assistant here, nowhere else.
ASSISTANT_NAME = os.getenv("ASSISTANT_NAME", "Orion")
USER_NAME = os.getenv("USER_NAME", "")
# How it addresses you when it isn't using your name ("sir", "boss", or empty).
HONORIFIC = os.getenv("HONORIFIC", "sir")

# Brain
MODEL = os.getenv("MODEL", "claude-opus-5-5")
# Voice needs speed. "low" keeps replies quick; raise to "medium"/"high" for deeper answers.
EFFORT = os.getenv("EFFORT", "low")
HISTORY_TURNS = int(os.getenv("HISTORY_TURNS", "20"))

# Security: anyone who can reach the server needs this code.
ACCESS_CODE = os.getenv("ACCESS_CODE", "")

# Optional premium voice (ElevenLabs). Without a key the browser's own voice is used.
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "onwK4e9ZLuTAKqWW03F9")
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")

DB_PATH = Path(os.getenv("DB_PATH", str(ROOT / "data" / "memory.db")))
WEB_DIR = ROOT / "web"
