import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { jsonrepair } from "jsonrepair";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300; // 5 minutes — scanned PDF vision analysis can take 2-3 min

const ANALYZE_PROMPT = `你是一位资深语文/数学/英语教研员，请精准解读以下试卷。

试卷信息：
- 学校：{{SCHOOL}}
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 类型：{{EXAM_TYPE}}
- 学期：{{YEAR}}{{TERM}}

## 只输出 knowledgeDistribution（考点分布）

根据提供的题目清单，按考点归类输出，每条包含：
- topic：考点名称
- percentage：占总分比例（数字）
- specificContent：具体说明考查的词语/语法/知识点及题号（必须具体，不能只写类别）
  ✅ "代词（my/I/me/myself）、冠词（a/an/the）、介词（be strict with）——第一大题第1-10题"
  ❌ "语法知识"
- sourceQuestions：来源题号数组

## 输出格式（只输出JSON，不加任何前缀或markdown代码块）

{"knowledgeDistribution": [
  {
    "topic": "语法知识运用",
    "percentage": 15,
    "specificContent": "代词（my/I/me/myself）、冠词（a/an/the）、介词（be strict with）——第一大题第1-10题",
    "sourceQuestions": ["第一大题"]
  }
]}

约束：字符串内不得使用英文双引号，percentage必须是数字`;

// Prompt for per-batch question extraction (much shorter than ANALYZE_PROMPT)
const BATCH_EXTRACT_PROMPT = `你是试卷题目识别助手。从以下试卷内容中识别所有考题，只输出JSON，不要有任何前缀、后缀或markdown代码块：

{
  "questions": [
    {
      "number": "第一大题",
      "type": "题型名称",
      "score": 10,
      "articleCategory": "（仅阅读理解填写，如：科技类、环保类、人物传记类、日常生活类）",
      "specificItems": ["具体小题内容或词汇"],
      "knowledgePoints": ["考查的知识点"]
    }
  ]
}

重要规则：
1. 阅读理解题：同一篇文章的所有小题合并为一个条目，不要每题单独一条；articleCategory填文章类别；specificItems列出每道小题的题号和题干（如"第21题：Which is TRUE about..."）
2. 词汇/语法选择题：specificItems必须列出实际考查的具体单词或语法点（如"thousands of、other/another/others、be strict with"），不能只写类别
3. 其他题型：specificItems写具体的词语/算式/句子，不写题型描述
4. number写大题序号，score填分值（不确定写0），没有articleCategory的题目省略该字段`;

// Render a specific page range [startPage, endPage) from a PDF buffer
async function renderPdfPageRange(buffer: Buffer, startPage: number, endPage: number): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mupdf: any = await import("mupdf");
  const { Document, ColorSpace } = mupdf;

  const doc = Document.openDocument(buffer, "application/pdf");
  const totalPages = doc.countPages();
  const actualEnd = Math.min(endPage, totalPages);
  const images: string[] = [];

  for (let i = startPage; i < actualEnd; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap([0.6, 0, 0, 0.6, 0, 0], ColorSpace.DeviceRGB);
    const jpeg = pixmap.asJPEG(60);
    console.log(`Page ${i + 1} JPEG size: ${jpeg.length} bytes (${Math.round(jpeg.length / 1024)}KB)`);
    images.push(Buffer.from(jpeg).toString("base64"));
  }
  return images;
}

// Backward-compat wrapper
async function renderPdfToImages(buffer: Buffer, maxPages = 6): Promise<string[]> {
  return renderPdfPageRange(buffer, 0, maxPages);
}

// Count total pages in a PDF buffer
async function getPdfPageCount(buffer: Buffer): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mupdf: any = await import("mupdf");
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  return doc.countPages();
}

// Parse questions array from a raw Claude response string; returns [] on failure
function parseQuestionsFromResponse(text: string): object[] {
  try {
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonStart = stripped.indexOf("{");
    if (jsonStart === -1) return [];
    const repaired = jsonrepair(stripped.slice(jsonStart));
    const data = JSON.parse(repaired);
    return Array.isArray(data.questions) ? data.questions : [];
  } catch {
    return [];
  }
}

// Parse knowledgeDistribution array from a raw Claude response string; returns [] on failure
function parseKnowledgeDistributionFromResponse(text: string): object[] {
  try {
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonStart = stripped.indexOf("{");
    if (jsonStart === -1) return [];
    const repaired = jsonrepair(stripped.slice(jsonStart));
    const data = JSON.parse(repaired);
    return Array.isArray(data.knowledgeDistribution) ? data.knowledgeDistribution : [];
  } catch {
    return [];
  }
}

// Run synthesis: given extracted questions, ask Claude only for knowledgeDistribution, then merge
async function synthesizeAnalysis(questions: object[], systemPrompt: string): Promise<string> {
  const synthesisContent = `${systemPrompt}

以下是已从试卷中识别出的全部题目：
\`\`\`json
${JSON.stringify(questions, null, 2)}
\`\`\`

只输出 knowledgeDistribution 的JSON（不要重新输出questions），格式：{"knowledgeDistribution":[...]}`;

  const synthesisText = await callClaude([{ role: "user", content: synthesisContent }]);
  const kd = parseKnowledgeDistributionFromResponse(synthesisText);
  return JSON.stringify({ questions, knowledgeDistribution: kd });
}

// Main orchestrator: splits large PDFs into 3-page batches, extracts questions per batch,
// then does a single text-only synthesis call to produce the complete analysis JSON.
async function analyzePdfInBatches(buffer: Buffer, systemPrompt: string): Promise<string> {
  const BATCH_SIZE = 3;
  const totalPages = await getPdfPageCount(buffer);
  console.log(`PDF total pages: ${totalPages}`);

  // Single batch — use original vision call with full systemPrompt
  if (totalPages <= BATCH_SIZE) {
    const imgs = await renderPdfPageRange(buffer, 0, totalPages);
    return callClaudeVisionSDK(systemPrompt, imgs);
  }

  // Multi-batch extraction
  const allQuestions: object[] = [];

  for (let start = 0; start < totalPages; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, totalPages);
    console.log(`Extracting pages ${start + 1}–${end} / ${totalPages}...`);

    try {
      const imgs = await renderPdfPageRange(buffer, start, end);
      const batchText = await callClaudeVisionSDK(BATCH_EXTRACT_PROMPT, imgs);
      const questions = parseQuestionsFromResponse(batchText);
      console.log(`  → extracted ${questions.length} questions from pages ${start + 1}–${end}`);
      allQuestions.push(...questions);
    } catch (err) {
      console.warn(`Batch pages ${start + 1}–${end} failed, skipping:`, err);
    }
  }

  // Fallback if all batches failed
  if (allQuestions.length === 0) {
    console.warn("All batches failed, falling back to first-3-page single call");
    const imgs = await renderPdfPageRange(buffer, 0, BATCH_SIZE);
    return callClaudeVisionSDK(systemPrompt, imgs);
  }

  // Synthesis: ask only for knowledgeDistribution, merge server-side
  console.log(`Synthesis: ${allQuestions.length} questions total, generating knowledgeDistribution...`);
  return synthesizeAnalysis(allQuestions, systemPrompt);
}

// Use pdfjs-dist directly for more robust text extraction
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerPath = require("path").resolve(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"
    );
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
    const data = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageText = content.items.map((item: any) => item.str ?? "").join(" ");
      pageTexts.push(pageText);
    }
    return pageTexts.join("\n");
  } catch (err) {
    console.warn("pdfjs-dist extraction failed:", err);
    return "";
  }
}

// Extract text from a .docx Word document using mammoth
async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammoth: any = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (err) {
    console.warn("mammoth docx extraction failed:", err);
    return "";
  }
}

// Vision analysis via Anthropic SDK (/v1/messages) — longer proxy timeout than /v1/chat/completions
async function callClaudeVisionSDK(systemPrompt: string, images: string[]): Promise<string> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    baseURL: process.env.ANTHROPIC_BASE_URL || "https://us.novaiapi.com",
    timeout: 180_000,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: systemPrompt + "\n\n（以下是试卷扫描图片，请直接从图片中识别题目内容进行分析）" },
        ...images.map(img => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: "image/jpeg" as const, data: img },
        })),
      ],
    }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

async function callClaude(messages: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    baseURL: process.env.ANTHROPIC_BASE_URL || "https://us.novaiapi.com",
    timeout: 240_000,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages,
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

export async function POST(req: NextRequest) {
  try {
    const {
      filePath, school, subject, grade, examType, year, term, fileName,
      useVision, // client sets this to true to request server-side image rendering
      pageImages, // deprecated: kept for backward compat
    } = await req.json();

    if (!filePath || !subject || !grade || !examType) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("exams")
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "下载文件失败：" + downloadError?.message }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const systemPrompt = ANALYZE_PROMPT
      .replace("{{SCHOOL}}", school || "我的学校")
      .replace("{{SUBJECT}}", subject)
      .replace("{{GRADE}}", grade)
      .replace("{{EXAM_TYPE}}", examType)
      .replace("{{YEAR}}", String(year || new Date().getFullYear()))
      .replace("{{TERM}}", term || "上学期");

    let responseText = "";
    const isDocx = filePath.toLowerCase().endsWith(".docx") || (fileName || "").toLowerCase().endsWith(".docx");

    if (isDocx) {
      // Word document: chunk-based extraction + synthesize
      const docxText = await extractDocxText(buffer);
      if (!docxText || docxText.trim().length < 30) {
        return NextResponse.json({ error: "Word文档内容为空或无法读取，请确认文件未损坏" }, { status: 400 });
      }
      console.log(`Word doc text extracted: ${docxText.length} chars`);

      // Step 1: extract questions — chunk if text is long
      const CHUNK_SIZE = 6000;
      const OVERLAP = 400;
      const allQuestions: object[] = [];

      if (docxText.length <= CHUNK_SIZE) {
        const extractText = await callClaude([{
          role: "user",
          content: `${BATCH_EXTRACT_PROMPT}\n\n试卷内容：\n${docxText}`,
        }]);
        allQuestions.push(...parseQuestionsFromResponse(extractText));
      } else {
        const chunks: string[] = [];
        let pos = 0;
        while (pos < docxText.length) {
          chunks.push(docxText.slice(pos, pos + CHUNK_SIZE));
          pos += CHUNK_SIZE - OVERLAP;
        }
        const seen = new Set<string>();
        for (let i = 0; i < chunks.length; i++) {
          console.log(`Docx chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
          const extractText = await callClaude([{
            role: "user",
            content: `${BATCH_EXTRACT_PROMPT}\n\n试卷内容（第${i + 1}/${chunks.length}段）：\n${chunks[i]}`,
          }]);
          const qs = parseQuestionsFromResponse(extractText);
          for (const q of qs) {
            const key = (q as { number?: string }).number ?? JSON.stringify(q);
            if (!seen.has(key)) { seen.add(key); allQuestions.push(q); }
          }
        }
      }
      console.log(`Docx step1: extracted ${allQuestions.length} questions total`);

      // Step 2: ask only for knowledgeDistribution, merge server-side
      responseText = await synthesizeAnalysis(allQuestions, systemPrompt);
    } else {
      // PDF path: try text extraction, fall back to vision for scanned PDFs
      let pdfText = "";
      try {
        pdfText = await extractPdfText(buffer);
      } catch (e) {
        console.warn("pdfjs text extraction failed:", e);
      }

      if (!pdfText || pdfText.trim().length < 50) {
        if (useVision || (pageImages && Array.isArray(pageImages) && pageImages.length > 0)) {
          if (pageImages?.length > 0) {
            console.log(`Vision mode (client images): analyzing ${pageImages.length} pages`);
            responseText = await callClaudeVisionSDK(systemPrompt, pageImages);
          } else {
            responseText = await analyzePdfInBatches(buffer, systemPrompt);
          }
        } else {
          return NextResponse.json({ error: "NEEDS_VISION" }, { status: 422 });
        }
      } else {
        // Text-based PDF: extract then synthesize
        const extractText = await callClaude([{
          role: "user",
          content: `${BATCH_EXTRACT_PROMPT}\n\n试卷内容：\n${pdfText.slice(0, 8000)}`,
        }]);
        const pdfQuestions = parseQuestionsFromResponse(extractText);
        responseText = await synthesizeAnalysis(pdfQuestions, systemPrompt);
      }
    }

    // Strip markdown code fences if present
    const stripped = responseText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Find JSON start — even if truncated, jsonrepair can recover it
    const jsonStart = stripped.indexOf("{");
    if (jsonStart === -1) {
      console.error("No JSON in response:", responseText.slice(0, 800));
      return NextResponse.json({ error: "AI返回格式异常，请重试" }, { status: 500 });
    }
    const jsonCandidate = stripped.slice(jsonStart);

    let analysis;
    try {
      const repaired = jsonrepair(jsonCandidate);
      analysis = JSON.parse(repaired);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr);
      console.error("Raw JSON (first 1000):", jsonCandidate.slice(0, 1000));
      return NextResponse.json({ error: "AI返回JSON解析失败，请重试" }, { status: 500 });
    }

    const { data: examRecord, error: insertError } = await supabase
      .from("exams")
      .insert({
        school: school || "我的学校",
        subject,
        grade,
        exam_type: examType,
        year: year || new Date().getFullYear(),
        term: term || "上学期",
        file_url: filePath,
        file_name: fileName || filePath,
        analysis,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "存储到数据库失败：" + insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, examId: examRecord.id, analysis });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
