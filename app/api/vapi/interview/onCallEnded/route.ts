import { NextRequest, NextResponse } from "next/server";

// Reuse finalizeInterview endpoint with internal HTTP call to keep one finalization path.
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const sessionToken =
            String(body?.sessionToken || "").trim() ||
            String(body?.metadata?.sessionToken || "").trim() ||
            String(body?.call?.metadata?.sessionToken || "").trim();

        if (!sessionToken) {
            return NextResponse.json({ ok: false, error: "sessionToken is required" }, { status: 400 });
        }

        const origin = request.nextUrl.origin;
        const authHeader = request.headers.get("authorization") || "";

        const response = await fetch(`${origin}/api/vapi/interview/finalizeInterview`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                authorization: authHeader,
            },
            body: JSON.stringify({
                sessionToken,
                reason: "call-ended",
            }),
        });

        const result = await response.json();

        return NextResponse.json(
            {
                ok: Boolean(result?.ok),
                proxied: true,
                finalize: result,
            },
            { status: response.status },
        );
    } catch (error) {
        console.error("VAPI onCallEnded error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
