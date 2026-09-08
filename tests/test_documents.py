import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from gmail_safe_mcp import documents


def png_bytes():
    output = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(output, format="PNG")
    return io.BytesIO(output.getvalue())


class DocumentStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.patches = [
            patch.object(documents, "APP_DATA_DIR", root),
            patch.object(documents, "DOCUMENTS_DIR", root / "documents"),
            patch.object(documents, "STAGING_DIR", root / "staging"),
            patch.object(documents, "DATABASE_PATH", root / "documents.sqlite3"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temporary.cleanup()

    def test_stage_rejects_unsupported_and_fake_files(self):
        with self.assertRaises(ValueError):
            documents.stage_upload("note.txt", io.BytesIO(b"hello"))
        with self.assertRaises(ValueError):
            documents.stage_upload("fake.png", io.BytesIO(b"not png"))

    def test_save_and_list_document(self):
        staged = documents.stage_upload("receipt.png", png_bytes())
        document_id = documents.save_document(
            staged["draft_id"], staged["original_name"], {"vendor": "Sample", "amount": 12000}
        )

        items = documents.list_documents()

        self.assertEqual(1, len(items))
        self.assertEqual("Sample", items[0]["extracted"]["vendor"])
        self.assertTrue(documents.document_file(document_id).is_file())

    def test_update_meta(self):
        staged = documents.stage_upload("scan.png", png_bytes())
        document_id = documents.save_document(staged["draft_id"], "scan.png", {"title": "Scan"})
        documents.update_meta(document_id, {"category": "영수증"})
        self.assertEqual("영수증", documents.get_document(document_id)["meta"]["category"])

    def test_delete_removes_record_and_original(self):
        staged = documents.stage_upload("delete.png", png_bytes())
        document_id = documents.save_document(staged["draft_id"], "delete.png", {"title": "Delete"})
        path = documents.document_file(document_id)
        documents.delete_document(document_id)
        self.assertFalse(path.exists())
        with self.assertRaises(FileNotFoundError):
            documents.get_document(document_id)


if __name__ == "__main__":
    unittest.main()