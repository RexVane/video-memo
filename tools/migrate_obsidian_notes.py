"""One-time migration of legacy VideoMemo exports into topic-based folders.

Old exports (before the a704881 layout change) were written to
``<vault>/Video Memos/<title>_<source_id>.md`` with attachments under
``<vault>/Video Memos/assets/<source_id>/frame_*.jpg``. The current layout is
``<vault>/<topic>/<AI title>.md`` with attachments beside the note, so this
tool:

* classifies each note's topic with the configured LLM (2-6 chars), or uses
  ``--topic`` for a single override, or ``--no-llm`` to skip folders;
* strips the source-id suffix from the note name and converts the old
  underscore sanitization back to spaces;
* moves the note (and its attachment folder) into the topic folder and
  rewrites ``![[Video Memos/assets/...]]`` embeds to the new location;
* stamps a ``<!-- videomemo:source:<id> -->`` marker so future exports of
  the same source update the migrated note in place.

Nothing is deleted: backups, unrecognized files and leftover folders stay in
the source folder and are reported. Run ``--dry-run`` first; ``--apply``
commits the moves.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import httpx  # noqa: E402

from llm_config import default_model, resolve_llm_config  # noqa: E402
from obsidian_export import (  # noqa: E402
    _GENERATED_END,
    _GENERATED_START,
    _SOURCE_MARKER,
    _safe_name,
    _topic_folder_name,
    _vault_folder,
)
from summarize import (  # noqa: E402
    _chat_completion,
    _client,
    _split_front_tags,
    _uses_anthropic_messages,
    llm_timeout,
)

_SOURCE_ID_SUFFIX = re.compile(r"_([0-9a-f]{8})\.md$")
_BACKUP_NAME = re.compile(r"\.backup-\d{8}_\d{6}\.md$")
_FRONTMATTER_SOURCE = re.compile(r'^source:\s*(".*")\s*$', re.MULTILINE)

CLASSIFY_SYSTEM = (
    "你是归档管理员。根据笔记内容，用一个 2-6 字的主题分类词概括它属于哪个知识领域"
    "（如：Git、Python、Obsidian、效率工具、外语学习），用于 Obsidian 归档目录命名。"
    "必须具体准确、能代表整份材料；材料是中文就输出中文词。"
    "只输出用 <<<TOPIC>>> 和 <<<END>>> 包裹的主题词，不要任何其它内容。"
)


@dataclass
class NotePlan:
    source: Path
    source_id: str
    title: str
    topic: str
    target: Path
    asset_dir: Path | None
    target_asset_dir: Path | None


def extract_source_id(path: Path, content: str) -> str | None:
    """Recover the 8-hex source id from the name, marker, or frontmatter URL."""
    match = _SOURCE_ID_SUFFIX.search(path.name)
    if match:
        return match.group(1)
    marker = re.search(r"<!-- videomemo:source:([0-9a-f]{8}) -->", content)
    if marker:
        return marker.group(1)
    match = _FRONTMATTER_SOURCE.search(content)
    if match:
        try:
            url = json.loads(match.group(1))
        except ValueError:
            return None
        return hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
    return None


def title_from_stem(path: Path, content: str) -> str:
    """Recover the AI title from the legacy ``<title>_<id>.md`` filename."""
    stem = re.sub(r"_([0-9a-f]{8})$", "", path.stem).replace("_", " ").strip(" .")
    if stem and stem != "videomemo":
        return stem
    match = re.search(r'^title:\s*(".*")\s*$', content, re.MULTILINE)
    if match:
        try:
            return json.loads(match.group(1)).strip() or "videomemo"
        except ValueError:
            pass
    return "videomemo"


def generated_region(content: str) -> str:
    """Return the text between the generated-region markers, else everything."""
    start = content.find(_GENERATED_START)
    end = content.find(_GENERATED_END)
    if start >= 0 and end > start:
        return content[start + len(_GENERATED_START):end]
    return content


def stamp_source_marker(content: str, source_id: str) -> str:
    """Ensure the source marker exists without breaking YAML frontmatter."""
    marker = _SOURCE_MARKER.format(source_id=source_id)
    if marker in content:
        return content
    if _GENERATED_START in content:
        return content.replace(_GENERATED_START, _GENERATED_START + "\n" + marker, 1)
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end >= 0:
            after = end + 4
            return content[:after] + "\n" + marker + content[after:]
    return marker + "\n" + content


def _classify_topic(
    text: str,
    *,
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> str:
    """Ask the LLM for a short topic word; returns "" when untagged."""
    model = (model or default_model()).strip()
    config = resolve_llm_config(model, api_key=api_key, base_url=base_url)
    client = _client(model, api_key=api_key, base_url=base_url)
    http_client = (
        httpx.Client(timeout=httpx.Timeout(llm_timeout()))
        if _uses_anthropic_messages()
        else None
    )
    try:
        response = _chat_completion(
            client,
            http_client=http_client,
            config=config,
            model=model,
            messages=[
                {"role": "system", "content": CLASSIFY_SYSTEM},
                {"role": "user", "content": text[:2400]},
            ],
            temperature=0.0,
            max_tokens=100,
        )
    finally:
        if http_client is not None:
            http_client.close()
    _, _, topic = _split_front_tags(response, "")
    return topic


def plan_migration(
    vault: Path,
    *,
    folder: str = "Video Memos",
    classify: Callable[[str], str] | None = None,
    topic_override: str = "",
    log: Callable[[str], None] = print,
) -> list[NotePlan]:
    """Compute the move plan; performs no filesystem changes."""
    vault = vault.expanduser().resolve()
    source_dir = _vault_folder(vault, folder)
    if not source_dir.is_dir():
        log(f"源文件夹不存在，无需迁移: {source_dir}")
        return []
    plans: list[NotePlan] = []
    targets: set[Path] = set()
    for note in sorted(source_dir.glob("*.md")):
        if note.name.endswith(".md.tmp") or _BACKUP_NAME.search(note.name):
            continue
        content = note.read_text(encoding="utf-8", errors="replace")
        source_id = extract_source_id(note, content)
        if not source_id:
            log(f"跳过（无法确定来源 ID）: {note.name}")
            continue
        title = title_from_stem(note, content)
        if classify is not None:
            try:
                topic = _topic_folder_name(classify(generated_region(content)))
            except Exception as error:
                log(f"主题识别失败，将放入 Vault 根目录（{note.name}）: {error}")
                topic = ""
        else:
            topic = _topic_folder_name(topic_override)
        target_dir = _vault_folder(vault, topic) if topic else vault
        stem = _safe_name(title)
        target = target_dir / f"{stem}.md"
        if target in targets or target.is_file():
            target = target_dir / f"{stem}_{source_id}.md"
        if target in targets or target.is_file():
            for index in range(2, 100):
                candidate = target_dir / f"{stem}_{source_id}_{index}.md"
                if candidate not in targets and not candidate.is_file():
                    target = candidate
                    break
        targets.add(target)
        legacy_assets = source_dir / "assets" / source_id
        if legacy_assets.is_dir():
            plans.append(
                NotePlan(
                    source=note,
                    source_id=source_id,
                    title=title,
                    topic=topic,
                    target=target,
                    asset_dir=legacy_assets,
                    target_asset_dir=target_dir / "assets" / source_id,
                )
            )
        else:
            plans.append(
                NotePlan(
                    source=note,
                    source_id=source_id,
                    title=title,
                    topic=topic,
                    target=target,
                    asset_dir=None,
                    target_asset_dir=None,
                )
            )
    return plans


def apply_plan(plan: NotePlan, vault: Path) -> None:
    """Execute one planned move: content, embeds, attachments, marker."""
    content = plan.source.read_text(encoding="utf-8", errors="replace")
    legacy_prefix = f"![[{(plan.source.parent / 'assets' / plan.source_id).relative_to(vault).as_posix()}/"
    new_prefix = f"![[{(plan.target.parent / 'assets' / plan.source_id).relative_to(vault).as_posix()}/"
    content = content.replace(legacy_prefix, new_prefix)
    content = stamp_source_marker(content, plan.source_id)
    plan.target.parent.mkdir(parents=True, exist_ok=True)
    temporary = plan.target.with_suffix(".md.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(plan.target)
    if plan.asset_dir and plan.asset_dir.is_dir():
        if plan.target_asset_dir and not plan.target_asset_dir.exists():
            shutil.move(str(plan.asset_dir), str(plan.target_asset_dir))
        else:
            plan.target_asset_dir.mkdir(parents=True, exist_ok=True)
            for frame in sorted(plan.asset_dir.glob("frame_*.jpg")):
                dest = plan.target_asset_dir / frame.name
                if not dest.exists():
                    shutil.copy2(frame, dest)
            shutil.rmtree(plan.asset_dir)
    plan.source.unlink()


def cleanup_source_dir(source_dir: Path, *, log: Callable[[str], None] = print) -> None:
    """Remove the emptied legacy folder; report anything left behind."""
    if not source_dir.is_dir():
        return
    assets = source_dir / "assets"
    if assets.is_dir():
        try:
            assets.rmdir()
        except OSError:
            pass
    try:
        source_dir.rmdir()
        log(f"已删除空文件夹: {source_dir}")
    except OSError:
        remaining = sorted(source_dir.rglob("*"))
        log(f"{source_dir} 仍保留 {len(remaining)} 项（备份或未识别内容）:")
        for item in remaining[:15]:
            log(f"  {item.relative_to(source_dir)}")
        if len(remaining) > 15:
            log(f"  … 以及另外 {len(remaining) - 15} 项")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="把旧版 Video Memos 笔记迁移为按主题归档")
    p.add_argument("--vault", required=True, help="Obsidian Vault 根目录")
    p.add_argument(
        "--folder",
        default="Video Memos",
        help="旧笔记所在文件夹（默认 Video Memos）",
    )
    p.add_argument(
        "--topic",
        default="",
        help="为全部笔记指定主题文件夹，跳过 LLM 识别",
    )
    p.add_argument(
        "--no-llm",
        action="store_true",
        help="不调用 LLM，主题为空时放入 Vault 根目录",
    )
    p.add_argument("--llm-model", default=None, help="LLM 模型名")
    p.add_argument("--api-base-url", default=None, help="OpenAI 兼容 API 根地址")
    p.add_argument("--api-key", default=None, help="API Key")
    p.add_argument(
        "--apply",
        action="store_true",
        help="真正执行迁移；缺省只输出计划（dry-run）",
    )
    args = p.parse_args(argv)

    vault = Path(args.vault).expanduser().resolve()
    if not vault.is_dir():
        print(f"Vault 不存在: {vault}", file=sys.stderr)
        return 2

    classify: Callable[[str], str] | None = None
    if not args.no_llm and not args.topic:
        model = (args.llm_model or default_model()).strip()
        try:
            resolve_llm_config(model, api_key=args.api_key, base_url=args.api_base_url)
        except RuntimeError as error:
            print(f"无法识别主题：{error}", file=sys.stderr)
            print(
                "请配置 LLM_API_KEY / LLM_BASE_URL、项目 .env 或本机 Grok CLI，"
                "或改用 --topic 指定主题、--no-llm 跳过识别。",
                file=sys.stderr,
            )
            return 2
        classify = lambda text: _classify_topic(  # noqa: E731
            text,
            model=args.llm_model,
            api_key=args.api_key,
            base_url=args.api_base_url,
        )

    plans = plan_migration(
        vault,
        folder=args.folder,
        classify=classify,
        topic_override=args.topic,
    )
    if not plans:
        print("没有需要迁移的笔记。")
        return 0
    for plan in plans:
        location = f"{plan.topic or '(Vault 根目录)'}/"
        print(f"  {plan.source.relative_to(vault)}  →  {location}{plan.target.name}")
    if not args.apply:
        print(f"\n共 {len(plans)} 条迁移计划（dry-run，未改动任何文件）。加 --apply 执行。")
        return 0

    for plan in plans:
        try:
            apply_plan(plan, vault)
            print(f"已迁移: {plan.source.relative_to(vault)} → {plan.target.relative_to(vault)}")
        except OSError as error:
            print(f"迁移失败（{plan.source.name}）: {error}", file=sys.stderr)
    cleanup_source_dir(_vault_folder(vault, args.folder))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
