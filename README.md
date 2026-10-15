# Kairos

A personal, voice-first AI assistant in the spirit of JARVIS. It's built for one person: a product and UI/UX designer building his future. It runs on your **phone and laptop** from the same server, talks back in a deep voice, searches the web for current events, remembers what matters about you, and critiques design screenshots you send it.

> The name is a placeholder you can change. Set `ASSISTANT_NAME` in `.env` and everything (title, app icon label, how it introduces itself) follows.

## What it does

- **Voice first.** Tap the orb (or press Space on a laptop) and talk. It streams its reply and starts speaking after the first sentence, so there's no long pause.
- **Hands-free mode.** It listens again after every reply, so you can hold a real back-and-forth conversation.
- **Barge in.** Tap while it's talking to cut it off and speak.
- **Text when you want it.** Tap "Type" for a chat view with markdown and image attachments.
- **Current events.** It uses live web search instead of guessing.
- **Long-term memory.** It quietly saves durable facts (goals, projects, deadlines, people). You can see and delete them in Settings.
- **Design partner.** Attach a screenshot in text mode and ask for critique.
- **Personality.** Calm, dry wit, honest pushback. It's a JARVIS, not a yes-man. Edit `server/persona.py` to shape it.

## How it's built

```
phone / laptop browser  ──►  FastAPI server (your laptop or a cloud box)  ──►  Claude API
  speech-to-text (browser)      persona + memory (SQLite)                     + web search
  text-to-speech (browser       streams reply as events
   or ElevenLabs via server)
```

- `server/persona.py` defines who it is. **This is the file to tweak.**
- `server/brain.py` is the Claude loop: streaming, web search and memory tools.
- `server/memory.py` holds the conversation log and saved facts (SQLite in `data/`).
- `server/app.py` is the API and serves the web app.
- `web/` is the app itself (orb, voice, text mode, settings). It can be installed to your home screen.

## Setup

You need Python 3.10+ and a Claude API key from [platform.claude.com](https://platform.claude.com).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in ANTHROPIC_API_KEY, ACCESS_CODE, USER_NAME
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 on the laptop, enter your access code, and tap the orb.

## Using it on your phone

Browsers only allow microphone access over **HTTPS**, so a plain `http://192.168.x.x` address won't hear you. Two good options:

1. **Tailscale (recommended, free, private).** Install [Tailscale](https://tailscale.com) on your laptop and phone, then run `tailscale serve 8000` on the laptop. Your phone gets an `https://…ts.net` address that only your own devices can reach. The catch: the laptop has to be on.
2. **Host it in the cloud** (Railway, Render or Fly.io) so it's always on. Set the same `.env` values as environment variables there, and give it a persistent disk for `data/` so it keeps its memory.

On the phone, open the address and choose **Add to Home Screen**. It then launches full-screen like an app.

Browser support for voice input: Chrome (Android, desktop) and Safari (iPhone, Mac) work. Firefox has no speech recognition, so it falls back to text. On some iOS versions, voice input works in Safari but not from the home-screen app. If the mic does nothing there, use it in a Safari tab.

## The voice

- **Free:** it uses your device's best built-in male voice (it looks for "Daniel", the British one on Apple devices, first). Change the voice, pitch and speed in Settings.
- **Cinematic:** add an `ELEVENLABS_API_KEY` to `.env`. The default voice ID is a deep British male. Browse the ElevenLabs Voice Library and paste any voice ID into `ELEVENLABS_VOICE_ID`.

## Tuning

| Setting | Default | Notes |
|---|---|---|
| `EFFORT` | `low` | Fastest replies. Use `medium` or `high` for deeper reasoning, at the cost of slower answers. |
| `HONORIFIC` | `sir` | Or `boss`, or empty to use your name. |
| `HISTORY_TURNS` | `20` | How many recent exchanges it keeps in context (saved facts are always included). |

## Ideas for what's next

- Wake word ("Hey Kairos") on the laptop, using a local wake-word engine
- Morning briefing: design news, calendar, weather, your goals
- Calendar and email (Google), Figma and Notion integrations
- Proactive check-ins on deadlines it remembers
