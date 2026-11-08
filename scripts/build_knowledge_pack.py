"""把「法律条例」抓取语料转成知识库资料包条目。

用法（在仓库根目录）：
    backend/.venv/Scripts/python.exe scripts/build_knowledge_pack.py [documents.jsonl]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORPUS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "法律条例" / "documents.jsonl"
PACK = ROOT / "backend" / "app" / "knowledge" / "data" / "zz.json"
CHECKED_AT = "2026-11-08"

ART = re.compile(r"第[一二三四五六七八九十百零〇]+条")
CLAUSE_START = re.compile(r"(第[一二三四五六七八九十百零〇]+条)")
_CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_to_int(text: str) -> int:
    """条款号转数字，用于生成稳定 ASCII id（第三十八条 → 38）。"""
    digits = text.replace("第", "").replace("条", "")
    if "百" in digits:
        head, _, tail = digits.partition("百")
        value = (_CN_DIGITS.get(head, 1) or 1) * 100
        if tail.startswith("十"):
            value += 10 * (_CN_DIGITS.get(tail[1:2], 0) or 0)
            value += _CN_DIGITS.get(tail[2:3], 0) if len(tail) > 2 else 0
        else:
            value += _CN_DIGITS.get(tail, 0) if tail else 0
        return value
    if "十" in digits:
        head, _, tail = digits.partition("十")
        # 「第十条」的 head 为空，按 10 处理，不能返回 0。
        value = (_CN_DIGITS.get(head, 0) or 0) * 10 if head else 10
        return value + (_CN_DIGITS.get(tail, 0) if tail else 0)
    return _CN_DIGITS.get(digits, 0)

# 只保留与合同、押金、维修、退租、经纪直接相关的条款；其余（备案、处罚、平台建设）不入库。
CLAUSE_KEYWORDS = [
    "押金", "租金", "维修", "退还", "扣减", "返还", "腾退", "转租", "隔断",
    "出租人", "承租人", "租赁合同", "违约", "暴力", "威胁", "单方", "提高租金",
    "装修", "拆改", "承重", "消防", "安全", "备案", "经纪机构", "收费", "虚假房源",
]
NEGATIVE_TOPICS = {"channel", "dispute"}


def load_corpus() -> list[dict]:
    rows = []
    for line in CORPUS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def clause_split(text: str) -> list[tuple[str, str]]:
    """按「第X条」切分，返回 (条款号, 正文)。跨段落时把碎片并回上一条。"""
    hits = list(CLAUSE_START.finditer(text))
    if not hits:
        return []
    out: list[tuple[str, str]] = []
    for index, hit in enumerate(hits):
        start = hit.start()
        end = hits[index + 1].start() if index + 1 < len(hits) else len(text)
        body = re.sub(r"\s+", " ", text[start:end]).strip()
        out.append((hit.group(1), body))
    merged: list[tuple[str, str]] = []
    for num, body in out:
        if merged:
            prev_num, prev_body = merged[-1]
            # 引用了同文件其他条号时会被误切；上一条未收尾则视为同一条的续文。
            dangling = not prev_body.endswith(("。", "；", "）", "”"))
            if len(body) <= len(num) + 2 or dangling:
                merged[-1] = (prev_num, f"{prev_body}{body}")
                continue
        merged.append((num, body))
    return merged


def guess_topics(text: str) -> list[str]:
    topics: set[str] = set()
    rules = [
        (("押金", "扣减", "返还", "退还"), "deposit"),
        (("租金",), "rent"),
        (("维修", "修复", "损坏"), "repair"),
        (("损耗", "磨损", "正常使用"), "wear"),
        (("返还", "腾退", "交还"), "return"),
        (("解除", "终止", "退租"), "termination"),
        (("涨租", "提高租金", "调整租金"), "rent_increase"),
        (("转租",), "sublease"),
        (("隔断", "非居住空间", "厨房", "卫生间", "阳台", "人均"), "safety"),
        (("装修", "拆改", "承重", "增设"), "alteration"),
        (("收回房屋", "恢复原状", "复原"), "restoration"),
        (("续租", "优先承租"), "renewal"),
        (("经纪", "中介", "收费", "佣金", "房源信息"), "brokerage"),
        (("备案",), "filing"),
    ]
    for words, topic in rules:
        if any(word in text for word in words):
            topics.add(topic)
    return sorted(topics)


TOPIC_KEYWORDS = {
    "deposit": ["押金", "押金退还", "扣押金", "扣减押金"],
    "rent": ["租金", "房租", "租金支付"],
    "repair": ["维修", "维修责任", "维修义务", "修复"],
    "wear": ["自然损耗", "正常使用", "磨损"],
    "return": ["返还房屋", "退租", "交还房屋", "腾退"],
    "termination": ["解除合同", "提前退租", "终止租赁"],
    "rent_increase": ["涨租", "单方涨租", "提高租金", "调整租金"],
    "sublease": ["转租", "二房东"],
    "safety": ["隔断房", "群租", "消防安全", "人均面积", "非居住空间"],
    "alteration": ["装修", "拆改", "改动结构", "增设设施"],
    "restoration": ["恢复原状", "复原"],
    "renewal": ["续租", "优先承租"],
    "brokerage": ["中介", "经纪机构", "佣金", "中介费", "虚假房源"],
    "filing": ["合同备案", "租赁备案"],
    "contract": ["租赁合同", "合同范本"],
    "channel": ["投诉", "咨询", "举报", "热线"],
    "dispute": ["纠纷", "维权", "争议"],
}


def guess_keywords(text: str) -> list[str]:
    pool = [
        "押金", "押金退还", "扣减押金", "租金", "租金支付", "维修义务", "维修责任",
        "房屋损坏", "自然损耗", "返还房屋", "腾退", "提前退租", "解除合同",
        "单方涨租", "提高租金", "转租", "隔断房", "群租", "消防安全", "装修",
        "恢复原状", "优先承租", "续租", "中介", "经纪机构", "佣金", "虚假房源",
        "合同备案", "违约", "暴力驱赶", "租赁合同范本", "资金监管", "租金贷",
    ]
    return [word for word in pool if word in text][:8] or ["住房租赁"]


def keywords_for(text: str, topics: list[str]) -> list[str]:
    """原文关键词 + 主题同义词：条款常用「单方面提高租金」这类表述，用户问「涨租」需能命中。"""
    words = list(guess_keywords(text))
    for topic in topics:
        for word in TOPIC_KEYWORDS.get(topic, []):
            if word not in words:
                words.append(word)
    return words[:10]


def summary_of(title: str, clause: str, limit: int = 90) -> str:
    body = clause.split(" ", 1)[1] if " " in clause else clause
    body = body.replace("　", " ").strip()
    return f"{title}：{body}"[:limit]


def entry(
    *,
    entry_id: str,
    title: str,
    publisher: str,
    url: str,
    scope: str,
    city_code: str,
    effective_from: str | None,
    effective_to: str | None,
    version: str,
    topics: list[str],
    keywords: list[str],
    text: str,
    summary: str = "",
    limitations: str = "",
    channel: dict | None = None,
) -> dict:
    data = {
        "id": entry_id,
        "title": title,
        "publisher": publisher,
        "url": url,
        "scope": scope,
        "cityCode": city_code,
        "effectiveFrom": effective_from,
        "effectiveTo": effective_to,
        "version": version,
        "checkedAt": CHECKED_AT,
        "reviewStatus": "approved",
        "topics": topics,
        "keywords": keywords,
        "text": text,
        "summary": summary,
        "limitations": limitations,
    }
    if channel:
        data["channel"] = channel
    return data


def main() -> int:
    rows = {row["doc_id"]: row for row in load_corpus()}
    by_prefix = {doc_id[:10]: doc_id for doc_id in rows}

    def get(prefix: str) -> dict:
        return rows[by_prefix[prefix]]

    def src(row: dict) -> dict:
        return row.get("source") or {}

    entries: list[dict] = []

    # ---- 1. 郑州市住房租赁管理条例（地方性法规，按条拆分） ----
    row = get("9dfcc43d1e")
    text = row.get("text") or ""
    url = src(row)["url"]
    title = "郑州市住房租赁管理条例"
    version = "2026-08-01"
    for num, body in clause_split(text):
        if not any(word in body for word in CLAUSE_KEYWORDS):
            continue
        topics = guess_topics(body)
        if not topics:
            continue
        serial = cn_to_int(num)
        entries.append(
            entry(
                entry_id=f"zz-rent-reg-{serial}",
                title=f"{title} {num}",
                publisher=row["issuing_body"],
                url=url,
                scope="city",
                city_code="ZZ",
                effective_from=row.get("effective_date") or "2025-01-01",
                effective_to=None,
                version=version,
                topics=topics,
                keywords=keywords_for(body, topics),
                text=body,
                summary=summary_of(title, body),
                limitations="仅摘录该条原文，个案适用需结合合同全文与事实；不构成法律意见。",
            )
        )

    # ---- 2. 住房租赁条例（国务院行政法规，按条拆分） ----
    row = get("9dc2eaf3fc")
    text = row.get("text") or ""
    url = src(row)["url"]
    title = "住房租赁条例"
    for num, body in clause_split(text):
        if not any(word in body for word in CLAUSE_KEYWORDS):
            continue
        topics = guess_topics(body)
        if not topics:
            continue
        serial = cn_to_int(num)
        entries.append(
            entry(
                entry_id=f"cn-housing-lease-reg-{serial}",
                title=f"{title} {num}",
                publisher=row["issuing_body"],
                url=url,
                scope="national",
                city_code="CN",
                effective_from=row.get("effective_date") or "2025-09-15",
                effective_to=None,
                version=row.get("publish_date") or "2025-07-16",
                topics=topics,
                keywords=keywords_for(body, topics),
                text=body,
                summary=summary_of(title, body),
                limitations="仅摘录该条原文；地方执行口径以郑州规定为准，不构成法律意见。",
            )
        )

    # ---- 3. 商品房屋租赁管理办法（部门规章，按条拆分） ----
    row = get("d6a996292e")
    text = row.get("text") or ""
    url = src(row)["url"]
    title = "商品房屋租赁管理办法"
    for num, body in clause_split(text):
        if not any(word in body for word in CLAUSE_KEYWORDS):
            continue
        topics = guess_topics(body)
        if not topics:
            continue
        serial = cn_to_int(num)
        entries.append(
            entry(
                entry_id=f"cn-commodity-lease-{serial}",
                title=f"{title} {num}",
                publisher=row["issuing_body"],
                url=url,
                scope="national",
                city_code="CN",
                effective_from=row.get("effective_date") or "2011-02-01",
                effective_to=None,
                version=row.get("publish_date") or "2010-12-01",
                topics=topics,
                keywords=keywords_for(body, topics),
                text=body,
                summary=summary_of(title, body),
                limitations="部门规章原文；2011 年施行，具体适用以现行法规为准，不构成法律意见。",
            )
        )

    # ---- 4. 郑州资金监管与押金上限（地方政策，整篇） ----
    row = get("89119d4493")
    entries.append(
        entry(
            entry_id="zz-fund-supervision-2025",
            title="关于进一步加强郑州市房屋租赁市场管理工作的通知",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2025-03-26",
            effective_to=None,
            version="2025-03-26",
            topics=["deposit", "rent", "filing"],
            keywords=["押金上限", "押金", "租金监管", "收取租金", "资金监管", "郑州"],
            text=(
                "三、强化住房租赁交易资金监管。住房租赁企业从事转租业务的，应遵守《条例》相关规定，"
                "按要求开设住房租赁交易资金监管专用账户。企业向承租人单次收取的租金金额一般不得超过3个月，"
                "收取的押金金额一般不得超过1个月租金，并按照规定通过资金监管专用账户纳入监管。"
                "押金托管和租金监管的具体规定，由市住房保障部门会同相关部门制定。"
            ),
            summary="郑州要求住房租赁企业单次收取租金一般不超过 3 个月、押金一般不超过 1 个月租金，并通过监管账户收付。",
            limitations="约束对象为从事转租经营的住房租赁企业，个人房东直租不直接适用；属政策要求，不构成法律意见。",
        )
    )

    # ---- 5. 郑州租赁合同范本（地方政策） ----
    row = get("d917f59fff")
    entries.append(
        entry(
            entry_id="zz-contract-template-2025",
            title="郑州市住房租赁合同范本（推广使用通知）",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2025-04-09",
            effective_to=None,
            version="2025-04-09",
            topics=["contract"],
            keywords=["合同范本", "住房租赁合同", "郑州", "示范文本", "签约"],
            text=(
                "为规范住房租赁市场，明确住房租赁双方的权利义务，合理引导住房租赁行为，维护租赁当事人合法权益，"
                "依据《中华人民共和国民法典》《中华人民共和国城市房地产管理法》《商品房屋租赁管理办法》"
                "《河南省房屋租赁管理办法》《郑州市住房租赁管理条例》等法律法规及有关规定，"
                "市住房保障和房地产管理局联合市市场监管局制定了《郑州市住房租赁合同》范本，现予以推广使用。"
                "本范本可在郑州市房屋租赁监管服务平台或郑州市住房保障和房地产管理局官方网站查阅、下载。"
            ),
            summary="郑州推广官方《住房租赁合同》范本，可在房屋租赁监管服务平台或房管局官网下载。",
            limitations="仅说明范本来源与推广要求，范本条款内容未在此摘录；不构成法律意见。",
        )
    )

    # ---- 6. 郑州经纪服务收费与禁止行为 ----
    row = get("46deeab6a3")
    entries.append(
        entry(
            entry_id="zz-broker-rules-2024",
            title="房地产经纪机构服务规则（郑州）",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2024-01-15",
            effective_to=None,
            version="2024-01-15",
            topics=["brokerage"],
            keywords=["中介费", "佣金", "经纪机构", "收费公示", "霸王条款", "郑州"],
            text=(
                "八、严格落实收费标准公示制度，倡导一站式服务和一次性收费；佣金、代理费（渠道费）收取比例应通过友好协商确定，"
                "不采用胁迫、垄断、捆绑等不正当手段高收费、乱收费，谋取不当利益。"
                "十四、不得利用格式合同对相对人作出不合理、不公正的约定。在执行居间业务时，保证公平、公正，不偏袒任何一方。"
                "投诉举报电话：67889725。"
            ),
            summary="郑州要求经纪机构公示收费标准、佣金协商确定，不得用格式合同作出不合理约定。",
            limitations="行业服务规则原文摘录，不直接产生民事权利义务；不构成法律意见。",
        )
    )

    # ---- 7. 郑州租房消费警示（押金克扣与维权渠道） ----
    row = get("5c09550394")
    entries.append(
        entry(
            entry_id="zz-rent-alert-2026-01",
            title="郑州市住房租赁消费警示（涉及变相克扣押金等违规）",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2026-01-20",
            effective_to=None,
            version="2026-01-20",
            topics=["deposit", "brokerage", "dispute"],
            keywords=["克扣押金", "押金", "隔断房", "违规企业", "12345", "郑州", "维权"],
            text=(
                "近期，我局结合2025年下半年全市房屋租赁信访投诉情况，排查出16家住房租赁企业存在严重违规行为，"
                "涉及变相克扣租房押金、房屋隔断出租、企业不备案、租赁合同不备案、未按要求开展住房租赁资金监管、"
                "推诿投诉调解等问题。二、签好合同是关键。推荐使用郑州市官方租房合同范本，仔细阅读租金支付周期、"
                "押金退还条件、违约责任等条款，口头承诺需书面写入合同，警惕“霸王条款”；明确房屋是否为隔断房、"
                "水电燃气计费标准、维修责任划分。三、留存凭证是保障。支付租金、押金等费用时，务必通过正规转账渠道，"
                "索要发票或加盖企业公章的收据，妥善保管聊天记录、合同、缴费凭证等材料。"
                "若遭遇违规侵权，及时固定证据，拨打12345政务服务热线或向当地房屋租赁管理部门投诉维权。"
            ),
            summary="郑州房管局提示：警惕变相克扣押金、隔断出租等问题；保留合同与付款凭证，可拨 12345 或向房管部门投诉。",
            limitations="消费警示不是法规，仅作风险提示与投诉指引；不承诺受理结果。",
        )
    )

    # ---- 8. 郑州毕业季住房租赁消费警示 ----
    row = get("7defe46138")
    entries.append(
        entry(
            entry_id="zz-rent-alert-2026-07",
            title="郑州市毕业季住房租赁消费警示",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2026-07-10",
            effective_to=None,
            version="2026-07-10",
            topics=["deposit", "safety", "dispute"],
            keywords=["克扣押金", "虚假房源", "隔断房", "租金贷", "12345", "郑州", "毕业生"],
            text=(
                "部分违规经营主体借机设置消费陷阱，引发虚假引流、克扣押金、强制清退、群租等各类纠纷。"
                "一、选择正规渠道，警惕低价引流。远离“高收低租、长收短付”托管机构。"
                "二、核验房屋权属，防范资金风险。签订租房合同前核验出租方身份证明、不动产权证，转租需提供原房东书面许可。"
                "三、规范签订合同，慎用租金贷。推荐使用郑州市官方租赁合同范本，将费用、维修、违约事项书面约定。"
                "四、实地查验房屋，规避安全隐患。不租住隔断房、群租房。"
                "五、留存交易凭证，依法维权。房屋交接时核对水电底数、留存房屋影像；租金押金转账并索取票据；"
                "遇矛盾纠纷可拨打12345或向房管部门反映，遭遇诈骗、被强行驱赶、人身安全受到威胁时及时报警。"
            ),
            summary="毕业季租房提示：警惕虚假引流与克扣押金，核验产权、书面约定费用维修违约，保留凭证，可拨 12345。",
            limitations="消费警示不是法规，仅作风险提示与投诉指引；不承诺受理结果。",
        )
    )

    # ---- 9. 郑州官方租赁平台与房源核验（争议渠道） ----
    row = get("9a91b43859")
    entries.append(
        entry(
            entry_id="zz-rent-platform",
            title="郑州市房屋租赁信息服务与监管平台（官方租房与合同备案渠道）",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2018-08-31",
            effective_to=None,
            version="2018-08-31",
            topics=["channel", "dispute", "filing"],
            keywords=["监管平台", "房源核验", "合同备案", "投诉", "郑州", "正规平台"],
            text=(
                "我市已按住建部要求建成并上线官方的房屋租赁信息服务与监管平台"
                "（http://www.zzfdc.gov.cn/），平台已实现住房租赁信息发布、房源信息核验、住房租赁网上签约、"
                "租赁合同网上登记备案、从业主体管理、信用评价、数据统计分析等功能。"
                "承租人在选取房源时应选取带有全市统一房源编号和二维码的房屋。"
                "如果发现房屋租赁企业存在行业违规行为，应及时向行业主管部门反映；"
                "如果发现房屋租赁企业存在欺诈等违法问题应及时向公安部门举报；"
                "如果租赁当事人在合同履行过程中发生争议，应由双方当事人协商解决，也可通过消费者协会等相关机构调解，"
                "或依法向房屋所在地的人民法院起诉，或提交仲裁委员会仲裁。"
            ),
            summary="郑州官方租赁平台可核验房源、网签与合同备案；违规可向房管部门反映，涉嫌欺诈向公安举报，争议可调解/仲裁/起诉。",
            limitations="平台功能以官方页面为准，具体受理条件与时效可能调整；不承诺处理结果。",
            channel={
                "id": "zz_regulation_platform",
                "title": "郑州市房屋租赁信息服务与监管平台",
                "eligibility": "local_verified",
                "responsibilities": ["房源核验", "住房租赁网上签约", "租赁合同网上登记备案", "从业主体管理", "信用评价"],
                "conditions": ["以官方平台公示的办理条件为准"],
                "materials": ["租赁合同", "身份证明", "房屋权属证明"],
            },
        )
    )

    # ---- 10. 郑州 12345 政务服务热线（争议渠道） ----
    row = get("7defe46138")
    entries.append(
        entry(
            entry_id="zz-hotline-12345",
            title="郑州市 12345 政务服务便民热线（租房纠纷投诉渠道）",
            publisher="郑州市住房保障和房地产管理局",
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2026-07-10",
            effective_to=None,
            version="2026-07-10",
            topics=["channel", "dispute"],
            keywords=["12345", "投诉", "热线", "押金", "郑州", "维权"],
            text=(
                "郑州市住房保障和房地产管理局在住房租赁消费警示中提示："
                "若遭遇违规侵权，及时固定证据，拨打12345政务服务热线或向当地房屋租赁管理部门投诉维权，"
                "切勿自认吃亏，依法维护自身合法权益。"
            ),
            summary="郑州房管局公开提示：租房纠纷可拨 12345 政务服务热线或向房屋租赁管理部门投诉。",
            limitations="热线受理范围与流程以当地公开口径为准；不承诺受理结果，不代为提交。",
            channel={
                "id": "zz_12345",
                "title": "郑州市 12345 政务服务便民热线",
                "eligibility": "local_verified",
                "responsibilities": ["受理住房租赁相关咨询、投诉与建议"],
                "conditions": ["按当地公开受理条件"],
                "materials": ["租赁合同", "付款凭证", "沟通记录", "房屋现状照片"],
            },
        )
    )

    # ---- 11. 郑州房管部门投诉与违规企业公示 ----
    row = get("0f7428dc55")
    entries.append(
        entry(
            entry_id="zz-housing-authority-complaint",
            title="郑州市住房保障和房地产管理局投诉举报与报案指引",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2023-11-16",
            effective_to=None,
            version="2023-11-16",
            topics=["channel", "dispute", "deposit"],
            keywords=["投诉", "举报", "房管部门", "押金", "跑路", "报案", "郑州"],
            text=(
                "个别不良住房租赁企业出现了恶意克扣租金押金，高进低出、长收短付，甚至跑路的违法违规行为。"
                "提醒广大住房租赁消费者可通过官方渠道（郑州市住房租赁监管服务平台）选择信用良好的住房租赁企业租房，"
                "查找已通过核验的真实租赁房源，谨慎签订住房租赁合同；"
                "如发现住房租赁企业违法违规行为，应及时向行业主管部门反映，"
                "发现涉嫌诈骗、企业跑路或强行、暴力驱赶租客等违法行为，应及时向公安部门报案。"
            ),
            summary="郑州房管局：企业违规向行业主管部门反映，涉嫌诈骗、跑路或暴力驱赶向公安报案。",
            limitations="属投诉指引，不是受理承诺；不构成法律意见。",
            channel={
                "id": "zz_housing_authority",
                "title": "郑州市住房保障和房地产管理局（行业投诉）",
                "eligibility": "local_verified",
                "responsibilities": ["受理住房租赁企业与经纪机构违规投诉"],
                "conditions": ["以官方公开的投诉渠道与受理条件为准"],
                "materials": ["租赁合同", "付款凭证", "沟通记录", "违规线索"],
            },
        )
    )

    # ---- 12. 经纪机构备案与实名查询（渠道核验） ----
    row = get("aa3ffba52f")
    entries.append(
        entry(
            entry_id="zz-broker-filing-check",
            title="郑州市房地产经纪机构备案与从业人员实名查询方式",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2025-09-09",
            effective_to=None,
            version="2025-09-09",
            topics=["channel", "brokerage", "dispute"],
            keywords=["中介备案", "经纪机构", "实名登记", "工作牌", "查询", "郑州"],
            text=(
                "（一）房地产经纪机构备案查询方式：1.通过郑州市住房保障和房地产管理局官网-政务公开→主动公开基本目录→"
                "公共监管→房地产市场监管-郑州市房地产经纪机构备案信息公示表（每月10日前更新一次）；"
                "2.通过郑州市住宅与房地产业协会官网-企业信用栏目查询；"
                "3.通过手机微信扫描房地产经纪机构备案证书二维码查询，如扫描结果与备案信息不一致或无信息显示，则该证书为无效。"
                "（二）房地产经纪从业人员信息查询方式：通过手机微信扫描其佩戴的工作牌二维码查看，"
                "如扫描结果与工作牌信息不一致或无信息显示，则该工作牌为无效。"
            ),
            summary="郑州可线上查询经纪机构备案与从业人员实名信息，扫码核对不一致即为无效。",
            limitations="查询入口可能调整，以官方页面为准；仅用于核验身份，不评价服务质量。",
            channel={
                "id": "zz_broker_filing",
                "title": "郑州市房地产经纪机构备案查询",
                "eligibility": "local_verified",
                "responsibilities": ["公示已备案经纪机构与从业人员实名信息"],
                "conditions": ["以官网与协会公示信息为准"],
                "materials": ["机构名称", "备案证书编号", "从业人员工作牌"],
            },
        )
    )

    # ---- 13. 郑州公租房与保租房管理边界（避免误用） ----
    row = get("6096f43ea9")
    entries.append(
        entry(
            entry_id="zz-affordable-rental-scope",
            title="郑州市保障性租赁住房管理办法（适用范围提示）",
            publisher=row["issuing_body"],
            url=src(row)["url"],
            scope="city",
            city_code="ZZ",
            effective_from="2024-08-14",
            effective_to=None,
            version="2024-08-14",
            topics=["contract", "dispute"],
            keywords=["保障性租赁住房", "公租房", "适用范围", "郑州"],
            text=(
                "第一条 为加强和规范全市保障性租赁住房管理工作，缓解新市民、青年人住房困难，"
                "根据国家和省有关规定，结合本市实际，制定本办法。"
            ),
            summary="郑州保障性租赁住房另有专门管理办法，市场租房合同纠纷不直接适用该办法。",
            limitations="仅用于说明适用边界，不摘录具体条款；具体资格与配租以官方公告为准。",
        )
    )

    # ---- 合并进资料包 ----
    existing = json.loads(PACK.read_text(encoding="utf-8"))
    court = [item for item in existing["entries"] if item["id"].startswith("cn-civil-")]
    merged: list[dict] = []
    seen: set[str] = set()
    for item in court + entries:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        merged.append(item)

    pack = {
        "cityCode": "ZZ",
        "cityName": "郑州",
        "version": "zz-2026.11.08.2",
        "coverage": "supported",
        "topicCoverage": {"contract_review": "supported", "dispute": "limited"},
        "checkedAt": CHECKED_AT,
        "entries": merged,
    }
    PACK.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"entries={len(merged)} (court={len(court)}, new={len(merged) - len(court)})")
    print(f"channels={sum(1 for item in merged if item.get('channel'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
