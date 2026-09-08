import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gmail_safe_mcp import documents, search


class BM25SearchTests(unittest.TestCase):
    def test_tokenize_uses_korean_morphemes_without_particles(self):
        tokens = search.tokenize("계약기간은 보험금 지급 절차를 규정합니다.")
        self.assertIn("계약", tokens)
        self.assertIn("기간", tokens)
        self.assertIn("보험금", tokens)
        self.assertIn("지급", tokens)
        self.assertNotIn("은", tokens)
        self.assertNotIn("를", tokens)

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

    def test_bm25_returns_relevant_source_and_snippet(self):
        staged = documents.stage_upload("contract.png", _png_stream())
        documents.save_document(
            staged["draft_id"], "contract.png", {"raw_text": "계약기간은 2026년입니다. 갑과 을의 계약서입니다."}, {"category": "계약서"}
        )
        results = search.search_documents("계약기간")
        self.assertEqual(1, len(results))
        self.assertEqual("contract.png", results[0]["filename"])
        self.assertIn("계약기간", results[0]["snippet"])
        self.assertIn("contract.png", results[0]["source"])

    def test_empty_query_is_rejected(self):
        with self.assertRaises(ValueError):
            search.search_documents(" ")


def _png_stream():
    import io
    from PIL import Image

    output = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(output, format="PNG")
    return io.BytesIO(output.getvalue())


if __name__ == "__main__":
    unittest.main()