import json
import os
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import keyring
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
KEYRING_SERVICE = "gmail-safe-mcp"
KEYRING_ACCOUNT = "oauth-token"
MAX_RESULTS = 20
PREVIEW_LIFETIME = timedelta(minutes=10)
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


@dataclass
class Preview:
    message_ids: set[str]
    expires_at: datetime


previews: dict[str, Preview] = {}


def _load_credentials() -> Credentials | None:
    token_json = keyring.get_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
    if not token_json:
        return None

    credentials = Credentials.from_authorized_user_info(json.loads(token_json), [GMAIL_SCOPE])
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
        keyring.set_password(KEYRING_SERVICE, KEYRING_ACCOUNT, credentials.to_json())
    return credentials if credentials.valid else None


def _save_credentials(credentials: Credentials) -> None:
    keyring.set_password(KEYRING_SERVICE, KEYRING_ACCOUNT, credentials.to_json())


def _gmail_service() -> Any:
    credentials = _load_credentials()
    if credentials is None:
        raise RuntimeError("Gmail is not connected. Run connect_gmail first.")
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def _clean_text(value: str, field_name: str, max_length: int = 200) -> str:
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        raise ValueError(f"{field_name} must not be empty.")
    if len(cleaned) > max_length:
        raise ValueError(f"{field_name} must be {max_length} characters or fewer.")
    return cleaned.replace("\\", "\\\\").replace('"', '\\"')


def _build_query(sender: str | None, keyword: str | None) -> str:
    query_parts = ["-in:trash", "-in:spam"]
    if sender:
        normalized_sender = sender.strip()
        if not EMAIL_PATTERN.fullmatch(normalized_sender):
            raise ValueError("sender must be one complete email address.")
        query_parts.append(f"from:{normalized_sender}")
    if keyword:
        query_parts.append(f'"{_clean_text(keyword, "keyword")}"')
    if not sender and not keyword:
        raise ValueError("Provide a sender, a keyword, or both.")
    return " ".join(query_parts)


def _header_map(message: dict[str, Any]) -> dict[str, str]:
    headers = message.get("payload", {}).get("headers", [])
    return {header["name"].lower(): header.get("value", "") for header in headers}


def _search(sender: str | None, keyword: str | None, max_results: int) -> dict[str, Any]:
    if not 1 <= max_results <= MAX_RESULTS:
        raise ValueError(f"max_results must be between 1 and {MAX_RESULTS}.")

    service = _gmail_service()
    query = _build_query(sender, keyword)
    response = service.users().messages().list(
        userId="me", q=query, maxResults=max_results, includeSpamTrash=False
    ).execute()
    summaries = []
    for item in response.get("messages", []):
        message = service.users().messages().get(
            userId="me",
            id=item["id"],
            format="metadata",
            metadataHeaders=["From", "Subject", "Date"],
        ).execute()
        headers = _header_map(message)
        summaries.append(
            {
                "id": message["id"],
                "from": headers.get("from", ""),
                "subject": headers.get("subject", ""),
                "date": headers.get("date", ""),
            }
        )

    preview_token = secrets.token_urlsafe(18)
    previews[preview_token] = Preview(
        message_ids={message["id"] for message in summaries},
        expires_at=datetime.now(UTC) + PREVIEW_LIFETIME,
    )
    return {
        "preview_token": preview_token,
        "expires_in_minutes": 10,
        "count": len(summaries),
        "messages": summaries,
        "privacy_note": "Only From, Subject, and Date metadata was retrieved; message bodies were not read.",
    }


def _trash(preview_token: str, message_ids: list[str], confirmation: str) -> dict[str, Any]:
    preview = previews.get(preview_token)
    if preview is None or datetime.now(UTC) >= preview.expires_at:
        previews.pop(preview_token, None)
        raise ValueError("The preview token is missing or expired. Search again.")
    if not message_ids:
        raise ValueError("Select at least one message ID.")
    if len(message_ids) > MAX_RESULTS or len(set(message_ids)) != len(message_ids):
        raise ValueError("Select between 1 and 20 unique message IDs.")
    if not set(message_ids).issubset(preview.message_ids):
        raise ValueError("Every message ID must come from the matching preview.")

    expected_confirmation = f"TRASH {len(message_ids)}"
    if confirmation != expected_confirmation:
        raise ValueError(f'To continue, confirm with exactly "{expected_confirmation}".')

    service = _gmail_service()
    moved = []
    for message_id in message_ids:
        service.users().messages().trash(userId="me", id=message_id).execute()
        moved.append(message_id)
    previews.pop(preview_token, None)
    return {"moved_to_trash": moved, "count": len(moved), "permanently_deleted": False}


def health_check() -> dict[str, str]:
    """Check that the Gmail Safe MCP server is running."""
    return {"status": "ok"}


def connect_gmail() -> dict[str, str]:
    """Open Google's OAuth login and securely save the resulting token in macOS Keychain."""
    client_file = os.environ.get("GMAIL_OAUTH_CLIENT_FILE")
    if not client_file or not Path(client_file).is_file():
        raise RuntimeError("GMAIL_OAUTH_CLIENT_FILE must point to a Google Desktop OAuth JSON file.")
    flow = InstalledAppFlow.from_client_secrets_file(client_file, [GMAIL_SCOPE])
    credentials = flow.run_local_server(port=0, open_browser=True)
    _save_credentials(credentials)
    return {"status": "connected", "scope": GMAIL_SCOPE, "token_storage": "macOS Keychain"}


def disconnect_gmail() -> dict[str, str]:
    """Remove this MCP server's Gmail OAuth token from macOS Keychain."""
    try:
        keyring.delete_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass
    previews.clear()
    return {"status": "disconnected"}


def preview_matching_mail(
    sender: str | None = None, keyword: str | None = None, max_results: int = 20
) -> dict[str, Any]:
    """List up to 20 matching messages using metadata only. Provide a sender, keyword, or both."""
    return _search(sender, keyword, max_results)


def trash_selected_mail(
    preview_token: str, message_ids: list[str], confirmation: str
) -> dict[str, Any]:
    """Move selected IDs from a recent preview to Trash. Confirmation must be 'TRASH N'."""
    return _trash(preview_token, message_ids, confirmation)


def main() -> None:
    from mcp.server import MCPServer
    from mcp.types import ToolAnnotations

    mcp = MCPServer("gmailSafe")
    mcp.tool()(health_check)
    mcp.tool()(connect_gmail)
    mcp.tool()(disconnect_gmail)
    mcp.tool()(preview_matching_mail)
    mcp.tool(
        annotations=ToolAnnotations(
            title="Move selected Gmail messages to trash",
            destructiveHint=True,
            idempotentHint=False,
            openWorldHint=True,
        )
    )(trash_selected_mail)
    mcp.run()


if __name__ == "__main__":
    main()