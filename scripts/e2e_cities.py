"""端到端检查：三城 + 全国的合同审查与争议诊断，验证来源城市不串联。

用法（在 backend 目录）：
    ./.venv/Scripts/python.exe ../scripts/e2e_cities.py

会真实调用文字模型，耗时约数分钟；不写入任何数据。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.knowledge import knowledge_store  # noqa: E402
from app.schemas import AnalyzeContractInput, DiagnoseDisputeInput  # noqa: E402
from app.services.contract import analyze_contract  # noqa: E402
from app.services.dispute import diagnose_dispute  # noqa: E402

CONTRACT = """房屋租赁合同
出租方（甲方）：张某
承租方（乙方）：李某
第一条 房屋位于本市某小区 3 号楼 502，建筑面积 60 平方米。
第二条 租期一年，自 2026 年 1 月 1 日至 2026 年 12 月 31 日。
第三条 月租金 3000 元，押二付一，押金 6000 元。
第四条 租赁期间房屋及家电维修由乙方自行负责并承担费用。
第五条 乙方提前退租的，押金不予退还。
第六条 甲方有权随时进入房屋检查。
"""

CITIES = ["ZZ", "WH", "HZ", "CN"]
OWN = {"ZZ": ("zz-", "hn-"), "WH": ("wh-",), "HZ": ("hz-", "zj-"), "CN": ()}


def foreign_ids(ids: list[str], city: str) -> list[str]:
    own = OWN[city]
    return [i for i in ids if not i.startswith("cn-") and not i.startswith(own)]


async def run_city(city: str) -> bool:
    ok = True
    contract = await analyze_contract(
        AnalyzeContractInput(text=CONTRACT, intent="review", cityCode=city, eventDate="2026-11-12")
    )
    refs = [ref.id for ref in contract.result.references]
    bad = foreign_ids(refs, city)
    print(
        f"[{city}] 合同审查 coverage={contract.result.coverage} 风险={len(contract.result.findings)} "
        f"引用={refs} 版本={contract.knowledge_version}"
    )
    if bad:
        print(f"  !! 串城条目：{bad}")
        ok = False

    dispute = await diagnose_dispute(
        DiagnoseDisputeInput(
            cityCode=city,
            issue="房东以墙面有划痕为由不退押金",
            facts="退租时房屋正常使用，墙面有轻微使用痕迹，合同约定押二付一。",
            goal="要回押金",
            priorAction="已与房东协商无果",
            counterparty="个人房东",
            eventDate="2026-11-12",
        )
    )
    src_ids = [ref.id for ref in dispute.result.references]
    bad2 = foreign_ids(src_ids, city)
    print(
        f"[{city}] 争议诊断 coverage={dispute.coverage} 方向={len(dispute.result.recommendations)} "
        f"引用={src_ids}"
    )
    if bad2:
        print(f"  !! 串城条目：{bad2}")
        ok = False
    if dispute.coverage == "unsupported":
        print("  !! 覆盖为 unsupported")
        ok = False
    return ok


async def main() -> int:
    print("知识库版本：", {city: knowledge_store.version_for(city) for city in CITIES})
    results = {}
    for city in CITIES:
        try:
            results[city] = await run_city(city)
        except Exception as exc:  # 打印后继续跑其他城市
            print(f"[{city}] 失败：{type(exc).__name__}: {exc}")
            results[city] = False
    print("结果：", results)
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
