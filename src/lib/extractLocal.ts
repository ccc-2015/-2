// 浏览器端文本抽取：发布到 Qoder Sites 后没有 Python 后端，PDF/DOCX/TXT 改在本地解析。
// 图片交给云函数的多模态模型逐字转写，结果可能不准，须让用户核对后再分析。

import type { ExtractPage, ExtractResult } from "@/shared/api";
import { api } from "./api";

/** 公网站点用 /functions/v1/app，没有 Python 后端，文件必须本地解析。 */
export const LOCAL_SITE = (import.meta.env.VITE_API_PREFIX ?? "").includes("/functions/");

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function baseResult(sourceName: string, fileType: string): ExtractResult {
  return {
    text: "",
    sourceName,
    fileType,
    pageCount: null,
    pages: [],
    method: "text",
    ocrUsed: false,
    warnings: [],
    needsReview: false,
  };
}

async function readPlainText(file: File): Promise<string> {
  return await file.text();
}

async function readPdf(file: File): Promise<{ text: string; pages: ExtractPage[]; pageCount: number; warnings: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const warnings: string[] = [];
  if (doc.numPages > 50) {
    warnings.push(`PDF 共 ${doc.numPages} 页，超过 50 页，仅解析前 50 页。`);
  }
  const pages: ExtractPage[] = [];
  const parts: string[] = [];
  const limit = Math.min(doc.numPages, 50);
  for (let index = 1; index <= limit; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text) parts.push(text);
    pages.push({ page: index, text, method: "text" });
  }
  const joined = parts.join("\n\n");
  if (!joined.trim()) {
    warnings.push("这份 PDF 没有可复制的文字，可能是扫描件。请直接粘贴合同文本后再审查。");
  }
  return { text: joined, pages, pageCount: doc.numPages, warnings };
}

async function readDocx(file: File): Promise<{ text: string; warnings: string[] }> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { text: result.value.trim(), warnings: [] };
}

export async function extractLocally(files: File[]): Promise<ExtractResult> {
  const chunks: string[] = [];
  const pages: ExtractPage[] = [];
  const warnings: string[] = [];
  let pageOffset = 0;
  let anyOcr = false;
  const names: string[] = [];

  for (const file of files) {
    const ext = extensionOf(file.name);
    const single = baseResult(file.name, ext);
    if (TEXT_EXTENSIONS.has(ext)) {
      single.text = await readPlainText(file);
    } else if (ext === "pdf") {
      const parsed = await readPdf(file);
      single.text = parsed.text;
      single.pages = parsed.pages;
      single.pageCount = parsed.pageCount;
      single.warnings = parsed.warnings;
      pageOffset += Math.max(parsed.pageCount, parsed.pages.length);
    } else if (ext === "docx") {
      const parsed = await readDocx(file);
      single.text = parsed.text;
      single.warnings = parsed.warnings;
    } else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      const parsed = (await api.transcribeImage(file)).data;
      single.text = parsed.text;
      single.method = parsed.method;
      single.ocrUsed = parsed.ocrUsed;
      single.warnings = parsed.warnings;
      anyOcr = anyOcr || parsed.ocrUsed;
    } else {
      throw new Error(`暂不支持 .${ext || "未知"} 格式，请上传 PDF、DOCX、TXT 或 Markdown。`);
    }

    chunks.push(single.text);
    names.push(file.name);
    warnings.push(...single.warnings.map((warning) => `${file.name}：${warning}`));
    single.pages.forEach((page) => pages.push({ ...page, page: pageOffset + page.page }));
  }

  const merged = chunks.join("\n\n");
  const sourceName = names.length === 1 ? names[0] : `合并的 ${names.length} 份文件`;
  return {
    text: merged,
    sourceName,
    fileType: files.length === 1 ? extensionOf(files[0].name) : "multi",
    pageCount: pages.length > 0 ? pageOffset : null,
    pages,
    method: anyOcr ? "ocr" : "text",
    ocrUsed: anyOcr,
    warnings,
    needsReview: !merged.trim() || warnings.length > 0 || anyOcr,
  };
}
