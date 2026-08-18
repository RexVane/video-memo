"""Resolve OpenAI-compatible API settings from explicit, env, or Grok CLI config."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

from project_paths import project_root

PROJECT_ROOT = project_root()
DEFAULT_BASE_URL = "https://api.x.ai/v1"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "grok-4.5"
BASE_URL_ENV_NAMES = (
    "LLM_BASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "XAI_BASE_URL",
    "GROK_MODELS_BASE_URL",
)
GENERIC_API_KEY_ENV_NAMES = ("LLM_API_KEY",)
OPENAI_API_KEY_ENV_NAMES = ("OPENAI_API_KEY",)
XAI_API_KEY_ENV_NAMES = (
    "GROK_API_KEY",
    "XAI_API_KEY",
    "GROK_CODE_XAI_API_KEY",
)
OPENAI_BASE_URL_ENV_NAMES = ("OPENAI_BASE_URL", "OPENAI_API_BASE")
XAI_BASE_URL_ENV_NAMES = (
    "XAI_BASE_URL",
    "GROK_MODELS_BASE_URL",
)

load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class LLMConfig:
    api_key: str = field(repr=False)
    base_url: str
    source: str


def default_model() -> str:
    return os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL


def _first_env(names: tuple[str, ...]) -> tuple[str | None, str | None]:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value, name
    return None, None


def _env_key_for_base(
    base_url: str,
    base_env_name: str | None,
) -> tuple[str | None, str | None]:
    if base_env_name == "LLM_BASE_URL":
        return _first_env(GENERIC_API_KEY_ENV_NAMES)
    if base_env_name in OPENAI_BASE_URL_ENV_NAMES:
        key = _first_env(OPENAI_API_KEY_ENV_NAMES)
        return key if key[0] else _first_env(GENERIC_API_KEY_ENV_NAMES)
    if base_env_name in XAI_BASE_URL_ENV_NAMES:
        key = _first_env(XAI_API_KEY_ENV_NAMES)
        return key if key[0] else _first_env(GENERIC_API_KEY_ENV_NAMES)

    hostname = (urlparse(base_url).hostname or "").lower()
    if hostname == "api.openai.com":
        key = _first_env(OPENAI_API_KEY_ENV_NAMES)
        return key if key[0] else _first_env(GENERIC_API_KEY_ENV_NAMES)
    if hostname == "api.x.ai" or hostname.endswith(".x.ai"):
        key = _first_env(XAI_API_KEY_ENV_NAMES)
        return key if key[0] else _first_env(GENERIC_API_KEY_ENV_NAMES)
    return _first_env(GENERIC_API_KEY_ENV_NAMES)


def _normalize_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("API Base URL 必须是有效的 http 或 https 地址")
    if parsed.username or parsed.password:
        raise ValueError("API Base URL 不能包含用户名或密码")
    if parsed.query or parsed.fragment:
        raise ValueError("API Base URL 不能包含查询参数或锚点")
    return base_url


def _local_grok_config(
    model: str,
    config_path: Path | None = None,
) -> LLMConfig | None:
    path = config_path or Path.home() / ".grok" / "config.toml"
    if not path.is_file():
        return None

    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None

    profiles = data.get("model") or {}
    if not isinstance(profiles, dict):
        return None

    def find_profile(name: str | None) -> dict | None:
        if not name:
            return None
        direct = profiles.get(name)
        if isinstance(direct, dict) and (
            "api_key" in direct or "base_url" in direct or "model" in direct
        ):
            return direct
        current = profiles
        for part in name.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current if isinstance(current, dict) else None

    profile = find_profile(model)
    if not isinstance(profile, dict):
        models = data.get("models") or {}
        default_name = models.get("default") if isinstance(models, dict) else None
        profile = find_profile(default_name)
    if not isinstance(profile, dict):
        profile = {}

    endpoints = data.get("endpoints") or {}
    if not isinstance(endpoints, dict):
        endpoints = {}
    base_url = (
        profile.get("base_url")
        or profile.get("api_base_url")
        or endpoints.get("models_base_url")
    )
    api_key = str(profile.get("api_key") or "").strip()
    env_key = str(profile.get("env_key") or "").strip()
    if not api_key and env_key:
        api_key = os.environ.get(env_key, "").strip()
    if not base_url or not api_key:
        return None

    return LLMConfig(
        api_key=api_key,
        base_url=_normalize_base_url(str(base_url)),
        source=f"Grok CLI config ({path})",
    )


def resolve_llm_config(
    model: str | None = None,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    grok_config_path: Path | None = None,
) -> LLMConfig:
    """Resolve one key/base-URL pair without logging the secret."""
    selected_model = (model or default_model()).strip()
    explicit_key = (api_key or "").strip() or None
    explicit_base = (base_url or "").strip() or None
    env_base, env_base_name = _first_env(BASE_URL_ENV_NAMES)

    selected_base = explicit_base or env_base
    if selected_base:
        normalized_base = _normalize_base_url(selected_base)
        matching_env_name = env_base_name if not explicit_base else None
        if explicit_base and env_base:
            try:
                if _normalize_base_url(env_base) == normalized_base:
                    matching_env_name = env_base_name
            except ValueError:
                pass
        env_key, env_key_name = _env_key_for_base(
            normalized_base,
            matching_env_name,
        )
        selected_key = explicit_key or env_key
        used_local_key = False
        source = "explicit configuration" if explicit_base else f"environment ({env_base_name})"
        if not selected_key:
            local = _local_grok_config(selected_model, grok_config_path)
            if local and local.base_url == normalized_base:
                selected_key = local.api_key
                source = local.source
                used_local_key = True
        if not selected_key:
            raise RuntimeError(
                "已配置 API Base URL，但缺少 API Key。请设置 LLM_API_KEY 或在界面中填写。"
            )
        key_source = "explicit key" if explicit_key else env_key_name
        if key_source and not used_local_key:
            source = f"{source}; key={key_source}"
        return LLMConfig(
            api_key=selected_key,
            base_url=normalized_base,
            source=source,
        )

    if explicit_key:
        return LLMConfig(
            api_key=explicit_key,
            base_url=DEFAULT_BASE_URL,
            source="explicit key; default xAI URL",
        )

    local = _local_grok_config(selected_model, grok_config_path)
    if local:
        return local

    xai_key, xai_key_name = _first_env(XAI_API_KEY_ENV_NAMES)
    if xai_key:
        return LLMConfig(
            api_key=xai_key,
            base_url=DEFAULT_BASE_URL,
            source=f"environment ({xai_key_name}); default xAI URL",
        )

    openai_key, openai_key_name = _first_env(OPENAI_API_KEY_ENV_NAMES)
    if openai_key:
        return LLMConfig(
            api_key=openai_key,
            base_url=DEFAULT_OPENAI_BASE_URL,
            source=f"environment ({openai_key_name}); default OpenAI URL",
        )

    generic_key, generic_key_name = _first_env(GENERIC_API_KEY_ENV_NAMES)
    if generic_key:
        raise RuntimeError(
            f"已配置 {generic_key_name}，但缺少 LLM_BASE_URL。"
            "通用 API Key 必须同时指定对应的 Base URL。"
        )

    raise RuntimeError(
        "未找到可用的 API Key。请配置 LLM_API_KEY、XAI_API_KEY，"
        "或在项目根目录 .env / 本机 Grok CLI 中配置。"
    )
