"""确定性议题分组：从合同条款生成检索议题，供多路召回使用。

规则必须与 site/functions/lib/topics.ts 保持一致；两边不一致会让同一份合同
在两种运行形态下召回不同议题。首期只做关键词与条款归并，不增加规划模型。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .models import KnowledgeEntry

# 九个固定主题 + 至多一个未分类主题；不按命中排名丢弃已识别主题。
MAX_GROUPS = 10
MAX_QUERY_CHARS = 2000
MAX_EVIDENCE = 12
EVIDENCE_CHAR_BUDGET = 6000
GROUP_TOP_K = 5
LEGACY_ID = "legacy"
LEGACY_LABEL = "通用匹配"


@dataclass(frozen=True)
class TopicRule:
    id: str
    label: str
    query: str
    keywords: tuple[str, ...]


TOPIC_RULES: tuple[TopicRule, ...] = (
    TopicRule(
        "deposit",
        "押金与扣减",
        "押金 保证金 定金 退还 扣减 扣除 抵扣 押金退还 扣减押金 无正当理由",
        ("押金", "保证金", "定金", "押一付三", "退还押金", "押金不退", "扣押金", "扣减", "扣除", "抵扣"),
    ),
    TopicRule(
        "rent_fees",
        "租金与附加费用",
        "租金 房租 涨租 逾期 滞纳金 违约金 水电费 物业费 附加费用",
        ("租金", "房租", "月租", "涨租", "涨价", "调租", "单方调整", "滞纳金", "逾期", "违约金", "水电费", "物业费", "保洁费", "服务费", "管理费", "取暖费", "网费", "维修基金"),
    ),
    TopicRule(
        "repair",
        "维修与自然损耗",
        "维修 修缮 损坏 自然损耗 折旧 设施 维护",
        ("维修", "修缮", "修理", "损坏", "自然损耗", "正常损耗", "损耗", "折旧", "老化", "维护", "更换", "设施"),
    ),
    TopicRule(
        "termination",
        "提前解除与违约责任",
        "提前解除 退租 终止 违约 违约金 解约",
        ("解除", "终止", "退租", "提前退", "违约", "违约金", "解约", "撤租", "不租了"),
    ),
    TopicRule(
        "entry_use",
        "入户与房屋使用",
        "入户 上门 进入 擅自进入 安全检查 房屋使用 隔断 群租 装修 恢复原状 安全 人均面积 使用面积 居住人数",
        ("入户", "进入", "上门", "看房", "检查", "居住", "使用", "群租", "隔断", "合租", "人数", "消防", "燃气", "安全", "装修", "改造", "恢复原状"),
    ),
    TopicRule(
        "sublease",
        "转租与续租",
        "转租 转让 分租 续租 续签 优先承租",
        ("转租", "转让", "分租", "换租", "续租", "续签", "优先承租", "优先续租"),
    ),
    TopicRule(
        "identity",
        "出租主体与权属",
        "出租人 产权 房产证 权属证明 身份证明 房屋所有权 出租权利 委托",
        ("房产证", "产权", "权属", "出租人", "二房东", "转租权", "身份证", "委托", "房东身份", "房屋所有权"),
    ),
    TopicRule(
        "broker_filing",
        "中介、备案与示范文本",
        "中介 经纪 佣金 备案 合同备案 租赁备案 登记备案 登记 网签 示范文本 明码标价 收费 收费事项 收费项目 收费标准 公示 营业执照",
        ("中介", "经纪", "佣金", "服务费", "备案", "登记", "网签", "示范文本", "租赁合同备案"),
    ),
    TopicRule(
        "handover",
        "退房交接与返还",
        "退房 交接 验收 返还 腾退 钥匙 水电表",
        ("交房", "退房", "交接", "验收", "返还", "腾退", "清单", "钥匙", "水电表"),
    ),
)

GENERAL_RULE = TopicRule(
    "general",
    "未分类条款",
    "",
    (),
)

_RULES_BY_ID = {rule.id: rule for rule in TOPIC_RULES}


def group_for_issue(issue: str, groups: list["IssuePlan"]) -> "IssuePlan | None":
    """按问题原文匹配议题，不据此认定法律支持或补充引用。"""
    best: IssuePlan | None = None
    best_score = 0
    for group in groups:
        rule = _RULES_BY_ID.get(group.id)
        if rule is None:
            continue
        score = _score(issue, rule)
        if score > best_score:
            best, best_score = group, score
    return best


def evidence_snippet(entry: KnowledgeEntry) -> str:
    """返回完整逐字依据，避免截断适用条件。"""
    return entry.text.strip()

_CLAUSE_RE = re.compile(r"(?=第[一二三四五六七八九十百零〇\d]{1,8}条)")
_LINE_RE = re.compile(r"\n+")

# 仅接受句首/条号后的身份陈述；逗号只延续同一句，不把“若……，……”当事实。
_SUBJECT_SENTENCE_RE = re.compile(r"[。；;.!！\r\n]+")
_SUBJECT_PREFIX_RE = re.compile(r"^第[一二三四五六七八九十百零〇\d]{1,8}条[ \t\u3000]*")
_SUBJECT_ROLE = r"(?:(?:出租人|出租方|房东)(?:[（(]甲方[）)])?|甲方[（(](?:出租人|出租方|房东)[）)]|甲方)"
_SUBJECT_NEGATION = r"(?:并不属于|并不是|不属于|并非|不是|不为|非)"
_SUBJECT_DECLARATION_RE = re.compile(
    rf"^({_SUBJECT_ROLE})[ \t\u3000]*(?:身份|性质|类型)?[ \t\u3000]*"
    rf"(?:[:：][ \t\u3000]*)?({_SUBJECT_NEGATION}|属于|为|是|系|[:：])[ \t\u3000]*(.+)$"
)
_SUBJECT_NEGATION_RE = re.compile(rf"^{_SUBJECT_NEGATION}$")
_SUBJECT_NEGATED_IDENTITY_RE = re.compile(rf"^({_SUBJECT_NEGATION})(.+)$")
_SUBJECT_CONTINUATION_RE = re.compile(rf"^(?:但|而)?({_SUBJECT_NEGATION}.+)$")
_SUBJECT_UNCERTAIN_RE = re.compile(
    r"[?？/／]|或者|或为|或是|(?:^|[，,])[ \t\u3000]*或|是否|可能|待定|待确认|假设|例如|示例|不属实|不成立|有误|并非如此"
)
# 自然人房东主动出租自有住房的自然表述；排除代理人、员工等转述主体。
_SUBJECT_NATURAL_RE = re.compile(
    r"^(?:该|本)?(?:自然人房东|个人房东)"
    r"(?!的?(?:代理人|代表|受托人|亲属|员工|负责人))"
    r"([^，。；]{0,60}?)(?:直接出租|直租|对外出租|出租)"
)
_SUBJECT_NATURAL_BLOCK_RE = re.compile(r"(?:不得|禁止|不能|无权|未|没有|并非|不是)")
# 甲方声明为企业并实际从事租赁经营，才确认其出租主体身份。
_SUBJECT_OPERATION_RE = re.compile(r"(?:从事|经营|开展|专业|专门)[^，。；]{0,12}(?:转租|租赁)")
_SUBJECT_TYPES = {
    "个人房东": "private", "自然人房东": "private", "自然人": "private", "个人": "private",
    "住房租赁企业": "enterprise", "房屋租赁企业": "enterprise",
    "中介机构": "intermediary", "中介公司": "intermediary", "房地产经纪机构": "intermediary",
    "住房租赁经纪机构": "intermediary", "房屋租赁经纪机构": "intermediary",
}


def infer_contract_subject(text: str) -> str:
    """从明确出租方声明保守推断；否定不反推身份，多类/自相矛盾均未知。"""
    positive: set[str] = set()
    negative: set[str] = set()
    confirmed: set[str] = set()
    for sentence in _SUBJECT_SENTENCE_RE.split(text or ""):
        sentence = _SUBJECT_PREFIX_RE.sub("", sentence.strip())
        if _SUBJECT_UNCERTAIN_RE.search(sentence):
            if _SUBJECT_DECLARATION_RE.match(sentence.strip()) or _SUBJECT_NATURAL_RE.match(sentence):
                return "unknown"
        natural = _SUBJECT_NATURAL_RE.match(sentence)
        if natural and not _SUBJECT_NATURAL_BLOCK_RE.search(natural[1]):
            positive.add("private")
            confirmed.add("private")
        fields = [field.strip() for field in re.split(r"[，,]", sentence)]
        if not _SUBJECT_DECLARATION_RE.match(fields[0]):
            continue
        if _SUBJECT_UNCERTAIN_RE.search(sentence):
            return "unknown"
        sentence_positive: set[str] = set()
        previous_role = ""
        for field in fields:
            continuation = _SUBJECT_CONTINUATION_RE.match(field)
            if continuation and previous_role:
                field = previous_role + continuation[1]
            match = _SUBJECT_DECLARATION_RE.match(field)
            if match is None:
                continue
            role, operator, identity = match.groups()
            previous_role = role
            identity = identity.strip()
            negated = bool(_SUBJECT_NEGATION_RE.fullmatch(operator))
            nested_negation = _SUBJECT_NEGATED_IDENTITY_RE.match(identity)
            if nested_negation:
                if negated:  # 双重否定不作为确定身份。
                    return "unknown"
                negated = True
                identity = nested_negation[2].strip()
            # 整个字段必须是白名单身份，不匹配“企业员工”“个人房东代理人”“企业时”。
            subject = _SUBJECT_TYPES.get(identity)
            if negated and identity in ("企业", "公司"):
                subject = "enterprise"  # 否定企业身份可排除企业，但正向泛称不能确认住房租赁企业。
            if subject is None:
                continue
            if negated:
                negative.add(subject)
            else:
                positive.add(subject)
                sentence_positive.add(subject)
                # 裸“甲方”不必然是出租方；只有“房东”称谓本身能明确出租角色。
                if role != "甲方" or identity in ("个人房东", "自然人房东"):
                    confirmed.add(subject)
        if (
            sentence_positive == {"enterprise"}
            and _SUBJECT_OPERATION_RE.search(sentence)
        ):
            confirmed.add("enterprise")
    if len(positive) != 1:
        return "unknown"
    subject = next(iter(positive))
    return subject if subject in confirmed and subject not in negative else "unknown"


@dataclass
class IssuePlan:
    id: str
    label: str
    query: str
    matches: int = 0


@dataclass
class Selection:
    entries: list[KnowledgeEntry]
    source_groups: dict[str, list[str]]
    gaps: list[str]
    candidate_count: int


def _clauses(text: str) -> list[str]:
    parts = [part.strip() for part in _CLAUSE_RE.split(text or "") if part.strip()]
    if len(parts) <= 2:
        parts = [part.strip() for part in _LINE_RE.split(text or "") if part.strip()]
    return parts


def _score(text: str, rule: TopicRule) -> int:
    lowered = (text or "").lower()
    return sum(lowered.count(keyword.lower()) for keyword in rule.keywords)


def _snippet(text: str, rule: TopicRule, radius: int = 160) -> str:
    lowered = text.lower()
    index = -1
    for keyword in rule.keywords:
        index = lowered.find(keyword.lower())
        if index != -1:
            break
    if index == -1:
        return text[: radius * 2].strip()
    start = max(0, index - radius)
    end = min(len(text), index + radius)
    return text[start:end].strip()


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit]


def build_issue_plan(
    text: str,
    question: str = "",
    target: str = "",
    intent: str = "review",
) -> list[IssuePlan]:
    """按合同条款生成检索议题；review 扫描全文，ask/draft 聚焦目标条款与问题。"""
    if intent in ("ask", "suggest_revision", "draft_revision") and target.strip():
        scan_text = target
    else:
        scan_text = text
    clauses = _clauses(scan_text)
    planned: list[IssuePlan] = []
    general: IssuePlan | None = None

    matched_clauses: set[int] = set()
    for rule in TOPIC_RULES:
        scored = [(_score(clause, rule), index) for index, clause in enumerate(clauses)]
        contract_hits = sum(score for score, _ in scored)
        question_hits = _score(question, rule)
        total = contract_hits + question_hits
        if total <= 0:
            continue
        best = sorted(
            [(score, index) for score, index in scored if score > 0],
            key=lambda item: (-item[0], item[1]),
        )[:3]
        for _, index in best:
            matched_clauses.add(index)
        snippets = [_clip(_snippet(clauses[index], rule), 420) for _, index in best]
        query = "\n".join(part for part in (rule.query, *snippets, question) if part).strip()
        planned.append(IssuePlan(rule.id, rule.label, _clip(query, MAX_QUERY_CHARS), total))

    if intent == "review" or not planned:
        unmatched = [clause for index, clause in enumerate(clauses) if index not in matched_clauses]
        pool = unmatched if unmatched else clauses
        if pool and (unmatched or not planned):
            joined = "\n".join(pool)
            if len(joined) <= 1500:
                body = joined.strip()
            else:
                middle = len(joined) // 2
                body = "\n".join(
                    part.strip()
                    for part in (joined[:680], joined[middle - 340 : middle + 340], joined[-680:])
                    if part.strip()
                )
            query = "\n".join(part for part in (body, question) if part).strip()
            general = IssuePlan(GENERAL_RULE.id, GENERAL_RULE.label, _clip(query, MAX_QUERY_CHARS), 1)

    if general is not None:
        planned.append(general)
    planned.sort(key=lambda item: (-item.matches, item.id))
    return planned


def merge_group_results(
    groups: list[IssuePlan],
    results: list[list[KnowledgeEntry]],
    max_evidence: int = MAX_EVIDENCE,
    char_budget: int = EVIDENCE_CHAR_BUDGET,
) -> Selection:
    """组间轮转合并：先保证每个议题的代表项，再按预算追加，不截断单条原文。"""
    seen_ids: set[str] = set()
    text_to_id: dict[str, str] = {}
    source_groups: dict[str, list[str]] = {}
    selected: list[KnowledgeEntry] = []
    chars = 0
    candidate_ids = {entry.id for result in results for entry in result}

    max_rank = max((len(result) for result in results), default=0)
    for rank in range(max_rank):
        for result in results[:len(groups)]:
            if rank >= len(result):
                continue
            entry = result[rank]
            key = re.sub(r"\s+", "", entry.text)
            if entry.id in seen_ids or key in text_to_id:
                continue
            if len(selected) >= max_evidence or chars + len(entry.text) > char_budget:
                continue
            seen_ids.add(entry.id)
            text_to_id[key] = entry.id
            source_groups[entry.id] = []
            selected.append(entry)
            chars += len(entry.text)

    # 必须回看所有候选：满额后的关联，以及先因预算跳过、后由同文短条保留的关联。
    for plan, result in zip(groups, results):
        for entry in result:
            retained_id = entry.id if entry.id in seen_ids else text_to_id.get(re.sub(r"\s+", "", entry.text))
            if retained_id is not None:
                labels = source_groups[retained_id]
                if plan.label not in labels:
                    labels.append(plan.label)

    covered = {label for labels in source_groups.values() for label in labels}
    gaps = [plan.label for plan in groups if plan.label not in covered]
    return Selection(
        entries=selected,
        source_groups=source_groups,
        gaps=gaps,
        candidate_count=len(candidate_ids),
    )