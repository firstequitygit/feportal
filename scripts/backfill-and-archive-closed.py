"""
One-time script: pull close_time from Pipedrive for every Closed-stage deal,
mirror it onto the corresponding Supabase loans.closed_at, then archive any
loan whose closed_at is more than 30 days ago.

Idempotent: re-running just refreshes closed_at and re-archives.
Reads tokens from ../.env.local.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


def read_env(path: Path) -> dict[str, str]:
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def http(method: str, url: str, headers: dict, body=None) -> tuple[int, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    env = read_env(Path(__file__).parent.parent / ".env.local")
    pd_token = env["PIPEDRIVE_API_TOKEN"]
    sb_url = env["NEXT_PUBLIC_SUPABASE_URL"]
    sb_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    pd_pipeline = 2  # FE Deals Pipeline

    # ---- 1. Pull all won (closed) deals from Pipedrive ----
    print(f"Fetching closed deals from Pipedrive pipeline {pd_pipeline}...")
    deals_by_id: dict[int, str] = {}
    start = 0
    while True:
        url = (
            f"https://api.pipedrive.com/v1/deals?api_token={pd_token}"
            f"&pipeline_id={pd_pipeline}&status=won&limit=500&start={start}"
        )
        status, body = http("GET", url, {})
        if status != 200:
            print(f"  ERROR Pipedrive {status}: {body[:200]!r}")
            sys.exit(1)
        payload = json.loads(body)
        data = payload.get("data") or []
        for d in data:
            close_str = d.get("close_time") or d.get("won_time")
            if not close_str:
                continue
            # Pipedrive returns "YYYY-MM-DD HH:MM:SS" UTC; convert to ISO
            iso = close_str.replace(" ", "T") + "+00:00"
            deals_by_id[d["id"]] = iso
        pagination = payload.get("additional_data", {}).get("pagination", {})
        if not pagination.get("more_items_in_collection"):
            break
        start = pagination.get("next_start", start + len(data))
    print(f"  Found {len(deals_by_id)} closed deals with close_time")

    # ---- 2. Pull Supabase loans for those deal ids ----
    print("\nLooking up matching loans in Supabase...")
    sb_headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
    }
    ids_str = ",".join(str(i) for i in deals_by_id.keys())
    status, body = http(
        "GET",
        f"{sb_url}/rest/v1/loans?pipedrive_deal_id=in.({ids_str})"
        f"&select=id,pipedrive_deal_id,closed_at,archived",
        sb_headers,
    )
    if status != 200:
        print(f"  ERROR Supabase {status}: {body[:300]!r}")
        sys.exit(1)
    loans = json.loads(body)
    print(f"  Found {len(loans)} matching loan rows in Supabase")

    # ---- 3. Build update payload ----
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    to_update: list[dict] = []
    archived_count = 0
    skipped_recent = 0
    for loan in loans:
        deal_id = loan["pipedrive_deal_id"]
        close_iso = deals_by_id.get(deal_id)
        if not close_iso:
            continue
        close_dt = datetime.fromisoformat(close_iso)
        is_old = close_dt < cutoff
        if is_old:
            archived_count += 1
        else:
            skipped_recent += 1
        to_update.append({
            "id": loan["id"],
            "pipedrive_deal_id": deal_id,
            "closed_at": close_iso,
            "archived": is_old,
        })

    print(f"\nPlan: backfill closed_at on {len(to_update)} loans")
    print(f"  - {archived_count} will be archived (closed > 30 days ago)")
    print(f"  - {skipped_recent} kept active (closed within last 30 days)")

    # ---- 4. Bulk upsert via Supabase ----
    # Use pipedrive_deal_id as conflict target (unique constraint).
    # POST with Prefer: resolution=merge-duplicates,return=minimal does an upsert.
    print("\nSending bulk upsert...")
    upsert_headers = {
        **sb_headers,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    status, body = http(
        "POST",
        f"{sb_url}/rest/v1/loans?on_conflict=pipedrive_deal_id",
        upsert_headers,
        to_update,
    )
    if status >= 300:
        print(f"  ERROR Supabase {status}: {body[:500]!r}")
        sys.exit(1)
    print(f"  OK ({status})")

    # ---- 5. Log the bulk-archive event for the archived loans ----
    print(f"\nLogging loan_events for {archived_count} archived loans...")
    archived_loan_ids = [u["id"] for u in to_update if u["archived"]]
    events = [
        {
            "loan_id": loan_id,
            "event_type": "loan_archived",
            "description": "Loan archived in bulk (closed >30 days ago at sync time)",
        }
        for loan_id in archived_loan_ids
    ]
    if events:
        status, body = http("POST", f"{sb_url}/rest/v1/loan_events", sb_headers, events)
        if status >= 300:
            print(f"  WARN (events insert failed) Supabase {status}: {body[:300]!r}")
        else:
            print(f"  OK ({status})")

    print("\nDone.")
    print(f"  closed_at backfilled: {len(to_update)}")
    print(f"  archived:             {archived_count}")
    print(f"  kept active:          {skipped_recent}")


if __name__ == "__main__":
    main()
