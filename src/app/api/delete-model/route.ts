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
        { error: "Model ID is required" },
        { status: 400 }
      );
    }

    // Soft delete: marcar como deletado em vez de realmente deletar
    const { error } = await supabase
      .from("telegram_indexed_stls")
      .update({ is_deleted: true })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Model deleted successfully (soft delete)",
    });
  } catch (error: any) {
    console.error("Failed to delete model:", error);
    return NextResponse.json(
      { error: "Failed to delete model" },
      { status: 500 }
    );
  }
}
