import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    // Deletar job (remover completamente de telegram_scraper_jobs)
    const { error } = await supabase
      .from("telegram_scraper_jobs")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Job deleted successfully",
    });
  } catch (error: any) {
    console.error("Failed to delete job:", error);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
