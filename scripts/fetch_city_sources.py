"""抓取武汉、杭州官方租房资料，生成 draft 条目（不入检索库）。

用法（在仓库根目录）：
    backend/.venv/Scripts/python.exe scripts/fetch_city_sources.py wh
    backend/.venv/Scripts/python.exe scripts/fetch_city_sources.py hz

只抓 SOURCES 中登记过的官方 URL；正文解析后按「第X条」拆分，套用与郑州相同的
主题/关键词规则，命中不了的条文直接丢弃。产出：
    backend/app/knowledge/sources/raw/<city>/<key>.html   原文快照
    backend/app/knowledge/sources/drafts/<city>.json      draft 资料包（reviewStatus=draft）
draft 包不会被后端加载，人工确认后再提升为 approved。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "backend" / "app" / "knowledge" / "sources"
sys.path.insert(0, str(ROOT / "scripts"))

from build_knowledge_pack import (  # noqa: E402
    CLAUSE_KEYWORDS,
    clause_split,
    cn_to_int,
    guess_keywords,
    guess_topics,
    keywords_for,
    summary_of,
)

CITY = {
    "wh": {"code": "WH", "name": "武汉"},
    "hz": {"code": "HZ", "name": "杭州"},
}

# 只登记官方来源：政府门户、人大、法院、省级部门。
SOURCES = {
    "wh": [
        {
            "key": "wh-rent-reg",
            "prefix": "wh-rent-reg",
            "title": "武汉市住房租赁条例",
            "url": "http://www.whrd.gov.cn/html/rdlz/lfgz/dfxfg/2024/0704/25344.html",
            "publisher": "武汉市人民代表大会常务委员会",
            "docNumber": "武汉市人民代表大会常务委员会公告（十五届）第二十一号",
            "publishDate": "2024-07-04",
            "effectiveFrom": "2024-09-01",
            "scope": "city",
            "note": "2024-04-18 市十五届人大常委会第十七次会议通过，2024-05-29 湖北省十四届人大常委会第十次会议批准。",
        },
        {
            "key": "wh-rent-measure",
            "prefix": "wh-rent-measure",
            "title": "武汉市房屋租赁管理办法",
            "url": "https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzdfzwgz/201903/t20190319_142692.html",
            "publisher": "武汉市人民政府",
            "docNumber": "武汉市人民政府令第214号（经第312号第四次修改）",
            "publishDate": "2011-01-10",
            "effectiveFrom": "2011-03-15",
            "scope": "city",
            "note": "司法部网站收录的市政府规章文本（含 2018 年修正）；2022 年令第312号仅删去第二十六条第九项及第三十四条第二项部分表述。",
            "anchor": "武汉市房屋租赁管理办法",
        },
    ],
    "hz": [
        {
            "key": "zj-rent-security",
            "prefix": "zj-rent-security",
            "title": "浙江省居住房屋出租治安管理办法",
            "url": "https://gat.zj.gov.cn/col/col1229098252/art/2026/art_6b2121f9c1bf4b43bae34d2ff9c70112.html",
            "publisher": "浙江省人民政府",
            "docNumber": "浙江省人民政府令第415号",
            "publishDate": "2026-03-29",
            "effectiveFrom": "2026-06-01",
            "scope": "province",
            "note": "浙江省公安厅政务公开页发布；同时废止 2010 年《浙江省居住房屋出租登记管理办法》。",
        },
        {
            "key": "hz-rent-security",
            "prefix": "hz-rent-security",
            "title": "杭州市居住房屋出租安全管理若干规定",
            "url": "https://hznews.hangzhou.com.cn/xinzheng/swwj/content/2015-11/30/content_5998771.htm",
            "publisher": "杭州市人民政府",
            "docNumber": "杭州市人民政府令第287号",
            "publishDate": "2015-11-20",
            "effectiveFrom": "2016-01-01",
            "scope": "city",
            "note": "杭州网（杭州市属官方新闻门户）发布的市政府规章全文；2015-10-29 市政府第51次常务会议审议通过。",
        },
    ],
}

MIN_TEXT = 40
# 城市争议/办事渠道：只登记已核实可达、页面上能查到对应信息的官方入口。
CHANNELS = {
    "wh": [
        {
            "id": "wh-housing-authority",
            "title": "武汉市住房和城市更新局（住房租赁投诉与政策咨询）",
            "url": "https://zgj.wuhan.gov.cn/",
            "publisher": "武汉市住房和城市更新局",
            "version": "2026-11-12",
            "text": "武汉市住房和城市更新局负责住房保障、房屋租赁等监督管理。官网公示：地址武汉市江岸区高雄路166号，电话 027-85482100；扫黑除恶举报电话 027-85482775。住房租赁投诉可先拨市级电话，再按属地转接。",
            "summary": "武汉住房租赁行业投诉与政策咨询：027-85482100（市级，按属地转接）。",
            "limitations": "受理范围与办理时限以官方公开信息为准；不承诺受理结果。",
            "keywords": ["武汉", "房管局", "住房和城市更新局", "投诉", "咨询", "027-85482100"],
            "channel": {
                "id": "wh_housing_authority",
                "title": "武汉市住房和城市更新局（行业投诉）",
                "eligibility": "local_verified",
                "responsibilities": ["住房租赁政策咨询与投诉", "市级电话 027-85482100，按属地转接"],
                "conditions": ["以官方公开的投诉渠道与受理条件为准"],
                "materials": ["租赁合同", "付款凭证", "沟通记录", "违规线索"],
            },
        }
    ],
    "hz": [
        {
            "id": "hz-rent-complaint",
            "title": "杭州市住房租赁公众服务平台（咨询投诉）",
            "url": "https://zwfw.fgj.hangzhou.gov.cn/hzzl/webrent/2022/user/webcomplaintsinfo.jsp",
            "publisher": "杭州市住房保障和房产管理局",
            "version": "2026-11-12",
            "text": "杭州市住房租赁公众服务平台的「咨询投诉」栏目，集中公布全市住房租赁合同备案咨询电话、各区房屋租赁登记备案窗口地址与工作时间、以及各区房屋租赁投诉电话；可通过该页面查询并提交咨询投诉。",
            "summary": "杭州租赁投诉入口，页面附区级备案咨询与投诉电话。",
            "limitations": "受理范围与办理时限以页面公示为准；不承诺受理结果。",
            "keywords": ["杭州", "投诉", "咨询", "备案电话", "租赁平台"],
            "channel": {
                "id": "hz_rent_complaint",
                "title": "杭州市住房租赁公众服务平台（咨询投诉）",
                "eligibility": "local_verified",
                "responsibilities": ["住房租赁咨询与投诉", "区级备案窗口与投诉电话查询"],
                "conditions": ["以页面公示的区级受理口径为准"],
                "materials": ["租赁合同", "付款凭证", "沟通记录", "房屋地址"],
            },
        },
        {
            "id": "hz-housing-authority",
            "title": "杭州市住房保障和房产管理局（住房租赁政策咨询与投诉）",
            "url": "https://fgj.hangzhou.gov.cn/",
            "publisher": "杭州市住房保障和房产管理局",
            "version": "2026-11-12",
            "text": "杭州市住房保障和房产管理局负责住房租赁市场监管。局联系方式 0571-87019188（见 2024 年住房租赁企业信用信息管理办法公告）；租赁合同网签与备案业务可拨打平台咨询 89830512，区级电话见平台「咨询投诉」页。",
            "summary": "杭州住保房管局 0571-87019188；网签备案咨询 89830512。",
            "limitations": "受理范围与办理时限以官方公开信息为准；不承诺受理结果。",
            "keywords": ["杭州", "住保房管局", "房管局", "投诉", "咨询", "87019188"],
            "channel": {
                "id": "hz_housing_authority",
                "title": "杭州市住房保障和房产管理局（行业投诉）",
                "eligibility": "local_verified",
                "responsibilities": ["住房租赁政策咨询与投诉", "局电话 0571-87019188"],
                "conditions": ["以官方公开的投诉渠道与受理条件为准"],
                "materials": ["租赁合同", "付款凭证", "沟通记录", "违规线索"],
            },
        },
        {
            "id": "hz-rent-platform",
            "title": "杭州市住房租赁公众服务平台（网签、备案与业务咨询）",
            "url": "https://zwfw.fgj.hangzhou.gov.cn/hzzl/webrent/projectlist.htm",
            "publisher": "杭州市住房保障和房产管理局",
            "version": "2026-11-12",
            "text": "杭州市住房租赁公众服务平台提供房源核验、租赁合同网签与登记备案，并可在平台办理机构开业申报、下载示范文本。平台页脚公布业务咨询电话 89830512。",
            "summary": "杭州租房网签、租赁合同备案与平台业务咨询入口。",
            "limitations": "电话与办理入口以平台页面公示为准；不承诺受理结果。",
            "keywords": ["杭州", "住房租赁平台", "网签", "备案", "咨询", "89830512"],
            "channel": {
                "id": "hz_rent_platform",
                "title": "杭州市住房租赁公众服务平台",
                "eligibility": "local_verified",
                "responsibilities": ["住房租赁合同网签", "租赁登记备案", "平台业务咨询（89830512）"],
                "conditions": ["以平台及区备案窗口公示为准"],
                "materials": ["租赁合同", "身份证明", "房屋权属证明"],
            },
        }
    ],
}
# 只收直接约束出租人/承租人的条文；部门职责、平台建设、施行日期等一律丢弃。
PARTY_TERMS = ("出租人", "承租人", "租赁当事人", "租赁合同", "押金", "租金", "维修", "转租", "腾退", "返还", "退租")
# 不含当事人字样、但直接约束出租条件的条文（隔断、最小出租单位、非居住空间等）也要保留。
CONDITION_TERMS = ("出租住房", "出租居住房屋", "最小出租单位", "不得出租", "人均", "非居住空间", "隔断", "厨房")


def fetch(url: str) -> tuple[str, bytes]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        charset = resp.headers.get_content_charset() or ""
    for enc in (charset, "utf-8", "gb18030"):
        if not enc:
            continue
        try:
            return raw.decode(enc), raw
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore"), raw


def html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&#160;", " ").replace("&amp;", "&")
    text = re.sub(r"&[a-z]+;", "", text)
    return re.sub(r"\s+", " ", text)


def build_entries(doc: dict, text: str, city_code: str) -> tuple[list[dict], list[str]]:
    clauses = clause_split(text)
    entries: list[dict] = []
    dropped: list[str] = []
    for num, body in clauses:
        body = re.sub(r"^" + re.escape(num) + r"\s*", "", body).strip()
        if len(body) < MIN_TEXT:
            dropped.append(f"{num}(过短)")
            continue
        if body.startswith("违反"):
            dropped.append(f"{num}(罚则)")
            continue
        if not any(term in body for term in PARTY_TERMS + CONDITION_TERMS):
            dropped.append(f"{num}(非当事人条款)")
            continue
        topics = guess_topics(body)
        if not topics:
            dropped.append(f"{num}(无主题)")
            continue
        if not any(word in body for word in CLAUSE_KEYWORDS):
            dropped.append(f"{num}(非租赁相关)")
            continue
        entries.append(
            {
                "id": f"{doc['prefix']}-{cn_to_int(num)}",
                "title": f"{doc['title']} {num}",
                "publisher": doc["publisher"],
                "url": doc["url"],
                "scope": doc["scope"],
                "cityCode": city_code,
                "effectiveFrom": doc["effectiveFrom"],
                "effectiveTo": None,
                "version": doc["publishDate"],
                "checkedAt": date.today().isoformat(),
                "reviewStatus": "draft",
                "topics": topics,
                "keywords": keywords_for(body, topics) or guess_keywords(body),
                "text": body,
                "summary": summary_of(doc["title"], f"{num} {body}"),
                "limitations": f"{doc['docNumber']}；{doc['note']} 仅摘录条文原文，不构成法律意见。",
            }
        )
    return entries, dropped


def main(argv: list[str]) -> int:
    city_key = (argv[1] if len(argv) > 1 else "").lower()
    if city_key not in SOURCES:
        print("用法：fetch_city_sources.py wh|hz")
        return 1

    city = CITY[city_key]
    raw_dir = SOURCES_DIR / "raw" / city_key
    draft_dir = SOURCES_DIR / "drafts"
    raw_dir.mkdir(parents=True, exist_ok=True)
    draft_dir.mkdir(parents=True, exist_ok=True)

    all_entries: list[dict] = []
    report: list[str] = []
    for doc in SOURCES[city_key]:
        try:
            html, raw = fetch(doc["url"])
        except Exception as exc:
            report.append(f"FAIL {doc['title']}：{type(exc).__name__} {exc}")
            continue
        snapshot = raw_dir / f"{doc['key']}.html"
        snapshot.write_bytes(raw)
        text = html_to_text(html)
        if doc.get("anchor"):
            pos = text.find(doc["anchor"])
            if pos >= 0:
                text = text[pos:]
        entries, dropped = build_entries(doc, text, city["code"])
        all_entries.extend(entries)
        report.append(
            f"{doc['title']}：抓取 {len(html)} 字符，入库 draft {len(entries)} 条，丢弃 {len(dropped)} 条"
            f"（{', '.join(dropped[:6])}{'…' if len(dropped) > 6 else ''}）"
            f" sha256={hashlib.sha256(raw).hexdigest()[:12]} → {snapshot.name}"
        )

    pack = {
        "cityCode": city["code"],
        "cityName": city["name"],
        "version": f"{city_key}-draft-{date.today().isoformat()}",
        "coverage": "limited",
        "topicCoverage": {"contract_review": "limited", "dispute": "limited"},
        "checkedAt": date.today().isoformat(),
        "entries": all_entries
        + [
            {
                "id": ch["id"],
                "title": ch["title"],
                "publisher": ch["publisher"],
                "url": ch["url"],
                "scope": "city",
                "cityCode": city["code"],
                "effectiveFrom": None,
                "effectiveTo": None,
                "version": ch["version"],
                "checkedAt": date.today().isoformat(),
                "reviewStatus": "draft",
                "topics": ["channel", "dispute", "filing"],
                "keywords": ch["keywords"],
                "text": ch["text"],
                "summary": ch["summary"],
                "limitations": ch["limitations"],
                "channel": ch["channel"],
            }
            for ch in CHANNELS.get(city_key, [])
        ],
    }
    out = draft_dir / f"{city_key}.json"
    out.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\n".join(report))
    print(f"draft：{out}（{len(all_entries)} 条）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
