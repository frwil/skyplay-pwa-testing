import { getDb } from "@/lib/db";
import GlowBackground from "@/components/GlowBackground";
import SubmissionFormWrapper from "@/components/SubmissionFormWrapper";
import CampaignBanner from "@/components/CampaignBanner";
import { Activity, Trophy, Users } from "lucide-react";

export const dynamic = "force-dynamic";

interface Question {
  id: number;
  question_text: string;
  reward_amount: number;
  sort_order: number;
}

interface StepWithQuestions {
  id: number;
  slug: string;
  title: string;
  questions: Question[];
}

export default async function HomePage() {
  const db = await getDb();

  // Fetch steps, stats, and active campaign in parallel
  const [stepsRs, statsRs, campaignRs] = await Promise.all([
    db.execute(
      `SELECT
        s.id, s.slug, s.title,
        COALESCE(
          json_group_array(
            json_object('id', q.id, 'question_text', q.question_text, 'reward_amount', q.reward_amount, 'sort_order', q.sort_order)
          ),
          '[]'
        ) as questions_json
      FROM steps s
      LEFT JOIN questions q ON q.step_id = s.id
      GROUP BY s.id
      ORDER BY s.id`
    ),
    db.execute(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user' OR role IS NULL) as users,
        (SELECT COUNT(*) FROM submissions) as submissions,
        (SELECT COUNT(*) FROM submissions WHERE status = 'APPROVED') as approved,
        (SELECT COALESCE(SUM(q.reward_amount), 0)
         FROM submissions s
         JOIN questions q ON s.question_id = q.id
         WHERE s.status = 'APPROVED') as totalSky`
    ),
    db.execute(
      `SELECT id, name, deadline, created_at
       FROM campaigns
       ORDER BY created_at DESC
       LIMIT 1`
    ),
  ]);

  const stepsWithQuestions: StepWithQuestions[] = (
    stepsRs.rows as unknown as {
      id: number;
      slug: string;
      title: string;
      questions_json: string;
    }[]
  ).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    questions: JSON.parse(row.questions_json) as Question[],
  }));

  const stats = statsRs.rows[0] as unknown as {
    users: number;
    submissions: number;
    approved: number;
    totalSky: number;
  };

  const campaignRow = campaignRs.rows[0] as unknown as
    | { id: number; name: string; deadline: string; created_at: string }
    | undefined;
  const campaignDeadline: string | null = campaignRow?.deadline ?? null;
  const campaignName: string | null = campaignRow?.name ?? null;
  const campaignExpired = campaignDeadline
    ? Date.now() > Date.parse(campaignDeadline)
    : false;

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="block">
            <div
              className="font-black text-xl uppercase tracking-[3px]"
              style={{
                background:
                  "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              SKYPLAY
            </div>
            <div
              className="uppercase tracking-[4px] mt-0.5"
              style={{ fontSize: "8px", color: "rgba(255,255,255,0.4)" }}
            >
              PWA Compagnon
            </div>
          </a>

          <div className="flex items-center gap-4">
            <a
              href="/admin"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              Admin
            </a>
            <span
              className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
              style={{
                backgroundColor: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00c8ff] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00c8ff]" />
              </span>
              TEST
            </span>
          </div>
        </div>
      </header>

      {/* Campaign countdown / expired banner */}
      <CampaignBanner deadline={campaignDeadline} name={campaignName} />

      {/* Hero */}
      <section className="relative z-10 pt-12 pb-8 px-4 text-center">
        <div
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border mb-6 text-xs font-bold"
          style={{
            backgroundColor: "rgba(255,255,255,0.03)",
            borderColor: "rgba(0,200,255,0.3)",
            color: "#00c8ff",
          }}
        >
          <Activity className="w-3.5 h-3.5" />
          PHASE DE TEST UTILISATEUR — 16 QUESTIONS
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black leading-[1.1] mb-4 tracking-tight">
          Teste la plateforme,
          <br />
          <span
            style={{
              background:
                "linear-gradient(to right, #00c8ff, #ffd700, #FD2E5F)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            gagne des Sky
          </span>
        </h1>

        <p
          className="text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          Réponds aux 16 questions réparties sur 4 jalons. Chaque réponse validée
          te rapporte des <span style={{ color: "#ffd700" }}>Sky</span>. N&apos;oublie
          pas d&apos;ajouter une capture d&apos;écran comme preuve !
        </p>

        {/* Mini stats */}
        <div className="flex justify-center gap-6 mt-6">
          <div className="text-center">
            <Users className="w-4 h-4 mx-auto mb-1 text-[#00c8ff]" />
            <p className="text-lg font-black text-white">{stats.users}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Testeurs</p>
          </div>
          <div className="text-center">
            <Activity className="w-4 h-4 mx-auto mb-1 text-[#ffd700]" />
            <p className="text-lg font-black text-white">{stats.submissions}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Réponses</p>
          </div>
          <div className="text-center">
            <Trophy className="w-4 h-4 mx-auto mb-1 text-[#2ecc71]" />
            <p className="text-lg font-black text-white">{stats.approved}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Validées</p>
          </div>
          <div className="text-center">
            <span className="text-lg font-black" style={{ color: "#ffd700" }}>
              ⚡
            </span>
            <p className="text-lg font-black text-white">{stats.totalSky}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Sky distribués</p>
          </div>
        </div>
      </section>

      {/* Form Section */}
      <section className="relative z-10 max-w-2xl mx-auto px-4 pb-20">
        <div
          className="rounded-3xl border p-6 sm:p-8"
          style={{
            backgroundColor: "rgba(13,27,46,0.85)",
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <div className="mb-6">
            <h2 className="text-lg font-black mb-1 text-white">
              Formulaire de test
            </h2>
            <p className="text-xs text-white/40">
              Sélectionne un jalon, réponds aux questions une par une
            </p>
          </div>

          <SubmissionFormWrapper
            steps={stepsWithQuestions}
            campaignDeadline={campaignDeadline}
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-6 px-4 text-center">
        <p className="text-xs text-white/20">
          © 2026 SKY PLAY ENTERTAINMENT — PWA Compagnon de Test
        </p>
      </footer>
    </main>
  );
}
