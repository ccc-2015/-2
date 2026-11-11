// 演示用示例数据：评委可一键填入，看清完整流程。只写本机存储，与真实录入同一条路径。
import { records, selection, utilities, type EvidenceRecord, type UtilityAccount } from "./store";
import { getRentalProfile, saveRentalProfile } from "../rental/profile";
import { setRegion } from "../../lib/region";

const SAMPLE_IDS = {
  records: ["zzyj-demo-signing", "zzyj-demo-meters", "zzyj-demo-walls", "zzyj-demo-repair", "zzyj-demo-notice", "zzyj-demo-handover"],
  water: "zzyj-demo-water",
  electricity: "zzyj-demo-electricity",
} as const;

function record(
  id: string,
  stage: EvidenceRecord["stage"],
  occurredAt: string,
  description: string,
  extra: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    id,
    stage,
    occurredAt,
    recordedAt: new Date().toISOString(),
    description,
    contractClause: "",
    materialName: "",
    materialType: "",
    materialStatus: "present",
    amountCents: null,
    reading: null,
    ...extra,
  };
}

export interface SampleEvidence {
  recordIds: string[];
  depositRecordId: string;
}

/** 写入一套覆盖签约→入住→居住→退租的示例证据，返回可用于争议的押金记录 id。 */
export function loadEvidenceSample(): SampleEvidence {
  const signed = record(SAMPLE_IDS.records[0], "signing", "2026-03-01", "签订房屋租赁合同，押金 4000 元、月租 2600 元", {
    contractClause: "第一条",
    materialName: "租赁合同（签署版）",
    materialType: "交接文件",
    amountCents: 400000,
  });
  const moveInMeters = record(SAMPLE_IDS.records[1], "move_in", "2026-03-01", "入住抄表：水表 128 吨、电表 3021 度、燃气 156 立方", {
    materialName: "入住水电底数照片",
    materialType: "表读数",
    reading: "水 128 / 电 3021 / 燃气 156",
  });
  const moveInWalls = record(SAMPLE_IDS.records[2], "move_in", "2026-03-01", "客厅墙面靠窗处已有细微裂缝，已拍特写留存", {
    materialName: "入住墙面现状照片",
    materialType: "房屋现状",
  });
  const repair = record(SAMPLE_IDS.records[3], "living", "2026-08-12", "空调不制冷，微信报修，房东当日安排师傅上门加氟", {
    contractClause: "第四条",
    materialName: "微信报修记录",
    materialType: "沟通记录",
  });
  const notice = record(SAMPLE_IDS.records[4], "move_out", "2026-10-10", "提前一个月书面告知退租，约定 11 月 10 日交接", {
    materialName: "退租通知",
    materialType: "沟通记录",
  });
  const handover = record(SAMPLE_IDS.records[5], "move_out", "2026-11-10", "退租交接：房东以墙面裂缝为由扣全部押金 4000 元，未给维修票据", {
    contractClause: "第五条",
    materialName: "退租交接单",
    materialType: "交接文件",
    materialStatus: "missing",
    amountCents: 400000,
  });

  const list = [signed, moveInMeters, moveInWalls, repair, notice, handover];
  const existingIds = new Set(records.getAll().map((item) => item.id));
  list.forEach((item) => {
    if (existingIds.has(item.id)) records.update(item.id, item);
    else records.add(item);
  });

  const water: UtilityAccount = {
    id: SAMPLE_IDS.water,
    kind: "water",
    stage: "living",
    periodStart: "2026-10-01",
    contractPrice: "按郑州市居民用水单价 4.5 元/吨",
    cycle: "2026-10-01 至 2026-10-31",
    startReading: "168",
    endReading: "174",
    billCents: 2700,
    paidCents: 2700,
    note: "账目一致",
    recordedAt: new Date().toISOString(),
  };
  const electricity: UtilityAccount = {
    id: SAMPLE_IDS.electricity,
    kind: "electricity",
    stage: "living",
    periodStart: "2026-10-01",
    contractPrice: "按合同单价 0.56 元/度",
    cycle: "2026-10-01 至 2026-10-31",
    startReading: "3480",
    endReading: "3672",
    billCents: 12800,
    paidCents: 10752,
    note: "账单与按合同单价折算存在差额，待与房东核对",
    recordedAt: new Date().toISOString(),
  };
  const utilityIds = new Set(utilities.getAll().map((item) => item.id));
  if (utilityIds.has(water.id)) utilities.update(water.id, water);
  else utilities.add(water);
  if (utilityIds.has(electricity.id)) utilities.update(electricity.id, electricity);
  else utilities.add(electricity);

  const profile = getRentalProfile();
  if (!profile.addressLabel && !profile.startDate && profile.monthlyRentCents == null && profile.depositCents == null) {
    saveRentalProfile({
      addressLabel: "郑州 · 金水区花园路 88 号 3 号楼 502",
      startDate: "2026-03-01",
      monthlyRentCents: 260000,
      depositCents: 400000,
    });
    setRegion("ZZ");
  }

  selection.set([handover.id, moveInWalls.id, signed.id]);
  return { recordIds: list.map((item) => item.id), depositRecordId: handover.id };
}
