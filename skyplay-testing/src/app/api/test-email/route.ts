import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") || "tagneffw@gmail.com";

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return NextResponse.json(
      { ok: false, error: "GMAIL_USER or GMAIL_APP_PASSWORD is not set" },
      { status: 500 }
    );
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  try {
    const result = await transport.sendMail({
      from: "SKY PLAY Testing <noreply@skyplay.cloud>",
      to,
      subject: "Test — Diagnostic Email",
      html: "<p>Ceci est un email de test pour diagnostiquer l'envoi via Nodemailer/Gmail.</p>",
    });

    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (error) {
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
