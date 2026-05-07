import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ANALYZE_PROMPT = `你是一位专业的教育测量专家。请深度分析以下学校考试试卷，挖掘该校的考试规律和出题偏好。

试卷信息：
- 学校：{{SCHOOL}}
- 科目：{{SUBJECT}}
- 年级：{{GRADE}}
- 类型：{{EXAM_TYPE}}
- 学期：{{YEAR}}{{TERM}}

试卷内容：
{{TEXT}}

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
}`;

export async function POST(req: NextRequest) {
  try {
    const { filePath, school, subject, grade, examType, year, term, fileName } = await req.json();

    if (!filePath || !subject || !grade || !examType) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    // Download PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("exams")
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "下载文件失败：" + downloadError?.message }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let pdfText = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfParse = (await import("pdf-parse")) as any;
      const parsed = await (pdfParse.default ?? pdfParse)(buffer);
      pdfText = parsed.text;
    } catch (pdfErr) {
      console.error("PDF parse error:", pdfErr);
      return NextResponse.json({ error: "PDF解析失败，请确认文件格式正确" }, { status: 500 });
    }

    if (!pdfText || pdfText.trim().length < 50) {
      return NextResponse.json({ error: "PDF内容为空或无法识别（扫描件需转为可识别文字格式）" }, { status: 400 });
    }

    const truncatedText = pdfText.slice(0, 8000);

    const prompt = ANALYZE_PROMPT
      .replace("{{SCHOOL}}", school || "我的学校")
      .replace("{{SUBJECT}}", subject)
      .replace("{{GRADE}}", grade)
      .replace("{{EXAM_TYPE}}", examType)
      .replace("{{YEAR}}", String(year || new Date().getFullYear()))
      .replace("{{TERM}}", term || "上学期")
      .replace("{{TEXT}}", truncatedText);

    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

    const apiRes = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiRes.ok) {
      return NextResponse.json({ error: `AI分析失败 (${apiRes.status})` }, { status: 500 });
    }

    const apiData = await apiRes.json();
    const text: string = apiData.choices?.[0]?.message?.content ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI返回格式异常，请重试" }, { status: 500 });
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "AI返回JSON解析失败，请重试" }, { status: 500 });
    }

    // Store exam record in database
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
      console.error("DB insert error:", insertError);
      return NextResponse.json({ error: "存储到数据库失败：" + insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, examId: examRecord.id, analysis });
  } catch (err) {
    console.error("Analyze error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
