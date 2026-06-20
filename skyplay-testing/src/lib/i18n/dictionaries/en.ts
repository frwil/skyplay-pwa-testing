import type { Dictionary } from "../types";

const en: Dictionary = {
  common: {
    siteTitle: "SKYPLAY",
    siteSubtitle: "Companion PWA",
    testBadge: "TEST",
    faq: "FAQ",
    admin: "Admin",
    back: "Back",
    footer: "© 2026 SKY PLAY ENTERTAINMENT — Test Companion PWA",
  },
  home: {
    heroBadge: "USER TESTING PHASE — 16 QUESTIONS",
    heroTitle1: "Test the platform,",
    heroTitle2: "earn Sky",
    heroDescription:
      "Answer the 16 questions across 4 milestones. Each approved answer earns you ",
    heroDescriptionSky: "Sky",
    stats: {
      testers: "Testers",
      answers: "Answers",
      approved: "Approved",
      skyDistributed: "Sky Distributed",
    },
    form: {
      title: "Test Form",
      subtitle:
        "Select a milestone, answer questions one by one",
    },
  },
  submissionForm: {
    login: {
      title: "Sign in to get started",
      emailLabel: "Email address",
      emailPlaceholder: "you@email.com",
      pinLabel: "4-digit PIN code",
      pinPlaceholder: "••••",
      submit: "Sign in",
      forgotPin: "Forgot PIN?",
      errorEmail: "Enter your email address",
      errorPin: "Enter your 4-digit PIN",
      errorAuth: "Incorrect email or PIN",
      pinSent: "PIN sent by email",
      haveAccount: "Don't have an account? Sign up",
    },
    register: {
      title: "Create an account",
      usernameLabel: "Username",
      usernamePlaceholder: "Your nickname",
      emailLabel: "Email address",
      emailPlaceholder: "you@email.com",
      submit: "Sign up",
      haveAccount: "Already have an account? Sign in",
      errorUsername:
        "Username required (3-30 characters, letters, numbers, dashes, underscores)",
      errorEmail: "Enter a valid email address",
      errorGeneric: "Registration error",
      success: "Account created! Check your email for your PIN code.",
      pinSent: "A PIN code has been sent to your email address",
      usernameHint: "3-30 characters, letters, numbers, dashes, underscores",
    },
    forgotPin: {
      title: "Forgot PIN",
      emailLabel: "Your account email address",
      emailPlaceholder: "you@email.com",
      submit: "Receive a new PIN",
      back: "Back to login",
      success: "A new PIN has been sent to your email address",
      errorNotFound: "No account found with this email address",
      errorGeneric: "Error sending. Please try again.",
    },
    steps: {
      expand: "Expand",
      collapse: "Collapse",
      question: "Question",
      sky: "Sky",
      completed: "Completed",
      pending: "Pending",
      awaiting: "To answer",
      answer: "Answer",
      totalSky: "Total available",
      of: "of",
      campaignEnded: "The campaign has ended. Answers are no longer accepted.",
      allDone: "All questions completed!",
      allDoneDesc:
        "All your answers have been submitted. They will be reviewed by our administrators.",
    },
    modal: {
      reward: "Reward",
      yourAnswer: "Your answer",
      openSkyplay: "🔗 Open skyplay.cloud →",
      screenshotLabel: "Screenshot or video",
      screenshotHint: "Drag and drop or click to add a file",
      maxSize: "Max 10 MB (image) / 40 MB (video)",
      videoText: "Video selected",
      imageText: "Image selected",
      changeMedia: "Change file",
      submit: "Submit my answer",
      submitting: "Submitting...",
      success: "Answer submitted! +{reward} Sky — Pending review.",
      errorGeneric: "Submission error",
      errorNetwork: "Network error. Check your connection.",
      prev: "Previous",
      next: "Next",
      close: "Close",
      partsValidation: (label: string) => `Answer: ${label}`,
      checkboxValidation: "Select at least one option",
      textValidation: "Write your answer",
      dropdownPlaceholder: "Choose an option...",
      textPlaceholder: "Write your answer here...",
    },
  },
  admin: {
    login: {
      title: "Admin Login",
      usernameLabel: "Username",
      usernamePlaceholder: "admin or superadmin",
      passwordLabel: "Password",
      passwordPlaceholder: "••••••••",
      submit: "Sign in",
      errorAuth: "Incorrect credentials",
      errorGeneric: "Login error",
    },
    dashboard: {
      title: "Admin Dashboard",
      subtitle: "Manage submissions and participation bonuses",
      totalSky: "Total Sky",
      skyDistributed: "Sky Distributed",
      submissions: "Submissions",
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      testers: "Testers",
      filters: {
        all: "All",
        pending: "Pending",
        approved: "Approved",
        rejected: "Rejected",
      },
      approvedLabel: "APPROVED",
      rejectedLabel: "REJECTED",
      pendingLabel: "PENDING",
      processed: "Processed",
      approve: "Approve",
      reject: "Reject",
      viewScreenshot: "View screenshot",
      hideScreenshot: "Hide screenshot",
      screenshotUnavailable: "Screenshot unavailable",
      loading: "Loading...",
      noSubmissions: "No submissions found",
      step: "MILESTONE",
      updateError: "Error during update",
      networkError: "Network error",
      approveSuccess: "✅ Approved!",
      rejectSuccess: "❌ Rejected",
      bonus: {
        title: "Participation Bonus",
        description:
          "Testers who have submitted all answers are eligible for a 250 Sky bonus.",
        eligible: "Eligible for bonus",
        approve: "Grant bonus",
        revoke: "Revoke bonus",
        approved: "Bonus granted",
        notEligible: "Not eligible",
        user: "User",
        submissions: "Submissions",
      },
    },
  },
  faq: {
    title: "Frequently Asked Questions",
    subtitle: "Everything you need to know about the Skyplay testing phase",
    entries: [
      {
        question: "What is Skyplay?",
        answer:
          "Skyplay is an online gaming competition platform. Currently in user testing phase, we are collecting feedback to improve the experience before the official launch. The platform allows players to compete in various games and competition formats.",
      },
      {
        question: "How do I participate in the testing phase?",
        answer:
          "Create an account with your email address and receive your PIN code. Sign in, then answer the 16 questions across 4 milestones. Each milestone explores a different part of the platform: registration, competitions, social/live, and final feedback.",
      },
      {
        question: "How do I get my PIN code?",
        answer:
          "After filling out the registration form with your email, a 4-digit PIN code is automatically sent to that address. Check your spam folder if you can't find it. If the problem persists, contact an administrator.",
      },
      {
        question: "What are Sky?",
        answer:
          "Sky are the platform's virtual currency. During the testing phase, you earn Sky for each answer approved by an administrator. You also receive a 250 Sky participation bonus once all your answers have been reviewed. The amount earned per question is shown on each card.",
      },
      {
        question: "How do I take a screenshot?",
        answer:
          "On Windows: Print Screen key or Win + Shift + S. On Mac: Cmd + Shift + 4. On Android: Power button + Volume down. On iPhone: Side button + Volume up. You can also record a short video of your screen if that's easier.",
      },
      {
        question: "What file types are accepted for proof?",
        answer:
          "Images (PNG, JPG, GIF, WebP) up to 10 MB and videos (MP4, WebM) up to 40 MB are accepted. For Milestone 4 questions (final feedback), no screenshot is required.",
      },
      {
        question: "Can I edit my answer after submission?",
        answer:
          "No, only one submission is allowed per question. Take your time to double-check your answer and screenshot before submitting. If you made a mistake, contact an administrator.",
      },
      {
        question: "When are Sky credited?",
        answer:
          "Sky are credited as soon as an administrator approves your answer. Your total accumulated Sky is displayed at the top of the main page. The 250 Sky participation bonus is added once all your submissions have been processed.",
      },
      {
        question: "I forgot my PIN code, what should I do?",
        answer:
          'On the login form, use the "Forgot PIN" button. A new code will be sent to you by email. If you don\'t receive anything, check your spam folder or contact an administrator.',
      },
      {
        question: "A question or page isn't working, what should I do?",
        answer:
          "Describe the issue in your answer to the relevant question (Milestone 4, bug question). Specify where and when the problem occurred, what you were trying to do, and what happened. An administrator will review your report.",
      },
    ],
  },
  campaignBanner: {
    campaign: "Campaign",
    endsIn: "Ends in",
    days: "d",
    hours: "h",
    minutes: "min",
    seconds: "s",
    expired: "Campaign ended",
    expiredDesc: "This test campaign has ended. Answers are no longer accepted.",
  },
  email: {
    subjectPin: (pin: string) => `Skyplay — Your PIN code: ${pin}`,
    bodyPin: (pin: string) =>
      `Welcome to the Skyplay testing phase!\n\nYour PIN code is: ${pin}\n\nUse this code to sign in at https://skyplay-testing.vercel.app\n\n— The Skyplay Team`,
    subjectBonus: "Skyplay — Participation Bonus!",
    bodyBonus: (totalSky: number) =>
      `Congratulations! All your answers have been approved and you receive a 250 Sky participation bonus.\n\nYour total Sky is now ${totalSky} Sky.\n\nSign in to view your balance: https://skyplay-testing.vercel.app\n\n— The Skyplay Team`,
    registrationSubject: "Skyplay — Welcome to the testing phase!",
  },
};

export default en;
