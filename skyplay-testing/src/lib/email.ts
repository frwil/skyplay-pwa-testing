import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set — emails will not be sent");
}

const resend = new Resend(process.env.RESEND_API_KEY);

// TODO: remettre noreply@skyplay.cloud quand le domaine sera vérifié dans Resend
const FROM_EMAIL = "SKY PLAY Testing <onboarding@resend.dev>";

export async function sendPinEmail(
  to: string,
  username: string,
  pin: string,
  isNew: boolean
): Promise<boolean> {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: isNew
        ? "🔑 SKY PLAY Testing — Ton code PIN"
        : "🔑 SKY PLAY Testing — Nouveau code PIN",
      html: `
        <div style="font-family: Inter, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #070f1e; color: #ffffff; border-radius: 16px; border: 1px solid rgba(0,200,255,0.15);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; margin: 0; background: linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
              SKYPLAY
            </h1>
            <p style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 4px; margin: 4px 0 0;">
              PWA Testing
            </p>
          </div>

          <p style="font-size: 14px; color: rgba(255,255,255,0.8); text-align: center;">
            ${isNew ? "Bienvenue" : "Bonjour"} <strong style="color: #00c8ff;">${escapeHtml(username)}</strong>${isNew ? " !" : ","}
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <p style="font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px;">
              ${isNew ? "Ton code PIN" : "Ton nouveau code PIN"}
            </p>
            <div style="display: inline-block; background: rgba(255,215,0,0.08); border: 1px solid rgba(255,215,0,0.3); border-radius: 12px; padding: 16px 32px;">
              <span style="font-size: 28px; font-weight: 900; color: #ffd700; font-family: monospace; letter-spacing: 8px;">${pin}</span>
            </div>
          </div>

          <p style="font-size: 12px; color: rgba(255,255,255,0.5); text-align: center; line-height: 1.6;">
            Utilise ce code pour te connecter à l'application<br />
            <strong style="color: #FD2E5F;">Ne partage ce code avec personne.</strong>
          </p>

          <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0;" />

          <p style="font-size: 10px; color: rgba(255,255,255,0.2); text-align: center;">
            © 2026 SKY PLAY ENTERTAINMENT — skyplay.cloud<br />
            Ce message a été envoyé automatiquement, merci de ne pas y répondre.
          </p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    const errMsg =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    console.error("Failed to send PIN email:", {
      to,
      from: FROM_EMAIL,
      error: errMsg,
    });
    return false;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
