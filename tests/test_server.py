import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from gmail_safe_mcp import server


class Request:
    def __init__(self, result):
        self.result = result

    def execute(self):
        return self.result


class Messages:
    def __init__(self):
        self.trashed = []
        self.query = None

    def list(self, **kwargs):
        self.query = kwargs
        return Request({"messages": [{"id": "m1"}, {"id": "m2"}]})

    def get(self, **kwargs):
        message_id = kwargs["id"]
        return Request(
            {
                "id": message_id,
                "payload": {
                    "headers": [
                        {"name": "From", "value": "Sender <sender@example.com>"},
                        {"name": "Subject", "value": f"Subject {message_id}"},
                        {"name": "Date", "value": "Tue, 2 Sep 2026 10:00:00 +0900"},
                    ]
                },
            }
        )

    def trash(self, **kwargs):
        self.trashed.append(kwargs["id"])
        return Request({"id": kwargs["id"], "labelIds": ["TRASH"]})


class Service:
    def __init__(self):
        self.message_api = Messages()

    def users(self):
        return self

    def messages(self):
        return self.message_api


class GmailSafeServerTests(unittest.TestCase):
    def setUp(self):
        server.previews.clear()
        self.service = Service()
        self.service_patch = patch.object(server, "_gmail_service", return_value=self.service)
        self.service_patch.start()

    def tearDown(self):
        self.service_patch.stop()

    def test_search_uses_metadata_only_and_returns_preview(self):
        result = server._search("sender@example.com", "invoice", 10)

        self.assertEqual(2, result["count"])
        self.assertNotIn("body", result["messages"][0])
        self.assertEqual(
            '-in:trash -in:spam from:sender@example.com "invoice"',
            self.service.message_api.query["q"],
        )
        self.assertIn(result["preview_token"], server.previews)

    def test_search_requires_a_filter_and_limits_results(self):
        with self.assertRaises(ValueError):
            server._search(None, None, 20)
        with self.assertRaises(ValueError):
            server._search(None, "invoice", 21)

    def test_trash_rejects_unpreviewed_message(self):
        server.previews["token"] = server.Preview({"m1"}, datetime.now(UTC) + timedelta(minutes=1))

        with self.assertRaisesRegex(ValueError, "matching preview"):
            server._trash("token", ["other"], "TRASH 1")
        self.assertEqual([], self.service.message_api.trashed)

    def test_trash_requires_exact_confirmation_then_consumes_preview(self):
        server.previews["token"] = server.Preview({"m1", "m2"}, datetime.now(UTC) + timedelta(minutes=1))

        with self.assertRaisesRegex(ValueError, "TRASH 2"):
            server._trash("token", ["m1", "m2"], "yes")
        result = server._trash("token", ["m2", "m1"], "TRASH 2")

        self.assertEqual(["m2", "m1"], self.service.message_api.trashed)
        self.assertFalse(result["permanently_deleted"])
        self.assertNotIn("token", server.previews)


if __name__ == "__main__":
    unittest.main()