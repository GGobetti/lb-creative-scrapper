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

    // Buscar job antes de deletar para pegar arquivo
    const { data: job, error: fetchErr } = await supabase
      .from("telegram_scraper_jobs")
      .select("file_name, file_size_bytes")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    // Deletar job
    const { error: deleteErr } = await supabase
      .from("telegram_scraper_jobs")
      .delete()
      .eq("id", id);

    if (deleteErr) throw deleteErr;

    // Adicionar à blacklist para não processar novamente
    if (job) {
      const { error: blacklistErr } = await supabase
        .from("user_deleted_files")
        .insert({
          file_name: job.file_name,
          file_size_bytes: job.file_size_bytes,
          deleted_at: new Date().toISOString()
        });

      // Se a tabela não existe, apenas loga mas não falha
      if (blacklistErr && !blacklistErr.message.includes("user_deleted_files")) {
        throw blacklistErr;
      }
    }

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
