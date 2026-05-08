import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const body = await req.json();
  const allowed = ["year", "term", "grade", "subject", "exam_type"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  const { error } = await supabase.from("exams").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  // Get file_url first so we can delete from storage too
  const { data: exam } = await supabase
    .from("exams")
    .select("file_url")
    .eq("id", id)
    .single();

  // Delete DB record
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort: delete file from storage
  if (exam?.file_url) {
    await supabase.storage.from("exams").remove([exam.file_url]);
  }

  return NextResponse.json({ success: true });
}
