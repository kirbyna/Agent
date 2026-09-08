import unittest
from pathlib import Path
from unittest.mock import patch

from gmail_safe_mcp import vision


class VisionTests(unittest.TestCase):
    @patch("gmail_safe_mcp.vision.keyring.set_password")
    def test_save_token_requires_fine_grained_format(self, set_password):
        with self.assertRaises(ValueError):
            vision.save_copilot_token("ghp_" + "a" * 30)
        vision.save_copilot_token("github_pat_" + "a" * 30)
        set_password.assert_called_once()

    @patch("gmail_safe_mcp.vision.keyring.get_password", return_value="stored-token")
    def test_keychain_token_is_preferred(self, _get_password):
        with patch.dict("os.environ", {"COPILOT_GITHUB_TOKEN": "environment-token"}):
            self.assertEqual("stored-token", vision._copilot_token())

    @patch("gmail_safe_mcp.vision._run_copilot")
    def test_extract_uses_copilot_vision_model(self, run_copilot):
        run_copilot.return_value = {
            "document_type": "영수증",
            "title": "영수증",
            "summary": "카페 영수증입니다.",
            "raw_text": "합계 12,000원",
        }
        result = vision.extract_document(Path("receipt.png"))
        run_copilot.assert_called_once()
        self.assertIn("Vision", run_copilot.call_args.args[0])
        result = vision.extract_document(Path("receipt.png"))
        self.assertEqual("영수증", result["document_type"])
        self.assertEqual("카페 영수증입니다.", vision.summarize_document(result))

    @patch("gmail_safe_mcp.vision._run_copilot")
    def test_summary_and_meta_use_copilot_json(self, run_copilot):
        run_copilot.side_effect = [
            {"summary": "카페 영수증이며 결제 금액은 12,000원입니다."},
            {"title": "카페 영수증", "category": "영수증", "tags": ["영수증", "금액"], "description": "결제 문서"},
        ]
        extracted = {"document_type": "영수증", "amount": "12,000원"}
        self.assertIn("12,000원", vision.summarize_document(extracted))
        result = vision.generate_meta("receipt.png", extracted)
        self.assertEqual("카페 영수증", result["title"])
        self.assertEqual("GitHub Copilot Vision", result["generator"])

    def test_unsupported_file_is_rejected(self):
        with self.assertRaises(ValueError):
            vision.extract_document(Path("sample.txt"))

    @patch("gmail_safe_mcp.vision.pdfium.PdfDocument")
    def test_pdf_over_64_pages_is_rejected(self, pdf_document):
        pdf_document.return_value.__len__.return_value = 65
        with self.assertRaisesRegex(ValueError, "64페이지"):
            vision.extract_document(Path("sample.pdf"))


if __name__ == "__main__":
    unittest.main()