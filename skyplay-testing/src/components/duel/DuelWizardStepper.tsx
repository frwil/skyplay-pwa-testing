"use client";

import { ChevronRight, Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

export type WizardStep = "game" | "mode" | "arena";

const STEP_ORDER: WizardStep[] = ["game", "mode", "arena"];

interface DuelWizardStepperProps {
  currentStep: WizardStep;
  /** Label for the completed game step — shown on hover */
  selectedGameLabel?: string;
  /** Label for the completed mode step — shown on hover */
  selectedModeLabel?: string;
  /** Called when user clicks a completed step to go back */
  onStepClick?: (step: WizardStep) => void;
}

export default function DuelWizardStepper({
  currentStep,
  selectedGameLabel,
  selectedModeLabel,
  onStepClick,
}: DuelWizardStepperProps) {
  const { t } = useTranslation();
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  const stepLabels: Record<WizardStep, string> = {
    game: t.duel.wizard?.stepGame ?? "Jeu",
    mode: t.duel.wizard?.stepMode ?? "Mode",
    arena: t.duel.wizard?.stepArena ?? "Arène",
  };

  return (
    <div className="flex items-center justify-center gap-0 mb-6 select-none">
      {STEP_ORDER.map((step, i) => {
        const isActive = i === currentIdx;
        const isCompleted = i < currentIdx;
        const isFuture = i > currentIdx;
        const clickable = isCompleted && onStepClick;

        let tooltip = "";
        if (isCompleted && step === "game") tooltip = selectedGameLabel ?? "";
        if (isCompleted && step === "mode") tooltip = selectedModeLabel ?? "";

        return (
          <div key={step} className="flex items-center">
            {/* Connector line (before, except first) */}
            {i > 0 && (
              <div
                className="w-8 h-px mx-1"
                style={{
                  backgroundColor: isCompleted
                    ? "rgba(241,91,181,0.5)"
                    : "rgba(255,255,255,0.08)",
                }}
              />
            )}

            {/* Step circle */}
            <button
              onClick={clickable ? () => onStepClick!(step) : undefined}
              disabled={!clickable}
              title={tooltip || undefined}
              className="flex items-center justify-center rounded-full text-xs font-bold transition-all"
              style={{
                width: 36,
                height: 36,
                backgroundColor: isActive
                  ? "rgba(241,91,181,0.2)"
                  : isCompleted
                    ? "rgba(241,91,181,0.08)"
                    : "rgba(255,255,255,0.03)",
                border: isActive
                  ? "2px solid #f15bb5"
                  : isCompleted
                    ? "1px solid rgba(241,91,181,0.3)"
                    : "1px solid rgba(255,255,255,0.08)",
                color: isActive ? "#f15bb5" : isCompleted ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)",
                boxShadow: isActive ? "0 0 12px rgba(241,91,181,0.25)" : "none",
                cursor: clickable ? "pointer" : "default",
              }}
            >
              {isCompleted ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <span>{i + 1}</span>
              )}
            </button>

            {/* Label */}
            <span
              className="ml-2 text-xs font-medium hidden sm:inline"
              style={{
                color: isActive ? "#f15bb5" : isCompleted ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
              }}
            >
              {stepLabels[step]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
