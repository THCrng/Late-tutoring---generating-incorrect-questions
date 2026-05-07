import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject");
  const grade = searchParams.get("grade");

  let query = supabase
    .from("exams")
    .select("*")
    .order("created_at", { ascending: false });

  if (subject) query = query.eq("subject", subject);
  if (grade) query = query.eq("grade", grade);

  const { data, error } = await query.limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}
