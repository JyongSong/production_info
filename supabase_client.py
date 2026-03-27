from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _load_env() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return
    with open(env_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env()

SUPABASE_URL: str = os.environ.get(
    "SUPABASE_URL",
    "https://jhinkxdunoxiwtdygzrw.supabase.co",
)
SUPABASE_ANON_KEY: str = os.environ.get(
    "SUPABASE_ANON_KEY",
    "",
)


def _build_headers(prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _api_request(
    method: str,
    table: str,
    query_params: str = "",
    body: Any = None,
    prefer: str | None = None,
) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if query_params:
        url += f"?{query_params}"

    encoded_body = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=encoded_body,
        headers=_build_headers(prefer),
        method=method,
    )

    try:
        with urllib.request.urlopen(req) as response:
            response_text = response.read().decode("utf-8")
            if response_text:
                return json.loads(response_text)
            return None
    except urllib.error.HTTPError as error:
        error_text = error.read().decode("utf-8")
        raise RuntimeError(
            f"Supabase API error ({error.code}): {error_text}"
        ) from error


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def select(
    table: str,
    columns: str = "*",
    filters: dict[str, str] | None = None,
    order: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    parts = [f"select={columns}"]
    if filters:
        for key, value in filters.items():
            parts.append(f"{key}={value}")
    if order:
        parts.append(f"order={order}")
    if limit is not None and limit > 0:
        parts.append(f"limit={limit}")

    result = _api_request("GET", table, query_params="&".join(parts))
    return result if isinstance(result, list) else []


def insert(table: str, data: dict[str, Any] | list[dict[str, Any]]) -> Any:
    result = _api_request(
        "POST",
        table,
        body=data,
        prefer="return=representation",
    )
    if isinstance(result, list) and len(result) == 1 and isinstance(data, dict):
        return result[0]
    return result


def update(table: str, filters: str, data: dict[str, Any]) -> dict[str, Any] | None:
    result = _api_request(
        "PATCH",
        table,
        query_params=filters,
        body=data,
        prefer="return=representation",
    )
    if isinstance(result, list) and result:
        return result[0]
    return result


def delete(table: str, filters: str) -> None:
    _api_request("DELETE", table, query_params=filters)
