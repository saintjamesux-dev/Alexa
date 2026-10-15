"""HTTP server: the API plus the web app for phone and laptop."""

import hmac

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import brain, config, memory

app = FastAPI(title=config.ASSISTANT_NAME, docs_url=None, redoc_url=None)


def check_code(x_access_code: str = Header(default="")) -> None:
    if not config.ACCESS_CODE:
        raise HTTPException(503, "Set ACCESS_CODE in .env before using the assistant.")
    if not hmac.compare_digest(x_access_code.encode(), config.ACCESS_CODE.encode()):
        raise HTTPException(401, "Wrong access code.")


class Image(BaseModel):
    media_type: str = Field(pattern=r"^image/(jpeg|png|gif|webp)$")
    data: str  # base64, no data: prefix


class ChatIn(BaseModel):
    text: str = Field(default="", max_length=8000)
    images: list[Image] = Field(default_factory=list, max_length=4)
    mode: str = Field(default="voice", pattern=r"^(voice|text)$")
    local_time: str = Field(default="", max_length=100)


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@app.get("/api/config")
def get_config():
    return {
        "name": config.ASSISTANT_NAME,
        "user": config.USER_NAME,
        "premium_voice": bool(config.ELEVENLABS_API_KEY),
    }


@app.get("/manifest.webmanifest")
def manifest():
    """Install-to-home-screen metadata, named after the assistant."""
    return JSONResponse(
        {
            "name": config.ASSISTANT_NAME,
            "short_name": config.ASSISTANT_NAME,
            "start_url": "/",
            "display": "standalone",
            "background_color": "#06080b",
            "theme_color": "#06080b",
            "icons": [
                {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
            ],
        },
        media_type="application/manifest+json",
    )


@app.post("/api/auth", dependencies=[Depends(check_code)])
def auth():
    return {"ok": True}


@app.post("/api/chat", dependencies=[Depends(check_code)])
async def chat(body: ChatIn):
    if not body.text.strip() and not body.images:
        raise HTTPException(400, "Say something first.")

    async def events():
        async for event in brain.respond(
            body.text.strip(), [i.model_dump() for i in body.images], body.mode, body.local_time
        ):
            yield brain.sse(event)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.post("/api/speak", dependencies=[Depends(check_code)])
async def speak(body: SpeakIn):
    """Premium voice via ElevenLabs. 204 means: use the browser's built-in voice."""
    if not config.ELEVENLABS_API_KEY:
        return Response(status_code=204)
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{config.ELEVENLABS_VOICE_ID}",
            headers={"xi-api-key": config.ELEVENLABS_API_KEY, "accept": "audio/mpeg"},
            json={"text": body.text, "model_id": config.ELEVENLABS_MODEL},
        )
    if r.status_code != 200:
        return Response(status_code=204)  # fall back to the browser voice rather than going silent
    return Response(content=r.content, media_type="audio/mpeg")


@app.get("/api/history", dependencies=[Depends(check_code)])
def history():
    return memory.transcript()


@app.delete("/api/history", dependencies=[Depends(check_code)])
def clear_history():
    memory.clear_history()
    return {"ok": True}


@app.get("/api/memory", dependencies=[Depends(check_code)])
def facts():
    return memory.list_facts()


@app.delete("/api/memory/{fact_id}", dependencies=[Depends(check_code)])
def forget(fact_id: int):
    if not memory.delete_fact(fact_id):
        raise HTTPException(404, "No such memory.")
    return {"ok": True}


app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
