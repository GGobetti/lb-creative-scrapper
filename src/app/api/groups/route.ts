import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseServiceKey || "");

export async function GET() {
  try {
    const { data: settings } = await supabase
      .from("telegram_scraper_settings")
      .select("groups_config")
      .eq("id", "default")
      .single();

    const groupsConfig = settings?.groups_config || [];

    // Para cada grupo, contar jobs
    const groupsWithStats = await Promise.all(
      groupsConfig.map(async (group: any) => {
        const { data: jobs } = await supabase
          .from("telegram_scraper_jobs")
          .select("count()")
          .ilike("chat_title", `%${group.id}%`);

        return {
          id: group.id,
          name: group.id,
          type: group.type || "fdm",
          active: true,
          jobsCount: 0,
        };
      })
    );

    return NextResponse.json({ groups: groupsWithStats });
  } catch (error: any) {
    console.error("Failed to fetch groups:", error);
    return NextResponse.json(
      { error: "Failed to fetch groups" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { groupId } = body;

    if (!groupId) {
      return NextResponse.json(
        { error: "groupId is required" },
        { status: 400 }
      );
    }

    // Buscar config atual
    const { data: settings } = await supabase
      .from("telegram_scraper_settings")
      .select("groups_config")
      .eq("id", "default")
      .single();

    const groupsConfig = settings?.groups_config || [];

    // Verificar se já existe
    if (groupsConfig.some((g: any) => g.id === groupId)) {
      return NextResponse.json(
        { error: "Group already exists" },
        { status: 400 }
      );
    }

    // Adicionar novo grupo
    const updatedGroups = [...groupsConfig, { id: groupId, type: "fdm" }];

    const { error } = await supabase
      .from("telegram_scraper_settings")
      .update({ groups_config: updatedGroups })
      .eq("id", "default");

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Group added successfully",
    });
  } catch (error: any) {
    console.error("Failed to add group:", error);
    return NextResponse.json(
      { error: "Failed to add group" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { groupId } = body;

    if (!groupId) {
      return NextResponse.json(
        { error: "groupId is required" },
        { status: 400 }
      );
    }

    // Buscar config atual
    const { data: settings } = await supabase
      .from("telegram_scraper_settings")
      .select("groups_config")
      .eq("id", "default")
      .single();

    const groupsConfig = settings?.groups_config || [];

    // Remover grupo
    const updatedGroups = groupsConfig.filter((g: any) => g.id !== groupId);

    const { error } = await supabase
      .from("telegram_scraper_settings")
      .update({ groups_config: updatedGroups })
      .eq("id", "default");

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Group deleted successfully",
    });
  } catch (error: any) {
    console.error("Failed to delete group:", error);
    return NextResponse.json(
      { error: "Failed to delete group" },
      { status: 500 }
    );
  }
}
