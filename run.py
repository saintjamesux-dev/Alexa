"""One-command launcher: first run sets everything up, every run starts Orion.

    python3 run.py        (Mac / Linux)
    python run.py         (Windows)

Uses only the standard library, so it works before anything is installed.
"""

import getpass
import os
import subprocess
import sys
import threading
import time
import venv
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
ENV_FILE = ROOT / ".env"
PORT = int(os.getenv("PORT", "8000"))
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def say(msg: str) -> None:
    print(f"\n  ◉ {msg}")


def ask(prompt: str, secret: bool = False, default: str = "") -> str:
    label = f"    {prompt}{f' [{default}]' if default else ''}: "
    while True:
        value = (getpass.getpass(label) if secret else input(label)).strip() or default
        if value:
            return value
        print("    (required)")


def write_env() -> None:
    say("First-time setup. This takes a minute and only happens once.")
    print("    Get an API key at https://platform.claude.com (Settings → API keys).")
    print("    Typing is hidden for secret fields. Paste and press Enter.\n")
    key = ask("Claude API key", secret=True)
    code = ask("Choose a passcode for your devices", secret=True)
    name = ask("Your first name")
    city = ask("Your city, for weather in briefings (e.g. Lagos, Nigeria)")
    honorific = ask('How should Orion address you? ("sir", "boss", or "name")', default="sir")
    template = (ROOT / ".env.example").read_text()
    values = {
        "ANTHROPIC_API_KEY": key,
        "ACCESS_CODE": code,
        "USER_NAME": name,
        "HOME_CITY": city,
        "HONORIFIC": "" if honorific.lower() == "name" else honorific,
    }
    lines = []
    for line in template.splitlines():
        k = line.split("=", 1)[0]
        lines.append(f"{k}={values.pop(k)}" if k in values else line)
    lines += [f"{k}={v}" for k, v in values.items()]
    ENV_FILE.write_text("\n".join(lines) + "\n")
    say("Saved your settings to .env. Edit that file any time to change them.")


def install() -> None:
    if not PY.exists():
        say("Creating a private Python environment…")
        venv.create(VENV, with_pip=True)
    stamp = VENV / ".installed"
    reqs = ROOT / "requirements.txt"
    if not stamp.exists() or stamp.stat().st_mtime < reqs.stat().st_mtime:
        say("Installing Orion's parts (first time only)…")
        subprocess.check_call([str(PY), "-m", "pip", "install", "-q", "--upgrade", "pip"])
        subprocess.check_call([str(PY), "-m", "pip", "install", "-q", "-r", str(reqs)])
        stamp.touch()


def main() -> None:
    if sys.version_info < (3, 10):
        sys.exit("Orion needs Python 3.10 or newer. Get it from https://www.python.org/downloads/")
    os.chdir(ROOT)
    if not ENV_FILE.exists():
        write_env()
    install()
    url = f"http://localhost:{PORT}"
    say(f"Orion is starting at {url}  (press Ctrl+C to stop)")
    threading.Thread(target=lambda: (time.sleep(2.5), webbrowser.open(url)), daemon=True).start()
    try:
        subprocess.call([str(PY), "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", str(PORT)])
    except KeyboardInterrupt:
        pass
    say("Orion is offline. Run this again to bring it back.")


if __name__ == "__main__":
    main()
