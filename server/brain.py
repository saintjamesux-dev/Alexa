"""The thinking loop: Claude + web search + memory tools, streamed as events."""

import json
import logging
from collections.abc import AsyncIterator

import anthropic

from . import config, memory
from .persona import context_block, persona

log = logging.getLogger(__name__)
client = anthropic.AsyncAnthropic()

TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 5},
    {
        "name": "remember",
        "description": "Save a durable fact about the user (goal, project, preference, person, deadline) to long-term memory.",
        "eager_input_streaming": True,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"fact": {"type": "string", "description": "One self-contained sentence."}},
            "required": ["fact"],
            "additionalProperties": False,
        },
    },
    {
        "name": "forget",
        "description": "Delete a saved fact by its id (the number after # in 'What you know about him').",
        "eager_input_streaming": True,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "integer"}},
            "required": ["id"],
            "additionalProperties": False,
        },
    },
]

MAX_ROUNDS = 8


def _run_tool(name: str, args: object) -> tuple[str, bool]:
    """Execute a client tool. Returns (result text, is_error)."""
    if not isinstance(args, dict):
        return "Invalid input.", True
    if name == "remember":
        fact = args.get("fact")
        if not isinstance(fact, str) or not fact.strip():
            return "Invalid input: 'fact' must be a non-empty string.", True
        return f"Saved as #{memory.add_fact(fact.strip())}.", False
    if name == "forget":
        fact_id = args.get("id")
        if not isinstance(fact_id, int):
            return "Invalid input: 'id' must be an integer.", True
        return ("Forgotten." if memory.delete_fact(fact_id) else "No fact with that id."), False
    return f"Unknown tool {name}.", True


def _echoable(content: list) -> list:
    """After a mid-output fallback, drop model-internal blocks before the last fallback marker."""
    idx = max((i for i, b in enumerate(content) if b.type == "fallback"), default=-1)
    if idx < 0:
        return content
    keep_before = [b for b in content[:idx] if b.type in ("text", "web_search_tool_result")]
    paired = {b.tool_use_id for b in keep_before if b.type == "web_search_tool_result"}
    keep_before += [b for b in content[:idx] if b.type == "server_tool_use" and b.id in paired]
    keep_before.sort(key=content.index)
    return keep_before + content[idx + 1 :]


def _user_content(text: str, images: list[dict]) -> list[dict] | str:
    if not images:
        return text
    blocks = [
        {"type": "image", "source": {"type": "base64", "media_type": img["media_type"], "data": img["data"]}}
        for img in images
    ]
    blocks.append({"type": "text", "text": text or "What do you think of this?"})
    return blocks


async def respond(text: str, images: list[dict], mode: str, local_time: str) -> AsyncIterator[dict]:
    """Yield events: {"type": "status"|"text"|"error"|"done", ...}."""
    system = [
        {"type": "text", "text": persona(), "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": context_block(mode, local_time, memory.list_facts())},
    ]
    messages = memory.recent_messages(config.HISTORY_TURNS)
    messages.append({"role": "user", "content": _user_content(text, images)})

    spoken: list[str] = []
    for _ in range(MAX_ROUNDS):
        try:
            async with client.beta.messages.stream(
                model=config.MODEL,
                max_tokens=16000,
                system=system,
                messages=messages,
                tools=TOOLS,
                thinking={"type": "adaptive"},
                output_config={"effort": config.EFFORT},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_start" and event.content_block.type == "server_tool_use":
                        yield {"type": "status", "text": "Searching the web…"}
                    elif event.type == "text":
                        spoken.append(event.text)
                        yield {"type": "text", "text": event.text}
                final = await stream.get_final_message()
        except ValueError:
            # Eager tool-input streaming produced unparseable JSON; retry the round.
            continue
        except anthropic.AuthenticationError:
            yield {"type": "error", "text": "My API key isn't valid. Check ANTHROPIC_API_KEY on the server."}
            return
        except anthropic.RateLimitError:
            yield {"type": "error", "text": "I'm being rate limited. Give me a moment and try again."}
            return
        except anthropic.APIStatusError as e:
            yield {"type": "error", "text": f"The model service returned an error ({e.status_code})."}
            return
        except anthropic.APIConnectionError:
            yield {"type": "error", "text": "I can't reach the model service. Check the server's internet connection."}
            return
        except Exception:
            log.exception("chat turn failed")
            yield {"type": "error", "text": "Something broke on my end. Is ANTHROPIC_API_KEY set? The server log has details."}
            return

        if final.stop_reason == "refusal":
            msg = "I'm not able to help with that one."
            spoken.append(msg)
            yield {"type": "text", "text": msg}
            break

        messages.append({"role": "assistant", "content": _echoable(final.content)})

        if final.stop_reason == "pause_turn":
            continue
        if final.stop_reason == "tool_use":
            results = []
            for block in final.content:
                if block.type == "tool_use":
                    out, is_error = _run_tool(block.name, block.input)
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": out, "is_error": is_error})
            messages.append({"role": "user", "content": results})
            continue
        break

    reply = "".join(spoken).strip()
    if reply:
        memory.add_message("user", text if not images else f"{text} [shared {len(images)} image(s)]".strip())
        memory.add_message("assistant", reply)
    yield {"type": "done"}


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"
