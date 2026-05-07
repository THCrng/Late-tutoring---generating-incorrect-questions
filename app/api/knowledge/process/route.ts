import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { jsonrepair } from "jsonrepair";

const EXTRACT_PROMPT = `你是一位专业的中国小学/初中教材分析专家。请仔细阅读以下教材内容，提取其中的核心考点，建立知识库。

教材信息：
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 版本：{{TEXTBOOK}}

教材内容：
{{TEXT}}

请提取所有考点，以JSON数组格式返回（不要有任何额外文字或markdown标记）：
[
  {
    "topic": "考点名称（简洁，如：分数化简）",
    "keywords": ["关键词1", "关键词2", "关键词3"],
    "content": "详细说明：包含定义、计算方法、典型例题思路、常见易错点",
    "questionTypes": ["填空", "计算", "应用题"]
  }
]`;

export async function POST(req: NextRequest) {
  try {
    const { filePath, subject, grade, textbook, fileName } = await req.json();

    if (!filePath || !subject || !grade) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    // Download PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("knowledge")
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "下载文件失败：" + downloadError?.message }, { status: 500 });
    }

    // Extract text from PDF using dynamic import (Node.js only)
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let pdfText = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "";
      const data = new Uint8Array(buffer);
      const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
      const pageTexts: string[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pageTexts.push(content.items.map((item: any) => item.str ?? "").join(" "));
      }
      pdfText = pageTexts.join("\n");
    } catch (pdfErr) {
      console.warn("pdfjs-dist extraction failed:", pdfErr);
    }

    if (!pdfText || pdfText.trim().length < 50) {
      return NextResponse.json({
        error: "无法提取PDF文字内容。请确认上传的是【可搜索的电子版PDF】，而非扫描图片PDF。用电脑打开PDF能选中文字，则可上传。",
      }, { status: 400 });
    }

    const messageContent = EXTRACT_PROMPT
      .replace("{{SUBJECT}}", subject)
      .replace("{{GRADE}}", grade)
      .replace("{{TEXTBOOK}}", textbook || "人教版（2026版）")
      .replace("{{TEXT}}", pdfText.slice(0, 8000));

    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    let apiRes: Response;
    try {
      apiRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          stream: false,
          messages: [{ role: "user", content: messageContent as string }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!apiRes.ok) {
      return NextResponse.json({ error: `AI分析失败 (${apiRes.status})` }, { status: 500 });
    }

    const apiData = await apiRes.json();
    const text: string = apiData.choices?.[0]?.message?.content ?? "";

    // Strip markdown code fences and extract JSON array
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = stripped.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("No JSON array in response:", text.slice(0, 500));
      return NextResponse.json({ error: "AI返回格式异常，请重试" }, { status: 500 });
    }

    let knowledgePoints: Array<{
      topic: string;
      keywords: string[];
      content: string;
      questionTypes: string[];
    }>;
    try {
      knowledgePoints = JSON.parse(jsonrepair(jsonMatch[0]));
    } catch {
      return NextResponse.json({ error: "AI返回JSON解析失败，请重试" }, { status: 500 });
    }

    // Store each knowledge point in database
    const rows = knowledgePoints.map((kp) => ({
      subject,
      grade,
      topic: kp.topic,
      keywords: kp.keywords,
      content: kp.content,
      question_types: kp.questionTypes,
      source_file: fileName || filePath,
      textbook: textbook || "人教版（2026版）",
    }));

    const { error: insertError } = await supabase
      .from("knowledge_points")
      .insert(rows);

    if (insertError) {
      console.error("DB insert error:", insertError);
      return NextResponse.json({ error: "存储到数据库失败：" + insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      extracted: knowledgePoints.length,
      topics: knowledgePoints.map((k) => k.topic),
    });
  } catch (err) {
    console.error("Process error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
