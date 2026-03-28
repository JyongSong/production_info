from __future__ import annotations

from datetime import datetime
from typing import Any

import supabase_client as db


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_QR_LENGTH = 3
RECENT_LIMIT = 10
SEARCH_LIMIT = 200

TABLE = "production_records"
USED_TABLE = "used_sn_codes"
LUMI_PRODUCT_TABLE = "lumi_product_sn"


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class MatchServiceError(Exception):
    """Base exception for match service errors."""


class ValidationError(MatchServiceError):
    """Raised when user input is not valid."""


class DuplicatePairError(MatchServiceError):
    """Raised when the same SN pair already exists."""


class DuplicateQRCodeError(MatchServiceError):
    """Raised when an SN value was already used in another record."""


class DuplicateSaveError(MatchServiceError):
    """Raised when the save operation violates a duplicate rule."""


class InvalidLumiSnError(MatchServiceError):
    """Raised when the Lumi SN does not exist in lumi_product_sn table."""


class NotFoundError(MatchServiceError):
    """Raised when the target record does not exist."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_date_filter(value: Any) -> str:
    date_text = normalize_text(value)
    if not date_text:
        return ""
    try:
        datetime.strptime(date_text, "%Y-%m-%d")
    except ValueError as error:
        raise ValidationError("날짜 형식이 올바르지 않습니다.") from error
    return date_text


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    """Map Supabase column names to internal API field names."""
    return {
        "id": row["id"],
        "first_qr": row["lumi_sn"],
        "second_qr": row["solity_sn"],
        "created_at": row["production_time"],
        "operator_name": row.get("operator_name") or "",
        "note": row.get("note") or "",
    }


def validate_match_input(first_qr: str, second_qr: str) -> None:
    from .settings_service import get_qr_settings

    if not first_qr or not second_qr:
        raise ValidationError("Lumi SN과 Solity SN을 모두 입력해주세요.")

    settings = get_qr_settings()
    first_qr_length = settings["first_qr_length"]
    second_qr_length = settings["second_qr_length"]

    if first_qr_length > 0 and len(first_qr) != first_qr_length:
        raise ValidationError(f"Lumi SN은 {first_qr_length}자리여야 합니다.")

    if second_qr_length > 0 and len(second_qr) != second_qr_length:
        raise ValidationError(f"Solity SN은 {second_qr_length}자리여야 합니다.")

    if first_qr_length == 0 and len(first_qr) < MIN_QR_LENGTH:
        raise ValidationError(f"Lumi SN은 최소 {MIN_QR_LENGTH}자 이상이어야 합니다.")

    if second_qr_length == 0 and len(second_qr) < MIN_QR_LENGTH:
        raise ValidationError(f"Solity SN은 최소 {MIN_QR_LENGTH}자 이상이어야 합니다.")

    if first_qr == second_qr:
        raise ValidationError("동일한 값 2개는 한 세트로 저장할 수 없습니다.")


def _validate_lumi_sn_exists(lumi_sn: str) -> None:
    """Check that the given Lumi SN exists in the lumi_product_sn table."""
    rows = db.select(
        LUMI_PRODUCT_TABLE,
        columns="lumi_sn",
        filters={"lumi_sn": f"eq.{lumi_sn}"},
        limit=1,
    )
    if not rows:
        raise InvalidLumiSnError("등록되지 않은 Lumi SN입니다. 유효한 Lumi SN을 입력해주세요.")


def check_lumi_sn_exists(lumi_sn: str) -> bool:
    """Return True if the Lumi SN exists in the lumi_product_sn table."""
    lumi_sn = normalize_text(lumi_sn)
    if not lumi_sn:
        return False
    rows = db.select(
        LUMI_PRODUCT_TABLE,
        columns="lumi_sn",
        filters={"lumi_sn": f"eq.{lumi_sn}"},
        limit=1,
    )
    return bool(rows)


def _validate_duplicate_rules(
    first_qr: str,
    second_qr: str,
    exclude_record_id: int | None = None,
) -> None:
    # Check duplicate pair
    pair_filters: dict[str, str] = {
        "lumi_sn": f"eq.{first_qr}",
        "solity_sn": f"eq.{second_qr}",
    }
    if exclude_record_id is not None:
        pair_filters["id"] = f"neq.{exclude_record_id}"

    existing_pairs = db.select(TABLE, columns="id", filters=pair_filters, limit=1)
    if existing_pairs:
        raise DuplicatePairError("이미 등록된 매칭입니다.")

    # Check used SN codes
    used_filters: dict[str, str] = {
        "sn_value": f"in.({first_qr},{second_qr})",
    }
    if exclude_record_id is not None:
        used_filters["record_id"] = f"neq.{exclude_record_id}"

    existing_codes = db.select(USED_TABLE, columns="sn_value", filters=used_filters, limit=1)
    if existing_codes:
        raise DuplicateQRCodeError("이미 사용된 SN 코드입니다.")


def _save_used_sn_codes(record_id: int, first_qr: str, second_qr: str) -> None:
    db.insert(
        USED_TABLE,
        [
            {"sn_value": first_qr, "record_id": record_id, "sn_role": "lumi"},
            {"sn_value": second_qr, "record_id": record_id, "sn_role": "solity"},
        ],
    )


# ---------------------------------------------------------------------------
# Public CRUD
# ---------------------------------------------------------------------------

def get_match_by_id(match_id: int) -> dict[str, Any]:
    rows = db.select(TABLE, filters={"id": f"eq.{match_id}"}, limit=1)
    if not rows:
        raise NotFoundError("수정할 데이터를 찾을 수 없습니다.")
    return _row_to_dict(rows[0])


def create_match(
    first_qr: Any,
    second_qr: Any,
    operator_name: Any = "",
    note: Any = "",
) -> dict[str, Any]:
    first_qr = normalize_text(first_qr)
    second_qr = normalize_text(second_qr)
    operator_name = normalize_text(operator_name)
    note = normalize_text(note)

    validate_match_input(first_qr, second_qr)
    _validate_lumi_sn_exists(first_qr)
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    _validate_duplicate_rules(first_qr, second_qr)

    try:
        saved_row = db.insert(
            TABLE,
            {
                "lumi_sn": first_qr,
                "solity_sn": second_qr,
                "production_time": created_at,
                "operator_name": operator_name,
                "note": note,
            },
        )
    except RuntimeError as error:
        error_msg = str(error)
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            raise DuplicateSaveError("중복으로 저장할 수 없습니다.") from error
        raise

    if not saved_row or "id" not in saved_row:
        raise DuplicateSaveError("중복으로 저장할 수 없습니다.")

    _save_used_sn_codes(saved_row["id"], first_qr, second_qr)
    return _row_to_dict(saved_row)


def update_match(
    match_id: int,
    first_qr: Any,
    second_qr: Any,
    operator_name: Any = "",
    note: Any = "",
) -> dict[str, Any]:
    first_qr = normalize_text(first_qr)
    second_qr = normalize_text(second_qr)
    operator_name = normalize_text(operator_name)
    note = normalize_text(note)

    validate_match_input(first_qr, second_qr)
    _validate_lumi_sn_exists(first_qr)

    # Verify record exists
    existing = db.select(TABLE, columns="id", filters={"id": f"eq.{match_id}"}, limit=1)
    if not existing:
        raise NotFoundError("수정할 데이터를 찾을 수 없습니다.")

    _validate_duplicate_rules(first_qr, second_qr, exclude_record_id=match_id)

    try:
        updated_row = db.update(
            TABLE,
            f"id=eq.{match_id}",
            {
                "lumi_sn": first_qr,
                "solity_sn": second_qr,
                "operator_name": operator_name,
                "note": note,
            },
        )
    except RuntimeError as error:
        error_msg = str(error)
        if "duplicate" in error_msg.lower() or "unique" in error_msg.lower():
            raise DuplicateSaveError("중복으로 저장할 수 없습니다.") from error
        raise

    if not updated_row:
        raise DuplicateSaveError("중복으로 저장할 수 없습니다.")

    # Refresh used SN codes
    db.delete(USED_TABLE, f"record_id=eq.{match_id}")
    _save_used_sn_codes(match_id, first_qr, second_qr)

    return _row_to_dict(updated_row)


def delete_match(match_id: int) -> None:
    existing = db.select(TABLE, columns="id", filters={"id": f"eq.{match_id}"}, limit=1)
    if not existing:
        raise NotFoundError("삭제할 데이터를 찾을 수 없습니다.")

    db.delete(USED_TABLE, f"record_id=eq.{match_id}")
    db.delete(TABLE, f"id=eq.{match_id}")


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def fetch_matches(
    first_qr: str = "",
    second_qr: str = "",
    target_date: str = "",
    limit: int = SEARCH_LIMIT,
) -> list[dict[str, Any]]:
    first_qr = normalize_text(first_qr)
    second_qr = normalize_text(second_qr)
    target_date = normalize_date_filter(target_date)

    filters: dict[str, str] = {}

    if first_qr:
        filters["lumi_sn"] = f"ilike.*{first_qr}*"

    if second_qr:
        filters["solity_sn"] = f"ilike.*{second_qr}*"

    if target_date:
        filters["production_time"] = f"like.{target_date}*"

    rows = db.select(
        TABLE,
        filters=filters,
        order="production_time.desc,id.desc",
        limit=limit if limit > 0 else None,
    )
    return [_row_to_dict(row) for row in rows]


def get_recent_matches(limit: int = RECENT_LIMIT) -> list[dict[str, Any]]:
    return fetch_matches(limit=limit)


def search_matches(
    first_qr: Any = "",
    second_qr: Any = "",
    target_date: Any = "",
) -> list[dict[str, Any]]:
    return fetch_matches(
        first_qr=normalize_text(first_qr),
        second_qr=normalize_text(second_qr),
        target_date=normalize_text(target_date),
        limit=SEARCH_LIMIT,
    )


def list_matches_for_export(target_date: Any = "") -> list[dict[str, Any]]:
    return fetch_matches(target_date=normalize_text(target_date), limit=0)


def count_matches_by_date(target_date: Any) -> int:
    date_text = normalize_date_filter(target_date)
    rows = db.select(
        TABLE,
        columns="id",
        filters={"production_time": f"like.{date_text}*"},
    )
    return len(rows)
