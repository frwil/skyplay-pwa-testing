export type Locale = "fr" | "en";

export interface Dictionary {
  common: {
    siteTitle: string;
    siteSubtitle: string;
    testBadge: string;
    faq: string;
    admin: string;
    back: string;
    footer: string;
  };
  home: {
    heroBadge: string;
    heroTitle1: string;
    heroTitle2: string;
    heroDescription: string;
    heroDescriptionSky: string;
    stats: {
      testers: string;
      answers: string;
      approved: string;
      skyDistributed: string;
    };
    form: {
      title: string;
      subtitle: string;
    };
  };
  submissionForm: {
    login: {
      title: string;
      emailLabel: string;
      emailPlaceholder: string;
      pinLabel: string;
      pinPlaceholder: string;
      submit: string;
      forgotPin: string;
      errorEmail: string;
      errorPin: string;
      errorAuth: string;
      pinSent: string;
      haveAccount: string;
    };
    register: {
      title: string;
      usernameLabel: string;
      usernamePlaceholder: string;
      emailLabel: string;
      emailPlaceholder: string;
      submit: string;
      haveAccount: string;
      errorUsername: string;
      errorEmail: string;
      errorGeneric: string;
      success: string;
      pinSent: string;
      usernameHint: string;
    };
    forgotPin: {
      title: string;
      emailLabel: string;
      emailPlaceholder: string;
      submit: string;
      back: string;
      success: string;
      errorNotFound: string;
      errorGeneric: string;
    };
    steps: {
      expand: string;
      collapse: string;
      question: string;
      sky: string;
      completed: string;
      pending: string;
      awaiting: string;
      answer: string;
      totalSky: string;
      of: string;
      campaignEnded: string;
      allDone: string;
      allDoneDesc: string;
    };
    modal: {
      reward: string;
      yourAnswer: string;
      openSkyplay: string;
      screenshotLabel: string;
      screenshotHint: string;
      maxSize: string;
      videoText: string;
      imageText: string;
      changeMedia: string;
      submit: string;
      submitting: string;
      success: string;
      errorGeneric: string;
      errorNetwork: string;
      prev: string;
      next: string;
      close: string;
      partsValidation: (label: string) => string;
      checkboxValidation: string;
      textValidation: string;
      dropdownPlaceholder: string;
      textPlaceholder: string;
    };
  };
  admin: {
    login: {
      title: string;
      usernameLabel: string;
      usernamePlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      submit: string;
      errorAuth: string;
      errorGeneric: string;
    };
    dashboard: {
      title: string;
      subtitle: string;
      totalSky: string;
      skyDistributed: string;
      submissions: string;
      pending: string;
      approved: string;
      rejected: string;
      testers: string;
      filters: {
        all: string;
        pending: string;
        approved: string;
        rejected: string;
      };
      approvedLabel: string;
      rejectedLabel: string;
      pendingLabel: string;
      processed: string;
      approve: string;
      reject: string;
      viewScreenshot: string;
      hideScreenshot: string;
      screenshotUnavailable: string;
      loading: string;
      noSubmissions: string;
      step: string;
      updateError: string;
      networkError: string;
      approveSuccess: string;
      rejectSuccess: string;
      bonus: {
        title: string;
        description: string;
        eligible: string;
        approve: string;
        revoke: string;
        approved: string;
        notEligible: string;
        user: string;
        submissions: string;
      };
    };
  };
  faq: {
    title: string;
    subtitle: string;
    entries: Array<{
      question: string;
      answer: string;
    }>;
  };
  campaignBanner: {
    campaign: string;
    endsIn: string;
    days: string;
    hours: string;
    minutes: string;
    seconds: string;
    expired: string;
    expiredDesc: string;
  };
  email: {
    subjectPin: (pin: string) => string;
    bodyPin: (pin: string) => string;
    subjectBonus: string;
    bodyBonus: (totalSky: number) => string;
    registrationSubject: string;
  };
}
