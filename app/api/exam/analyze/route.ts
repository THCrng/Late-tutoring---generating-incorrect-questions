import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { jsonrepair } from "jsonrepair";

const ANALYZE_PROMPT = `你是一位资深的一线语文/数学/英语教研员，擅长精准解读学校考试试卷，为备考提供落地建议。

试卷信息：
- 学校：{{SCHOOL}}
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 类型：{{EXAM_TYPE}}
- 学期：{{YEAR}}{{TERM}}

## 分析深度要求（核心规则，必须严格执行）

### 规则1：逐题还原（questions字段）
必须逐大题列出，每道题写明：
- 题型名称（如：看拼音写汉字、按课文填空、阅读理解）
- 总分值
- 具体考查内容：列出每个小题的核心词语/字/句/知识点（不是题型描述，是具体内容）
  例：specificItems应写 ["chūn tiān→春天", "xiǎo gǒu→小狗"] 而非 ["拼音题"]
  例：specificItems应写 ["第1题考加减法：3+4=___", "第3题：一共有多少个苹果"] 而非 ["计算题"]
- knowledgePoints具体到字词层面：["生字：春、天、狗、草"] 而非 ["生字认读"]

### 规则2：考点必须具体（knowledgeDistribution字段）
每个考点的specificContent必须说明具体考查的字词/内容：
- ✅ 正确："本册生字：春、天、狗、草、木、禾（第一、三单元），主要以看拼音写汉字形式出现"
- ❌ 错误："生字认读与书写"（只有类别名，没有具体字）

sourceQuestions必须填写来源题号（如第一题、第三题第2小题）。

### 规则3：描述必须有据可依，禁止空话
所有文字字段（schoolStyle / weaknessPatterns / suggestions）：
- 每句话必须引用试卷中真实存在的题目或内容作为依据
- 禁止出现以下类型的空话：
  "总体来看..." / "建议加强..." / "注重培养..." / "全面提升..." / "综合能力..."
- weaknessPatterns每条格式：【第X题/X题型】+具体原因+失分表现
  例："【第三题看拼音写汉字】多笔画字（蛙、草、禾）字形复杂，易混淆笔顺，历届考题显示该类字失分率高"
- suggestions每条格式：【针对X考点/题型】+具体可操作方法
  例："【针对第一题加减运算】每日练习20道口算，重点加强进位加法（如8+7、9+6）"

## 返回JSON格式（只输出JSON，无任何额外文字或markdown代码块）

{
  "questions": [
    {
      "number": "第一大题",
      "type": "看拼音写汉字",
      "score": 10,
      "content": "看拼音，写汉字",
      "specificItems": ["chūn tiān→（   ）", "xiǎo gǒu→（   ）", "qīng wā→（   ）"],
      "knowledgePoints": ["生字：春、天、狗、青、蛙（第一、三单元）"]
    }
  ],
  "knowledgeDistribution": [
    {
      "topic": "生字认读与书写",
      "percentage": 30,
      "specificContent": "本册生字：春、天、狗、草、木、禾（第一、三单元），主要以看拼音写汉字形式出现（第一题）",
      "sourceQuestions": ["第一题", "第三题第2小题"]
    }
  ],
  "questionTypes": [
    {"type": "看拼音写汉字", "count": 8, "percentage": 20}
  ],
  "difficultyProfile": {
    "basic": 60,
    "medium": 30,
    "hard": 10,
    "coefficient": 0.78
  },
  "schoolStyle": "必须引用具体题目内容描述该校出题风格，如（该校连续三学期均在第一题考看拼音写汉字，以第一、三单元生字为主，分值稳定在10分...）",
  "keyFocusAreas": [
    "生字（春天狗草木禾青蛙）：占30%，连续出现在第一题",
    "口算加减法（含进位）：占25%，集中在第二题"
  ],
  "weaknessPatterns": [
    "【第一题看拼音写汉字】蛙、草等多笔画字字形复杂，笔顺易错，失分集中",
    "【第四题阅读理解第3小题】要求写感受，学生答案空洞无具体内容，普遍失分"
  ],
  "suggestions": [
    "【针对生字书写】重点练习第一、三单元多笔画字（蛙、草、禾），每字练习笔顺3遍，默写检验",
    "【针对阅读理解感受题】训练学生用（因为...所以我觉得...）句式，结合文中具体句子表达"
  ]
}

重要约束：
1. 只输出上述JSON，不要有任何前缀文字、后缀解释或markdown代码块
2. 所有字符串值内不得使用英文双引号（），如需引用内容用（）括号代替
3. 所有数值字段必须是数字
4. suggestions必须是数组，每条一个字符串，不是一段长文`;

// Render PDF pages to JPEG images using pdfjs-dist + @napi-rs/canvas (server-side)
async function renderPdfToImages(buffer: Buffer, maxPages = 6): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createCanvas } = require("@napi-rs/canvas") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const canvasFactory = {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(obj: { canvas: any }, width: number, height: number) {
      obj.canvas.width = width;
      obj.canvas.height = height;
    },
    destroy(_obj: unknown) {},
  };

  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({
    data, canvasFactory, useWorkerFetch: false, isEvalSupported: false,
  }).promise;

  const images: string[] = [];
  for (let i = 1; i <= Math.min((pdf.numPages as number), maxPages); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const jpegBuf: Buffer = canvas.toBuffer("image/jpeg");
    images.push(jpegBuf.toString("base64"));
  }
  return images;
}

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

    // Try text extraction first (works for digital PDFs)
    let pdfText = "";
    try {
      pdfText = await extractPdfText(buffer);
    } catch (e) {
      console.warn("pdfjs text extraction failed:", e);
    }

    if (!pdfText || pdfText.trim().length < 50) {
      if (useVision || (pageImages && Array.isArray(pageImages) && pageImages.length > 0)) {
        // Vision mode: render PDF pages server-side (or use client-provided images)
        const imgs: string[] = pageImages?.length > 0
          ? pageImages
          : await renderPdfToImages(buffer, 6);

        if (imgs.length === 0) {
          return NextResponse.json({ error: "无法渲染PDF页面，文件可能已损坏" }, { status: 400 });
        }
        console.log(`Vision mode: analyzing ${imgs.length} page images`);
        const content: object[] = [
          { type: "text", text: systemPrompt + "\n\n（以下是试卷扫描图片，请直接从图片中识别并分析）" },
          ...imgs.map((img: string) => ({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${img}` },
          })),
        ];
        responseText = await callClaude([{ role: "user", content }]);
      } else {
        // Tell client to retry with vision mode
        return NextResponse.json({ error: "NEEDS_VISION" }, { status: 422 });
      }
    } else {
      // Digital PDF: send extracted text
      responseText = await callClaude([{
        role: "user",
        content: `${systemPrompt}\n\n试卷内容：\n${pdfText.slice(0, 8000)}`,
      }]);
    }

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
