import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image_url } = body;

    if (!image_url) {
      return NextResponse.json({ error: "image_url is required" }, { status: 400 });
    }

    // 1. Registrar o ban
    const { error: banError } = await supabase
      .from("telegram_banned_images")
      .insert({ image_url, image_hash: null, created_at: new Date().toISOString() });

    if (banError && !banError.message.includes("duplicate")) throw banError;

    // 2. Remover a URL banida dos arrays de fotos em telegram_indexed_stls
    const { data: stlsWithPhoto } = await supabase
      .from("telegram_indexed_stls")
      .select("id, photos")
      .contains("photos", [image_url]);

    if (stlsWithPhoto && stlsWithPhoto.length > 0) {
      for (const stl of stlsWithPhoto) {
        const updatedPhotos = (stl.photos || []).filter((url: string) => url !== image_url);
        await supabase
          .from("telegram_indexed_stls")
          .update({ photos: updatedPhotos })
          .eq("id", stl.id);
      }
    }

    // 3. Remover a URL banida dos arrays de fotos em telegram_scraper_jobs
    const { data: jobsWithPhoto } = await supabase
      .from("telegram_scraper_jobs")
      .select("id, photos")
      .contains("photos", [image_url]);

    if (jobsWithPhoto && jobsWithPhoto.length > 0) {
      for (const job of jobsWithPhoto) {
        const updatedPhotos = (job.photos || []).filter((url: string) => url !== image_url);
        await supabase
          .from("telegram_scraper_jobs")
          .update({ photos: updatedPhotos })
          .eq("id", job.id);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Image banned",
      stls_cleaned: stlsWithPhoto?.length ?? 0,
      jobs_cleaned: jobsWithPhoto?.length ?? 0,
    });
  } catch (error: any) {
    console.error("Failed to ban image:", error);
    return NextResponse.json({ error: "Failed to ban image" }, { status: 500 });
  }
}
