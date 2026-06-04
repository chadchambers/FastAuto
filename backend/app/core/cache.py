from __future__ import annotations

import hashlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import orjson
from fastapi import Request
from fastapi.responses import Response
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import inmem_cache
from app.core.config import settings

logger = logging.getLogger(__name__)

_JSON_RESPONSE = "application/json"
_PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"


def _etag_of(content: bytes) -> str:
    return f'W/"{hashlib.sha256(content).hexdigest()[:16]}"'


def _cacheable_response(content: bytes, etag: str | None = None) -> Response:
    return Response(
        content=content,
        media_type=_JSON_RESPONSE,
        headers={
            "Cache-Control": _PUBLIC_CACHE_CONTROL,
            "ETag": etag or _etag_of(content),
            "Vary": "Accept-Encoding",
        },
    )


async def cached_json_response(
    request: Request,
    redis: Redis,
    *,
    key: str,
    build: Callable[[], Awaitable[Any]],
    ttl: int = 3600,
) -> Response:
    """Single helper for public reference endpoints.

    1. If Redis has bytes at ``key`` → compute ETag, check ``If-None-Match`` →
       304 if matches, else 200 with cached bytes + ``Cache-Control``/``ETag``.
    2. Else call ``build()`` (the loader that returns the JSON-safe object),
       serialize via orjson, store bytes in Redis, return 200.

    Stores **raw bytes**, not the deserialized dict — bypasses orjson.loads
    on hit.
    """
    mem_hit = inmem_cache.get(key) if settings.CACHE_ENABLED else None
    if mem_hit is not None:
        etag = _etag_of(mem_hit)
        if request.headers.get("if-none-match") == etag:
            return Response(
                status_code=304,
                headers={"ETag": etag, "Cache-Control": _PUBLIC_CACHE_CONTROL},
            )
        return _cacheable_response(mem_hit, etag=etag)

    if settings.CACHE_ENABLED:
        try:
            cached = await redis.get(key)
        except RedisError as exc:
            logger.warning("Cache get failed key=%s: %s", key, exc)
            cached = None
        if cached is not None:
            content = cached if isinstance(cached, bytes) else cached.encode()
            inmem_cache.set_(key, content, ttl=ttl)
            etag = _etag_of(content)
            if request.headers.get("if-none-match") == etag:
                return Response(
                    status_code=304,
                    headers={
                        "ETag": etag,
                        "Cache-Control": _PUBLIC_CACHE_CONTROL,
                    },
                )
            return _cacheable_response(content, etag=etag)

    data = await build()
    content = orjson.dumps(data, option=orjson.OPT_NON_STR_KEYS)
    if settings.CACHE_ENABLED:
        inmem_cache.set_(key, content, ttl=ttl)
        try:
            await redis.setex(key, ttl, content)
        except RedisError as exc:
            logger.warning("Cache set failed key=%s: %s", key, exc)
    etag = _etag_of(content)
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": _PUBLIC_CACHE_CONTROL},
        )
    return _cacheable_response(content, etag=etag)


async def cache_get(redis: Redis, key: str) -> Any | None:
    if not settings.CACHE_ENABLED:
        return None
    try:
        raw = await redis.get(key)
    except RedisError as exc:
        logger.warning("Cache get failed key=%s: %s", key, exc)
        return None
    if raw is None:
        return None
    try:
        return orjson.loads(raw)
    except orjson.JSONDecodeError:
        return None


async def cache_set(redis: Redis, key: str, value: Any, ttl: int) -> None:
    if not settings.CACHE_ENABLED:
        return
    try:
        await redis.setex(
            key,
            ttl,
            orjson.dumps(value, option=orjson.OPT_NON_STR_KEYS).decode(),
        )
    except RedisError as exc:
        logger.warning("Cache set failed key=%s: %s", key, exc)


async def cache_get_response(redis: Redis, key: str) -> Response | None:
    if not settings.CACHE_ENABLED:
        return None
    raw: str | None
    try:
        raw = await redis.get(key)
    except RedisError as exc:
        logger.warning("Cache get_response failed key=%s: %s", key, exc)
        return None
    if raw is None:
        return None
    content = raw if isinstance(raw, bytes) else raw.encode()
    return Response(content=content, media_type=_JSON_RESPONSE)


async def cache_set_response(
    redis: Redis, key: str, json_str: str, ttl: int
) -> Response:
    if settings.CACHE_ENABLED:
        try:
            await redis.setex(key, ttl, json_str)
        except RedisError as exc:
            logger.warning("Cache set_response failed key=%s: %s", key, exc)
    return Response(content=json_str.encode(), media_type=_JSON_RESPONSE)


async def cache_delete(redis: Redis, *keys: str) -> None:
    if not keys:
        return
    try:
        await redis.delete(*keys)
    except RedisError as exc:
        logger.warning("Cache delete failed keys=%s: %s", keys, exc)


async def cache_delete_pattern(redis: Redis, pattern: str) -> None:
    try:
        batch: list[str] = []
        async for key in redis.scan_iter(match=pattern, count=500):
            batch.append(key)
            if len(batch) >= 500:
                await redis.delete(*batch)
                batch = []
        if batch:
            await redis.delete(*batch)
    except RedisError as exc:
        logger.warning("Cache delete pattern failed pattern=%s: %s", pattern, exc)


async def cache_increment(redis: Redis, key: str) -> None:
    try:
        await redis.incr(key)
    except RedisError as exc:
        logger.warning("Cache increment failed key=%s: %s", key, exc)
