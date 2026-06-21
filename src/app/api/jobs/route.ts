import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // TODO: Fetch from Supabase
  return NextResponse.json({
    jobs: []
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, jobId } = body;

    if (action === "approve" || action === "reject") {
      // TODO: Update job status in Supabase
      return NextResponse.json({
        success: true,
        message: `Job ${action}ed`
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
