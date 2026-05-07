import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { jsonrepair } from "jsonrepair";

const ANALYZE_PROMPT = `你是一位专业的教育测量专家。请深度分析这份学校考试试卷，挖掘该校的考试规律和出题偏好。

试卷信息：
- 学校：{{SCHOOL}}
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 类型：{{EXAM_TYPE}}
- 学期：{{YEAR}}{{TERM}}

请进行深度分析，返回JSON格式（不要有任何额外文字或markdown标记）：
{
  "knowledgeDistribution": [
    {"topic": "考点名称", "frequency": 出现次数, "percentage": 占分比例}
  ],
  "questionTypes": [
    {"type": "题型名称", "count": 数量, "percentage": 占比, "avgScore": 平均分值}
  ],
  "difficultyProfile": {
    "basic": 基础题占比百分数,
    "medium": 中等题占比百分数,
    "hard": 难题占比百分数,
    "coefficient": 估算难度系数
  },
  "schoolStyle": "该校出题风格的详细描述（100字以上）",
  "keyFocusAreas": ["高频考点1", "高频考点2", "高频考点3"],
  "typicalFormats": ["该校特有的出题格式或表达方式1", "2", "3"],
  "weaknessPatterns": ["学生容易失分的地方1", "2"],
  "suggestions": "备考建议（针对该校考试风格）"
}

重要约束：
1. 只输出上述JSON，不要有任何前缀文字、后缀解释或markdown代码块
2. 所有字符串值内不得使用英文双引号（"），如需引用内容用（）括号代替
3. 所有数值字段必须是数字，不能是字符串`;

// Use pdfjs-dist directly for more robust text extraction
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Disable worker in Node.js environment
    pdfjsLib.GlobalWorkerOptions.workerSrc = "";
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

async function callClaude(messages: object[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

  // 150-second timeout — exam PDFs can take 60-120s to analyze
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        stream: false,
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const { filePath, school, subject, grade, examType, year, term, fileName } = await req.json();

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

    // Try text extraction first (works for digital PDFs)
    let pdfText = "";
    try {
      pdfText = await extractPdfText(buffer);
    } catch (e) {
      console.warn("pdf-parse failed, falling back to vision:", e);
    }

    if (!pdfText || pdfText.trim().length < 50) {
      return NextResponse.json({
        error: "无法提取PDF文字内容。请确认上传的是【可搜索的电子版PDF】，而非手机拍照或扫描的图片PDF。可以尝试用电脑直接打开PDF，若能选中文字则可以上传。",
      }, { status: 400 });
    }

    // Digital PDF: send text to Claude
    responseText = await callClaude([{
      role: "user",
      content: `${systemPrompt}\n\n试卷内容：\n${pdfText.slice(0, 8000)}`,
    }]);

    // Strip markdown code fences if present
    const stripped = responseText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON in response:", responseText.slice(0, 800));
      return NextResponse.json({ error: "AI返回格式异常，请重试" }, { status: 500 });
    }

    let analysis;
    try {
      const repaired = jsonrepair(jsonMatch[0]);
      analysis = JSON.parse(repaired);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr);
      console.error("Raw JSON (first 1000):", jsonMatch[0].slice(0, 1000));
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
