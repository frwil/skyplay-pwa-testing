import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") || "tagneffw@gmail.com";

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "RESEND_API_KEY is not set" }, { status: 500 });
  }

  const resend = new Resend(apiKey);

  try {
    const result = await resend.emails.send({
      from: "SKY PLAY Testing <noreply@skyplay.cloud>",
      to,
      subject: "Test — Diagnostic Email",
      html: "<p>Ceci est un email de test pour diagnostiquer l'envoi Resend.</p>",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    // Try to extract more info from the error
    const detail = error instanceof Error ? (error as any).cause : undefined;
    return NextResponse.json(
      { ok: false, error: msg, detail: detail ? String(detail) : undefined },
      { status: 500 }
    );
  }
}
