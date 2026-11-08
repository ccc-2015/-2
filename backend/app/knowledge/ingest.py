"""把审核 JSON 资料包同步到 PostgreSQL/pgvector。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..config import get_settings
from .postgres import PostgresKnowledgeStore
from .store import DATA_DIR
from .validate import validate_pack


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="导入知识库资料包到 PostgreSQL")
    parser.add_argument("path", nargs="?", default=str(DATA_DIR), help="资料包文件或目录，默认 app/knowledge/data")
    parser.add_argument("--no-embed", action="store_true", help="只写库，不生成 embedding")
    args = parser.parse_args(argv)

    path = Path(args.path)
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    if not files:
        print(f"没有找到资料文件：{path}")
        return 1

    packs = []
    failed = False
    for file in files:
        pack, errors = validate_pack(file)
        if errors:
            failed = True
            print(f"FAIL {file.name}")
            for error in errors:
                print(f"  - {error}")
        if pack:
            packs.append(pack)
    if failed:
        return 1
    if not packs:
        print("没有可导入的资料包。")
        return 1

    settings = get_settings()
    if not settings.database_url.strip():
        print("DATABASE_URL 未配置，无法导入 PostgreSQL。")
        return 1

    store = PostgresKnowledgeStore(settings.database_url)
    embed = not args.no_embed and settings.embedding_configured
    count = store.ingest_packs(packs, embed=embed)
    print(
        f"ingested packs={len(packs)} entries={count} "
        f"embedding={'on' if embed else 'off'} "
        f"model={settings.embedding_configured_name or '-'} dim={settings.embedding_dim}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
