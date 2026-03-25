import { NextRequest, NextResponse } from "next/server";
import {
    getRemainingSeconds,
    isSessionActive,
    loadSessionByToken,
    markInterviewInProgress,
    parseVapiToolAuth,
} from "@/lib/vapi-interview";

export async function POST(request: NextRequest) {
    try {
        const auth = parseVapiToolAuth(request);
        if (!auth.ok) {
            return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const sessionToken = String(body?.sessionToken || "").trim();

        if (!sessionToken) {
            return NextResponse.json({ ok: false, error: "sessionToken is required" }, { status: 400 });
        }

        const session = await loadSessionByToken(sessionToken);
        if (!session) {
            return NextResponse.json({ ok: false, error: "Invalid interview session token" }, { status: 404 });
        }

        if (session.ended_at) {
            return NextResponse.json({
                ok: true,
                sessionId: session.id,
                alreadyEnded: true,
                status: session.status || "COMPLETED",
                remainingSeconds: 0,
            });
        }

        if (!isSessionActive(session.session_valid_from, session.session_valid_until)) {
            return NextResponse.json({ ok: false, error: "Interview link is not active right now" }, { status: 400 });
        }

        const nowIso = new Date().toISOString();
        await markInterviewInProgress(session, nowIso);

        return NextResponse.json({
            ok: true,
            sessionId: session.id,
            startedAt: session.started_at || nowIso,
            status: session.status || "INTERVIEW_IN_PROGRESS",
            remainingSeconds: getRemainingSeconds(session.session_valid_until),
        });
    } catch (error) {
        console.error("VAPI startOrValidateSession error:", error);
        return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
    }
}
