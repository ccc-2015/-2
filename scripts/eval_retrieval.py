"""检索权重评估：在真实 PG 数据上比较向量/关键词融合权重。

用法（backend 目录）：
    ./.venv/Scripts/python.exe ../scripts/eval_retrieval.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import get_settings  # noqa: E402
from app.knowledge.embeddings import embed_query  # noqa: E402
from app.knowledge.postgres import PostgresKnowledgeStore  # noqa: E402

# (场景, query, 首选答案, 可接受答案集合)；可接受集合含首选与同主题的其他正解。
CASES = [
    ("contract_review", "提前退租押金不退 违约金过高", "cn-housing-lease-reg-10", {"cn-housing-lease-reg-10", "cn-civil-733", "zz-rent-reg-11"}),
    ("contract_review", "墙面被弄脏 房东扣押金", "cn-civil-710", {"cn-civil-710", "cn-civil-733", "cn-housing-lease-reg-10"}),
    ("contract_review", "房东单方面涨租金", "cn-commodity-lease-9", {"cn-commodity-lease-9", "cn-housing-lease-reg-44", "zz-rent-reg-33"}),
    ("contract_review", "房屋漏水 维修责任 谁承担", "cn-civil-713", {"cn-civil-713", "cn-civil-712", "cn-commodity-lease-9", "cn-housing-lease-reg-11"}),
    ("contract_review", "隔断房 群租 人均面积", "cn-housing-lease-reg-6", {"cn-housing-lease-reg-6", "zz-rent-reg-9"}),
    ("contract_review", "中介收佣金 收费标准 公示", "cn-housing-lease-reg-26", {"cn-housing-lease-reg-26", "cn-housing-lease-reg-25", "zz-broker-rules-2024", "cn-housing-lease-reg-44"}),
    ("contract_review", "押金最多能收几个月", "zz-fund-supervision-2025", {"zz-fund-supervision-2025", "cn-housing-lease-reg-10", "zz-rent-reg-25"}),
    ("contract_review", "合同要不要备案", "zz-rent-reg-12", {"zz-rent-reg-12", "cn-housing-lease-reg-8", "cn-commodity-lease-4", "cn-commodity-lease-16", "cn-commodity-lease-20"}),
    ("contract_review", "承租人能不能把房子转租出去", "cn-commodity-lease-11", {"cn-commodity-lease-11", "cn-housing-lease-reg-9", "zz-rent-reg-15"}),
    ("contract_review", "退租时房屋要恢复原状吗", "cn-civil-733", {"cn-civil-733", "cn-civil-715", "cn-commodity-lease-11", "cn-housing-lease-reg-12"}),
    ("contract_review", "房屋自然损耗 谁来修", "cn-civil-712", {"cn-civil-712", "cn-civil-710", "cn-commodity-lease-9"}),
    ("contract_review", "退租后押金多久必须退还", "cn-housing-lease-reg-10", {"cn-housing-lease-reg-10", "cn-civil-733", "zz-rent-reg-11"}),
    ("dispute", "押金不退 找哪个部门投诉", "zz-housing-authority-complaint", {"zz-housing-authority-complaint", "zz-hotline-12345", "zz-rent-platform"}),
    ("dispute", "中介跑路 去哪里报案", "zz-rent-platform", {"zz-rent-platform", "zz-housing-authority-complaint"}),
    ("dispute", "郑州 12345 热线", "zz-hotline-12345", {"zz-hotline-12345"}),
    ("dispute", "怎么查中介有没有备案", "zz-broker-filing-check", {"zz-broker-filing-check", "zz-rent-platform"}),
]


def rank(store, scenario: str, query: str, w_vec: float, w_kw: float, window: int = 24) -> list[str]:
    vector = embed_query(query)
    pairs = store._vector_rows("ZZ", None, scenario, vector, window)
    q = query.lower()
    scored = []
    for row, similarity in pairs:
        keyword = store._keyword_score(row, q)
        scored.append((similarity * w_vec + min(keyword, 24) / 24 * w_kw, row["id"]))
    scored.sort(reverse=True)
    return [entry_id for _, entry_id in scored]


def main() -> int:
    settings = get_settings()
    store = PostgresKnowledgeStore(settings.database_url)
    weights = [(1.00, 0.00), (0.80, 0.20), (0.65, 0.35), (0.50, 0.50), (0.00, 1.00)]
    print(f"cases={len(CASES)}")
    for window in (24, 40, 60):
        for w_vec, w_kw in weights:
            top1 = 0
            recall4 = 0
            misses: list[str] = []
            for scenario, query, primary, acceptable in CASES:
                ids = rank(store, scenario, query, w_vec, w_kw, window)
                if ids[:1] == [primary]:
                    top1 += 1
                if set(ids[:4]) & acceptable:
                    recall4 += 1
                else:
                    misses.append(f"{query} (accept {sorted(acceptable)}, got {ids[:4]})")
            print(
                f"win={window} vec={w_vec:.2f} kw={w_kw:.2f} "
                f"top1={top1}/{len(CASES)} recall4={recall4}/{len(CASES)}"
            )
            for miss in misses:
                print("   miss:", miss)
    return 0


if __name__ == "__main__":
    sys.exit(main())
