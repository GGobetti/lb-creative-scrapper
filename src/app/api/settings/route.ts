import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("telegram_scraper_settings")
      .select("*")
      .eq("id", "default")
      .single();

    if (error) throw error;

    return NextResponse.json({
      size_limit_mb: data?.size_limit_mb || 750,
      last_heartbeat: data?.last_heartbeat || null,
      max_concurrent_downloads: data?.max_concurrent_downloads || 5
    });
  } catch (error: any) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({
      size_limit_mb: 750,
      last_heartbeat: null,
      max_concurrent_downloads: 5
    });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { max_concurrent_downloads, size_limit_mb } = body;

    const updates: any = {};
    if (max_concurrent_downloads !== undefined) {
      updates.max_concurrent_downloads = max_concurrent_downloads;
    }
    if (size_limit_mb !== undefined) {
      updates.size_limit_mb = size_limit_mb;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("telegram_scraper_settings")
      .update(updates)
      .eq("id", "default");

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Configuração atualizada"
    });
  } catch (error: any) {
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: error.message || "Erro ao atualizar configuração" },
      { status: 500 }
    );
  }
}
