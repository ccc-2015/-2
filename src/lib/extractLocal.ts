// 浏览器端文本抽取：发布到 Qoder Sites 后没有 Python 后端，PDF/DOCX/TXT 改在本地解析。
// 图片/扫描页交给云函数的文字识别（阿里云 OCR 优先，多模态兜底），结果可能不准，须让用户核对后再分析。

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { ExtractPage, ExtractResult } from "@/shared/api";
import { api, errorMessage } from "./api";

/** 公网站点用 /functions/v1/app，没有 Python 后端，文件必须本地解析。 */
export const LOCAL_SITE = (import.meta.env.VITE_API_PREFIX ?? "").includes("/functions/");

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const OCR_CONCURRENCY = 3;

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

async function renderPageToJpeg(page: PDFPageProxy, fileName: string, pageNumber: number): Promise<File> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建画布");
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("页面图像生成失败");
  return new File([blob], `${fileName}-p${pageNumber}.jpg`, { type: "image/jpeg" });
}

interface LoadedPdf {
  doc: PDFDocumentProxy;
  pages: ExtractPage[];
  pageCount: number;
  warnings: string[];
}

async function loadPdf(file: File): Promise<LoadedPdf> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const warnings: string[] = [];
  if (doc.numPages > 50) {
    warnings.push(`PDF 共 ${doc.numPages} 页，超过 50 页，仅解析前 50 页；后续页面可能未包含。`);
  }
  const pages: ExtractPage[] = [];
  const limit = Math.min(doc.numPages, 50);
  for (let index = 1; index <= limit; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    pages.push({ page: index, text, method: "text" });
  }

  const scanned = pages.filter((page) => !page.text.trim()).length;
  if (scanned > 0) {
    warnings.push(`检测到 ${scanned} 页无文本层，正在逐页识别；请核对错字、漏字与数字。`);
  }
  return { doc, pages, pageCount: doc.numPages, warnings };
}

async function readDocx(file: File): Promise<{ text: string; warnings: string[] }> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { text: result.value.trim(), warnings: [] };
}

type OcrJob =
  | { kind: "pdf"; doc: PDFDocumentProxy; pageNumber: number; info: ExtractPage; single: ExtractResult }
  | { kind: "image"; file: File; single: ExtractResult };

interface JobOutcome {
  text: string;
  warnings: string[];
  recognized: boolean;
}

async function runJob(job: OcrJob): Promise<JobOutcome> {
  try {
    const file = job.kind === "pdf"
      ? await renderPageToJpeg(await job.doc.getPage(job.pageNumber), job.single.sourceName, job.pageNumber)
      : job.file;
    const parsed = (await api.transcribeImage(file)).data;
    const warnings = job.kind === "pdf"
      ? parsed.warnings.map((warning) => `第 ${job.pageNumber} 页：${warning}`)
      : parsed.warnings;
    return { text: parsed.text.trim(), warnings, recognized: true };
  } catch (err) {
    const message = errorMessage(err);
    const label = job.kind === "pdf" ? `第 ${job.pageNumber} 页` : job.file.name;
    if (message.includes("未识别到文本")) {
      return {
        text: "",
        warnings: [`${label}未识别到文字，可能是空白页或图片过于模糊。`],
        recognized: false,
      };
    }
    return { text: "", warnings: [`${label}识别失败：${message}`], recognized: false };
  }
}

/** 小并发池：扫描页逐页识别，保持结果顺序，单页失败不中断其余页面。 */
async function runPool(
  jobs: OcrJob[],
  limit: number,
  onDone: ((done: number, total: number) => void) | undefined,
): Promise<JobOutcome[]> {
  const results = new Array<JobOutcome>(jobs.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      results[index] = await runJob(jobs[index]);
      done += 1;
      onDone?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

export async function extractLocally(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractResult> {
  const singles: ExtractResult[] = [];
  const jobs: OcrJob[] = [];
  const docs: PDFDocumentProxy[] = [];

  for (const file of files) {
    const ext = extensionOf(file.name);
    const single = baseResult(file.name, ext);
    if (TEXT_EXTENSIONS.has(ext)) {
      single.text = await readPlainText(file);
    } else if (ext === "pdf") {
      const loaded = await loadPdf(file);
      docs.push(loaded.doc);
      single.text = loaded.pages.map((page) => page.text.trim()).filter(Boolean).join("\n\n");
      single.pages = loaded.pages;
      single.pageCount = loaded.pageCount;
      single.warnings = loaded.warnings;
      for (const info of loaded.pages) {
        if (info.text.trim()) continue;
        info.method = "ocr";
        jobs.push({ kind: "pdf", doc: loaded.doc, pageNumber: info.page, info, single });
      }
    } else if (ext === "docx") {
      const parsed = await readDocx(file);
      single.text = parsed.text;
      single.warnings = parsed.warnings;
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      single.method = "ocr";
      jobs.push({ kind: "image", file, single });
    } else {
      throw new Error(`暂不支持 .${ext || "未知"} 格式，请上传 PDF、DOCX、TXT 或 Markdown。`);
    }
    singles.push(single);
  }

  try {
    if (jobs.length > 0) {
      onProgress?.(0, jobs.length);
      const outcomes = await runPool(jobs, OCR_CONCURRENCY, onProgress);
      jobs.forEach((job, index) => {
        const outcome = outcomes[index];
        if (job.kind === "pdf") {
          job.info.text = outcome.text;
        } else {
          job.single.text = outcome.text;
        }
        job.single.ocrUsed = job.single.ocrUsed || outcome.recognized;
        job.single.warnings.push(...outcome.warnings);
      });
    }
  } finally {
    await Promise.all(docs.map((doc) => doc.destroy().catch(() => undefined)));
  }

  const chunks: string[] = [];
  const pages: ExtractPage[] = [];
  const warnings: string[] = [];
  let pageOffset = 0;
  let anyOcr = false;
  const names: string[] = [];

  for (const single of singles) {
    chunks.push(single.text);
    names.push(single.sourceName);
    warnings.push(...single.warnings.map((warning) => `${single.sourceName}：${warning}`));
    single.pages.forEach((page) =>
      pages.push({ ...page, page: pageOffset + page.page, sourceName: files.length > 1 ? single.sourceName : undefined }),
    );
    pageOffset += Math.max(single.pageCount ?? 0, single.pages.length);
    anyOcr = anyOcr || single.ocrUsed;
  }

  const merged = chunks.join("\n\n");
  const emptyPages = pages.filter((page) => !page.text.trim()).map((page) => page.page);
  if (emptyPages.length > 0) {
    const list = emptyPages.slice(0, 10).join("、");
    warnings.push(
      `第 ${list}${emptyPages.length > 10 ? " 等" : ""} 页未提取到文本，可能是空白页或识别失败；请在合同文本中核对补充。`,
    );
  }
  if (!merged.trim()) {
    warnings.push("这份 PDF 没有可解析的文字，可能是空白件或拍摄/扫描质量不足。请直接粘贴合同文本后再审查。");
  }

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
