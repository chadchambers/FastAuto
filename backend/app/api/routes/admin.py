import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.dependencies.auth import (
    AdminUser,
    ModeratorUser,
    RedisDep,
    SessionDep,
    invalidate_user_cache,
)
from app.core.cache import cache_get_response, cache_set_response
from app.core.cache_keys import TTL_ADMIN_STATS, admin_stats_key
from app.core.config import settings
from app.crud import listings as listing_crud
from app.crud.users import (
    create_user,
    delete_user,
    get_user,
    get_user_by_email,
    get_users,
    update_user,
)
from app.models.listings import ListingStatus
from app.schemas.admin import DashboardStats, ListingRejectIn
from app.schemas.users import UserCreate, UserPublic, UsersPublic, UserUpdate
from app.services.admin.admin_service import get_dashboard_stats
from app.services.catalog import catalog_service
from app.utils.masking import mask_tail
from app.utils.pagination import PaginationDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/users", response_model=UsersPublic, summary="Список сотрудников")
async def list_users(
    session: SessionDep,
    pagination: PaginationDep,
    _: AdminUser,
) -> UsersPublic:
    users, count = await get_users(
        session, skip=pagination.skip, limit=pagination.limit
    )
    return UsersPublic(
        data=[UserPublic.model_validate(u) for u in users],
        count=count,
    )


@router.post(
    "/users",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Создать сотрудника",
)
async def create_user_route(
    session: SessionDep,
    _: AdminUser,
    body: UserCreate,
) -> UserPublic:
    if await get_user_by_email(session, body.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    user = await create_user(session, body)
    await session.commit()
    return UserPublic.model_validate(user)


@router.get("/users/{user_id}", response_model=UserPublic, summary="Детали сотрудника")
async def get_user_route(
    session: SessionDep,
    _: AdminUser,
    user_id: uuid.UUID,
) -> UserPublic:
    user = await get_user(session, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return UserPublic.model_validate(user)


@router.patch(
    "/users/{user_id}", response_model=UserPublic, summary="Обновить сотрудника"
)
async def update_user_route(
    session: SessionDep,
    redis: RedisDep,
    _: AdminUser,
    user_id: uuid.UUID,
    body: UserUpdate,
) -> UserPublic:
    user = await get_user(session, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if body.email:
        existing = await get_user_by_email(session, body.email)
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Email already taken"
            )
    user = await update_user(session, user, body)
    await session.commit()
    await invalidate_user_cache(redis, str(user_id))
    return UserPublic.model_validate(user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить сотрудника",
)
async def delete_user_route(
    session: SessionDep,
    redis: RedisDep,
    current_user: AdminUser,
    user_id: uuid.UUID,
) -> None:
    user = await get_user(session, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )
    await delete_user(session, user)
    await session.commit()
    await invalidate_user_cache(redis, str(user_id))


@router.get("/stats", response_model=DashboardStats, summary="Статистика дашборда")
async def dashboard_stats(
    redis: RedisDep,
    _: AdminUser,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    cache_key = admin_stats_key(date_from, date_to)
    if resp := await cache_get_response(redis, cache_key):
        return resp
    result = await get_dashboard_stats(date_from=date_from, date_to=date_to)
    return await cache_set_response(
        redis, cache_key, result.model_dump_json(), TTL_ADMIN_STATS
    )


class _StatusIn(BaseModel):
    status: ListingStatus


@router.patch("/listings/{listing_id}/status", response_model=None, summary="Изменить статус объявления")
async def set_listing_status(
    listing_id: uuid.UUID,
    body: _StatusIn,
    _: ModeratorUser,
    session: SessionDep,
) -> dict[str, Any]:
    listing = await listing_crud.get(session, listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Listing not found")
    listing.status = body.status
    await session.commit()
    return {"id": str(listing.id), "status": str(listing.status)}


@router.get("/listings/{listing_id}", response_model=None, summary="Детали объявления без маскировки")
async def get_listing_detail_admin(
    listing_id: uuid.UUID,
    _: ModeratorUser,
    session: SessionDep,
    redis: RedisDep,
) -> dict[str, Any]:
    listing = await listing_crud.get(session, listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Listing not found")

    full = await catalog_service.get_modification_full(session, redis, str(listing.modification_id))
    images = await listing_crud.list_images(session, listing.id)

    # get_modification_full already converts displacement cc→litres and caches it
    specification = full["specification"] if full else None

    data = listing.model_dump(mode="json")
    data["catalog_specs"] = specification
    data["images"] = [img.model_dump(mode="json") for img in images]
    # VIN and license_plate are NOT masked for admin/moderator
    return data


@router.get("/listings", response_model=None, summary="Очередь модерации")
async def moderation_queue(
    _: ModeratorUser,
    session: SessionDep,
    status: ListingStatus = ListingStatus.pending_review,
) -> list[dict[str, Any]]:
    rows = await listing_crud.list_by_status(session, status)
    result: list[dict[str, Any]] = []
    for r in rows:
        data = r.model_dump()
        data["vin"] = mask_tail(r.vin)
        data["license_plate"] = mask_tail(r.license_plate)
        result.append(data)
    return result


@router.post("/listings/{listing_id}/approve", summary="Одобрить объявление")
async def approve_listing(
    listing_id: uuid.UUID,
    _: ModeratorUser,
    session: SessionDep,
) -> dict[str, Any]:
    listing = await listing_crud.get(session, listing_id)
    if listing is None or listing.status != ListingStatus.pending_review:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    now = datetime.now(UTC)
    listing.status = ListingStatus.active
    listing.published_at = now
    listing.expires_at = now + timedelta(days=settings.LISTING_LIFETIME_DAYS)
    await session.commit()
    await session.refresh(listing)
    return listing.model_dump()


@router.post("/listings/{listing_id}/reject", summary="Отклонить объявление")
async def reject_listing(
    listing_id: uuid.UUID,
    body: ListingRejectIn,
    _: ModeratorUser,
    session: SessionDep,
) -> dict[str, Any]:
    listing = await listing_crud.get(session, listing_id)
    if listing is None or listing.status != ListingStatus.pending_review:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    listing.status = ListingStatus.archived
    logger.info("Listing %s rejected: %s", listing_id, body.reason)
    await session.commit()
    await session.refresh(listing)
    return listing.model_dump()


class _ListingEditIn(BaseModel):
    year: int | None = None
    price: int | None = None
    mileage: int | None = None
    color_id: str | None = None
    vin: str | None = None
    description: str | None = None
    condition: str | None = None


@router.patch("/listings/{listing_id}", response_model=None, summary="Редактировать объявление (admin)")
async def edit_listing_admin(
    listing_id: uuid.UUID,
    body: _ListingEditIn,
    _: ModeratorUser,
    session: SessionDep,
) -> dict[str, Any]:
    listing = await listing_crud.get(session, listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Listing not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(listing, field, value)
    await session.commit()
    await session.refresh(listing)
    return listing.model_dump()


@router.delete(
    "/listings/{listing_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить объявление (admin)",
)
async def delete_listing_admin(
    listing_id: uuid.UUID,
    _: ModeratorUser,
    session: SessionDep,
) -> None:
    listing = await listing_crud.get(session, listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Listing not found")
    from app.models.listings import ListingImage, ViewingWindow, ViewingBooking
    from sqlmodel import col, delete as sql_delete
    await session.execute(sql_delete(ViewingBooking).where(col(ViewingBooking.listing_id) == listing_id))
    await session.execute(sql_delete(ViewingWindow).where(col(ViewingWindow.listing_id) == listing_id))
    await session.execute(sql_delete(ListingImage).where(col(ListingImage.listing_id) == listing_id))
    await session.delete(listing)
    await session.commit()
