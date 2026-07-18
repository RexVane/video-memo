from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import llm_config  # noqa: E402


class LLMConfigTests(unittest.TestCase):
    def test_explicit_openai_compatible_config(self) -> None:
        with patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "custom-model",
                api_key="secret-value",
                base_url="http://localhost:8000/v1/",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.base_url, "http://localhost:8000/v1")
        self.assertEqual(config.api_key, "secret-value")
        self.assertNotIn("secret-value", repr(config))

    def test_environment_config(self) -> None:
        env = {
            "LLM_API_KEY": "environment-key",
            "LLM_BASE_URL": "https://gateway.example.test/v1",
        }
        with patch.dict(os.environ, env, clear=True), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "custom-model",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.api_key, "environment-key")
        self.assertEqual(config.base_url, env["LLM_BASE_URL"])
        self.assertIn("LLM_BASE_URL", config.source)

    def test_openai_base_does_not_use_xai_key(self) -> None:
        env = {
            "OPENAI_BASE_URL": "https://api.openai.com/v1",
            "XAI_API_KEY": "xai-key",
        }
        with patch.dict(os.environ, env, clear=True), tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "缺少 API Key"):
                llm_config.resolve_llm_config(
                    "gpt-4.1",
                    grok_config_path=Path(tmp) / "missing.toml",
                )

    def test_provider_base_uses_matching_key_family(self) -> None:
        env = {
            "OPENAI_BASE_URL": "https://gateway.example.test/v1",
            "OPENAI_API_KEY": "openai-compatible-key",
            "XAI_API_KEY": "xai-key",
        }
        with patch.dict(os.environ, env, clear=True), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "custom-model",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.api_key, "openai-compatible-key")

    def test_reads_dotted_model_from_grok_cli_toml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                """
[endpoints]
models_base_url = "https://proxy.example.test/v1"

[models]
default = "grok-4.5"

[model.grok-4.5]
model = "grok-4.5"
api_key = "local-grok-key"
base_url = "https://proxy.example.test/v1"
""".strip(),
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True):
                config = llm_config.resolve_llm_config(
                    "grok-4.5",
                    grok_config_path=path,
                )

        self.assertEqual(config.api_key, "local-grok-key")
        self.assertEqual(config.base_url, "https://proxy.example.test/v1")
        self.assertIn("Grok CLI", config.source)

    def test_xai_key_uses_official_default_without_other_config(self) -> None:
        with patch.dict(os.environ, {"XAI_API_KEY": "official-key"}, clear=True), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "grok-4.5",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.base_url, llm_config.DEFAULT_BASE_URL)

    def test_openai_key_uses_openai_default_instead_of_xai(self) -> None:
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "openai-key"},
            clear=True,
        ), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "gpt-4.1",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.base_url, llm_config.DEFAULT_OPENAI_BASE_URL)
        self.assertEqual(config.api_key, "openai-key")

    def test_xai_key_wins_over_unpaired_openai_key(self) -> None:
        env = {
            "OPENAI_API_KEY": "openai-key",
            "XAI_API_KEY": "xai-key",
        }
        with patch.dict(os.environ, env, clear=True), tempfile.TemporaryDirectory() as tmp:
            config = llm_config.resolve_llm_config(
                "grok-4.5",
                grok_config_path=Path(tmp) / "missing.toml",
            )

        self.assertEqual(config.base_url, llm_config.DEFAULT_BASE_URL)
        self.assertEqual(config.api_key, "xai-key")

    def test_generic_key_requires_base_url(self) -> None:
        with patch.dict(
            os.environ,
            {"LLM_API_KEY": "generic-key"},
            clear=True,
        ), tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "LLM_BASE_URL"):
                llm_config.resolve_llm_config(
                    "custom-model",
                    grok_config_path=Path(tmp) / "missing.toml",
                )

    def test_explicit_config_ignores_invalid_local_config_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text("model = 42\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                config = llm_config.resolve_llm_config(
                    "custom-model",
                    api_key="explicit-key",
                    base_url="https://gateway.example.test/v1",
                    grok_config_path=path,
                )

        self.assertEqual(config.api_key, "explicit-key")
        self.assertEqual(config.base_url, "https://gateway.example.test/v1")

    def test_rejects_credentials_inside_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "用户名或密码"):
                llm_config.resolve_llm_config(
                    "model",
                    api_key="key",
                    base_url="https://user:pass@example.test/v1",
                    grok_config_path=Path(tmp) / "missing.toml",
                )


if __name__ == "__main__":
    unittest.main()
