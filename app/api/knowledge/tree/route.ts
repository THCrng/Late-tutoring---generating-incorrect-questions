import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const TREE_PROMPT = `你是一位专业的中国中小学教材知识体系分析专家。

教材信息：
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 版本：{{TEXTBOOK}}

请仔细阅读以下教材内容，提取完整的层级知识框架。

要求：
1. 层级严格按照：科目 → 单元/章节 → 主题 → 知识点 → 具体细节
2. 知识点必须具体，例如：
   - 不能只写"拼音"，要写"翘舌音 zh ch sh r"、"平舌音 z c s"、"前鼻韵母 an en in un"
   - 不能只写"加法"，要写"进位加法（个位满10向十位进1）"、"连加三个数"
3. 使用Markdown标题格式：
   - # 科目
   - ## 单元/章节
   - ### 主题
   - #### 知识点
   - ##### 具体细节/例子
4. 只输出Markdown大纲，不输出JSON，不输出额外解释，不输出markdown代码块标记

教材内容：
{{TEXT}}`;

export async function POST(req: NextRequest) {
  try {
    const { filePath, subject, grade, textbook, fileName } = await req.json();

    if (!filePath || !subject || !grade) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("knowledge")
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "下载文件失败：" + downloadError?.message }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let pdfText = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
        pageTexts.push(content.items.map((item: any) => item.str ?? "").join(" "));
      }
      pdfText = pageTexts.join("\n");
    } catch (pdfErr) {
      console.warn("pdfjs-dist extraction failed:", pdfErr);
    }

    if (!pdfText || pdfText.trim().length < 50) {
      return NextResponse.json({
        error: "无法提取PDF文字内容。请确认上传的是【可搜索的电子版PDF】，而非扫描图片PDF。",
      }, { status: 400 });
    }

    const messageContent = TREE_PROMPT
      .replace("{{SUBJECT}}", subject)
      .replace("{{GRADE}}", grade)
      .replace("{{TEXTBOOK}}", textbook || "人教版（2026版）")
      .replace("{{TEXT}}", pdfText.slice(0, 10000));

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
          max_tokens: 4096,
          stream: false,
          messages: [{ role: "user", content: messageContent }],
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
    let markdown: string = apiData.choices?.[0]?.message?.content ?? "";

    // Strip accidental code fences
    markdown = markdown.replace(/^```[^\n]*\n?/gm, "").replace(/^```\s*$/gm, "").trim();

    if (!markdown || !markdown.includes("#")) {
      return NextResponse.json({ error: "AI返回格式异常，请重试" }, { status: 500 });
    }

    const nodeCount = (markdown.match(/^#{1,5}\s/gm) || []).length;

    const { error: insertError } = await supabase
      .from("knowledge_tree")
      .insert({
        subject,
        grade,
        textbook: textbook || "人教版（2026版）",
        source_file: fileName || filePath,
        markdown,
        node_count: nodeCount,
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
      return NextResponse.json({ error: "存储到数据库失败：" + insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, nodeCount });
  } catch (err) {
    console.error("Tree extract error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const subject = searchParams.get("subject");
    const grade = searchParams.get("grade");

    let query = supabase
      .from("knowledge_tree")
      .select("id, subject, grade, textbook, source_file, node_count, created_at, markdown")
      .order("created_at", { ascending: false });

    if (subject) query = query.eq("subject", subject);
    if (grade) query = query.eq("grade", grade);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "缺少id" }, { status: 400 });

    const { error } = await supabase.from("knowledge_tree").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
