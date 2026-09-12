import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type TJsFileUploadParams } from "@formbricks/types/js";
import { type TResponseData, type TResponseTtc } from "@formbricks/types/responses";
import { type TUploadFileConfig } from "@formbricks/types/storage";
import { type TSurveyBlock } from "@formbricks/types/surveys/blocks";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/constants";
import {
  type TSurveyElement,
  type TSurveyElementChoice,
  type TSurveyRankingElement,
} from "@formbricks/types/surveys/elements";
import { TSurveyLanguage } from "@formbricks/types/surveys/types";
import { TValidationErrorMap } from "@formbricks/types/surveys/validation-rules";
import { BackButton } from "@/components/buttons/back-button";
import { SubmitButton } from "@/components/buttons/submit-button";
import { ElementConditional } from "@/components/general/element-conditional";
import { ScrollableContainer } from "@/components/wrappers/scrollable-container";
import {
  getAutoProgressElement,
  shouldHideSubmitButtonForAutoProgress,
  shouldTriggerAutoProgress,
} from "@/lib/auto-progress";
import { fetchMunicipiosByUf } from "@/lib/ibge-municipios";
import { getLocalizedValue } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getFirstErrorMessage, validateBlockResponses } from "@/lib/validation/evaluator";

const AUTO_PROGRESS_SUBMIT_DELAY_MS = 350;

// --- Vertx fork: b1q6 ("Em qual município você mora?") choices depend on the b1q5 ("Em qual
// estado você mora?") answer within the same block (block 01). Formbricks has no native
// "dependent choices" mechanism (see packages/types/surveys/elements.ts), so this is handled
// entirely client-side: whenever b1q5's value changes, fetch that state's municipalities from the
// public IBGE API and swap them in as b1q6's choices for this render only (never persisted back to
// the survey). These IDs are specific to this one national survey, not a generic feature. ---
const ESTADO_ELEMENT_ID = "b1q5";
const MUNICIPIO_ELEMENT_ID = "b1q6";
const MUNICIPIO_OTHER_CHOICE_ID = "other";

/** Always-available manual-entry choice, so the field never gets stuck — before a state is picked,
 * while the IBGE list is loading, or if the IBGE API fails outright. Reuses SingleSelect's native
 * "other" choice (free-text input), rather than inventing a new UI for the fallback path. */
const municipioOtherChoice = (label: string): TSurveyElementChoice => ({
  id: MUNICIPIO_OTHER_CHOICE_ID,
  label: { default: label, "en-US": label },
});

const MUNICIPIO_CHOICES_NO_UF_SELECTED: TSurveyElementChoice[] = [
  municipioOtherChoice("Selecione o estado acima para ver a lista de municípios, ou digite aqui"),
];

const MUNICIPIO_CHOICES_LOAD_FAILED: TSurveyElementChoice[] = [
  municipioOtherChoice("Não foi possível carregar a lista de municípios agora — digite o nome aqui"),
];

const municipioChoicesFromNames = (names: string[]): TSurveyElementChoice[] => [
  ...names.map((name, index) => ({
    id: `ibge-municipio-${index}`,
    label: { default: name, "en-US": name },
  })),
  municipioOtherChoice("Outro (não está na lista)"),
];

/**
 * Anchors are deliberately absent: they are focusable, but a link is never what a card asks of the
 * respondent. A headline or subheader may carry one in its prose (a consent element pointing at a
 * privacy policy), and that link sits *before* the element's own control in the DOM — so mount
 * focus landed on a word in the question text, ringed, reading as a highlighted suggestion
 * (ENG-2415), and gave a screen-reader user "Privacy Policy, link" as their orientation instead of
 * the question's control. Excluding `a` from `[tabindex="0"]` too keeps that uniform for an anchor
 * made focusable by hand. Nothing is left unfocused by the exclusion: every block renders its
 * Submit and/or Back button inside `root`, and the only shape without one (an auto-progress
 * element on the first block) is a radio group.
 */
const FOCUSABLE_CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([tabindex="-1"]):not(:disabled)',
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "button:not(:disabled)",
  '[tabindex="0"]:not(a)',
].join(", ");

/**
 * Focuses the first interactive control inside `root`. With `preferInvalid`,
 * controls flagged aria-invalid win. Prose links are not candidates at all (see
 * FOCUSABLE_CONTROL_SELECTOR).
 *
 * Scrolling is always left to the caller. The first control can sit *below* the card's content — a
 * CTA block has no input of its own, so its first control is the Next button rendered after the
 * element — and letting focus scroll that into view opens an overflowing card at its end instead of
 * its start (ENG-2289). The `preferInvalid` callers scroll the field they focus into view themselves.
 */
const focusFirstControl = (root: HTMLElement, preferInvalid = false): void => {
  const invalidTarget = preferInvalid
    ? root.querySelector<HTMLElement>(
        ':is(input, textarea, select)[aria-invalid="true"]:not([tabindex="-1"]):not(:disabled)'
      )
    : null;
  const target = invalidTarget ?? root.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
  target?.focus({ preventScroll: true });
};

interface BlockConditionalProps {
  block: TSurveyBlock;
  value: TResponseData;
  onChange: (responseData: TResponseData) => void;
  onSubmit: (data: TResponseData, ttc: TResponseTtc) => void;
  onBack: () => void;
  onFileUpload: (file: TJsFileUploadParams["file"], config?: TUploadFileConfig) => Promise<string>;
  isFirstBlock: boolean;
  isLastBlock: boolean;
  languageCode: string;
  prefilledResponseData?: TResponseData;
  skipPrefilled?: boolean;
  ttc: TResponseTtc;
  setTtc: (ttc: TResponseTtc) => void;
  surveyId: string;
  autoFocusEnabled: boolean;
  /**
   * Move focus to the block's first interactive control when the card appears.
   * True for user-initiated navigation (Next/Back/auto-progress) on any survey,
   * and for the initial card when autofocus is allowed (not an embedded widget).
   */
  shouldFocusOnMount: boolean;
  isBackButtonHidden: boolean;
  isAutoProgressingEnabled: boolean;
  onOpenExternalURL?: (url: string) => void | Promise<void>;
  dir?: "ltr" | "rtl" | "auto";
  fullSizeCards: boolean;
  isCardless?: boolean;
  surveyLanguages: TSurveyLanguage[];
}

export function BlockConditional({
  block,
  value,
  onChange,
  onSubmit,
  onBack,
  isFirstBlock,
  isLastBlock,
  languageCode,
  prefilledResponseData,
  skipPrefilled,
  ttc,
  setTtc,
  surveyId,
  onFileUpload,
  autoFocusEnabled,
  shouldFocusOnMount,
  isBackButtonHidden,
  isAutoProgressingEnabled,
  onOpenExternalURL,
  dir,
  fullSizeCards,
  isCardless = false,
  surveyLanguages,
}: Readonly<BlockConditionalProps>) {
  // Track the current element being filled (for TTC tracking)
  const [currentElementId, setCurrentElementId] = useState(block.elements[0]?.id);

  // State to store validation errors from centralized validation
  const [elementErrors, setElementErrors] = useState<TValidationErrorMap>({});

  // Refs to store form elements for each element so we can trigger their validation
  const elementFormRefs = useRef<Map<string, HTMLFormElement>>(new Map());

  // Ref to collect TTC values synchronously (state updates are async)
  const ttcCollectorRef = useRef<TResponseTtc>({});
  const autoProgressingInFlightRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Vertx fork: b1q6 municipio choices depend on b1q5 estado (see constants above) ---
  const hasMunicipioDependency = block.elements.some((element) => element.id === MUNICIPIO_ELEMENT_ID);
  const selectedEstadoValue = value[ESTADO_ELEMENT_ID];
  const selectedUf = typeof selectedEstadoValue === "string" && selectedEstadoValue ? selectedEstadoValue : undefined;

  const [municipioNamesByUf, setMunicipioNamesByUf] = useState<Record<string, string[] | "error">>({});
  const previousUfRef = useRef<string | undefined>(selectedUf);

  // Kept separate from the fetch effect below: this one only cares about `selectedUf` changing: it
  // must not re-run (and risk re-clearing) merely because a fetch resolved and updated
  // `municipioNamesByUf` for some other render.
  useEffect(() => {
    if (!hasMunicipioDependency) return;

    // The estado answer changed after the municipio field already had a value (from this state's
    // list) — that answer is very likely no longer valid for the new state, so clear it rather than
    // leave a São Paulo municipality selected under Goiás.
    if (previousUfRef.current !== undefined && previousUfRef.current !== selectedUf) {
      onChange({ [MUNICIPIO_ELEMENT_ID]: undefined });
    }
    previousUfRef.current = selectedUf;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange identity is stable per block render and isn't a real dependency here
  }, [hasMunicipioDependency, selectedUf]);

  useEffect(() => {
    if (!hasMunicipioDependency || !selectedUf) return;
    if (municipioNamesByUf[selectedUf] !== undefined) return; // already fetched (or cached) for this UF

    let cancelled = false;
    fetchMunicipiosByUf(selectedUf)
      .then((names) => {
        if (cancelled) return;
        setMunicipioNamesByUf((prev) => ({ ...prev, [selectedUf]: names ?? "error" }));
      })
      .catch(() => {
        if (cancelled) return;
        setMunicipioNamesByUf((prev) => ({ ...prev, [selectedUf]: "error" }));
      });

    return () => {
      cancelled = true;
    };
  }, [hasMunicipioDependency, selectedUf, municipioNamesByUf]);

  const municipioChoices = useMemo<TSurveyElementChoice[]>(() => {
    if (!selectedUf) return MUNICIPIO_CHOICES_NO_UF_SELECTED;
    const namesOrError = municipioNamesByUf[selectedUf];
    if (namesOrError === undefined) return MUNICIPIO_CHOICES_NO_UF_SELECTED; // still loading
    if (namesOrError === "error") return MUNICIPIO_CHOICES_LOAD_FAILED;
    return municipioChoicesFromNames(namesOrError);
  }, [selectedUf, municipioNamesByUf]);

  /** Swaps in the dynamic municipio choices for b1q6 only; every other element is passed through
   * unchanged. Never mutates the survey's own stored element/choices. */
  const resolveElementForRender = (element: TSurveyElement): TSurveyElement => {
    if (element.id !== MUNICIPIO_ELEMENT_ID || element.type !== TSurveyElementTypeEnum.MultipleChoiceSingle) {
      return element;
    }
    return { ...element, choices: municipioChoices };
  };

  // Screen-reader/keyboard users continue right where they act: when the card
  // appears after user navigation (or on an autofocus-allowed initial render),
  // focus its first control instead of dropping focus to the body, which made
  // VoiceOver re-announce the whole survey dialog on every card change.
  useEffect(() => {
    if (!shouldFocusOnMount) return;

    // Defer so the card's content (and any card transition) has rendered.
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        if (containerRef.current) focusFirstControl(containerRef.current);
      });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once when the block mounts
  }, []);
  const autoProgressElement = getAutoProgressElement(block.elements, isAutoProgressingEnabled);
  const shouldHideSubmitButton = shouldHideSubmitButtonForAutoProgress(
    block.elements,
    isAutoProgressingEnabled,
    value
  );

  // Handle change for an individual element
  const handleElementChange = (elementId: string, responseData: TResponseData) => {
    // If user moved to a different element, we should track it
    if (elementId !== currentElementId) {
      setCurrentElementId(elementId);
    }
    // Clear error for this element when user makes a change
    if (elementErrors[elementId]) {
      setElementErrors((prev: TValidationErrorMap) => {
        const updated = { ...prev };
        delete updated[elementId];
        return updated;
      });
    }
    const mergedValue = { ...value, ...responseData };
    const blockResponses = block.elements.reduce<TResponseData>((acc, element) => {
      const elementValue = mergedValue[element.id];
      if (elementValue !== undefined) {
        acc[element.id] = elementValue;
      }
      return acc;
    }, {});

    // Merge with existing block data to preserve other element values
    onChange(mergedValue);

    if (
      shouldTriggerAutoProgress({
        changedElementId: elementId,
        mergedValue,
        autoProgressElement,
        isAlreadyInFlight: autoProgressingInFlightRef.current,
      })
    ) {
      autoProgressingInFlightRef.current = true;
      // The selection is committed and the card is about to leave: drop focus now so
      // the focus ring doesn't linger on the answered option during the submit delay
      // (it read as a flashing ring). The next card focuses its first control on mount.
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      // Defer submission so element-level change handlers can finalize TTC updates first.
      setTimeout(() => {
        try {
          const blockTtc = collectTtcValues();
          onSubmit(blockResponses, blockTtc);
        } finally {
          autoProgressingInFlightRef.current = false;
        }
      }, AUTO_PROGRESS_SUBMIT_DELAY_MS);
    }
  };

  // Handler to collect TTC values synchronously (called from element form submissions)
  const handleTtcCollect = (elementId: string, elementTtc: number) => {
    ttcCollectorRef.current[elementId] = elementTtc;
  };

  // Handle prefilling at block level (both skipPrefilled and regular prefilling)
  useEffect(() => {
    if (prefilledResponseData) {
      // Collect all prefilled values for elements in this block
      const prefilledData: TResponseData = {};
      let hasAnyPrefilled = false;

      block.elements.forEach((element) => {
        if (prefilledResponseData[element.id] !== undefined) {
          prefilledData[element.id] = prefilledResponseData[element.id];
          hasAnyPrefilled = true;
        }
      });

      if (hasAnyPrefilled) {
        // Apply all prefilled values in one atomic operation
        onChange(prefilledData);

        // If skipPrefilled and ALL elements are prefilled, auto-submit
        if (skipPrefilled) {
          const allElementsPrefilled = block.elements.every(
            (element) => prefilledResponseData[element.id] !== undefined
          );

          if (allElementsPrefilled) {
            const prefilledTtc: TResponseTtc = {};
            block.elements.forEach((element) => {
              prefilledTtc[element.id] = 0; // 0 TTC for prefilled/skipped questions
            });
            setTtc({ ...ttc, ...prefilledTtc });

            // Auto-submit the entire block (skip to next)
            setTimeout(() => {
              onSubmit(prefilledData, prefilledTtc);
            }, 0);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once when block mounts
  }, []);

  // Validate ranking element
  const validateRankingElement = (
    element: TSurveyRankingElement,
    response: unknown,
    form: HTMLFormElement
  ): boolean => {
    const isRequired = element.required;
    const isValueArray = Array.isArray(response);
    const atLeastOneRanked = isValueArray && response.length >= 1;

    // If required: at least 1 option must be ranked
    if (isRequired && (!isValueArray || !atLeastOneRanked)) {
      form.requestSubmit();
      return false;
    }

    // If not required: allow partial ranking (some items ranked, some not)
    // No validation needed - user can proceed with any number of ranked items (including 0)

    return true;
  };

  // Check if response is empty
  const isEmptyResponse = (response: unknown): boolean => {
    return (
      response === undefined ||
      response === null ||
      response === "" ||
      (Array.isArray(response) && response.length === 0) ||
      (typeof response === "object" && !Array.isArray(response) && Object.keys(response).length === 0)
    );
  };

  // Validate a single element's form
  const validateElementForm = (element: TSurveyElement, form: HTMLFormElement): boolean => {
    const response = value[element.id];

    if (element.type !== TSurveyElementTypeEnum.CTA && !form.checkValidity()) {
      form.requestSubmit();
      return false;
    }

    if (
      element.type === TSurveyElementTypeEnum.Address ||
      element.type === TSurveyElementTypeEnum.ContactInfo
    ) {
      return true;
    }

    // Custom validation for ranking questions
    if (element.type === TSurveyElementTypeEnum.Ranking && !validateRankingElement(element, response, form)) {
      return false;
    }

    // Custom validation for matrix questions
    if (element.type === TSurveyElementTypeEnum.Matrix) {
      // Required means at least 1 row must be answered
      if (element.required && (!response || Object.keys(response).length === 0)) {
        form.requestSubmit();
        return false;
      }
    }

    // For other element types, check if required fields are empty
    // CTA elements should not block navigation even if marked required (as they are informational)
    if (element.type !== TSurveyElementTypeEnum.CTA) {
      if (element.required && isEmptyResponse(response)) {
        form.requestSubmit();
        return false;
      }
    }

    return true;
  };

  // Find the first invalid form
  const findFirstInvalidForm = (): HTMLFormElement | null => {
    let firstInvalidForm: HTMLFormElement | null = null;

    for (const element of block.elements) {
      const form = elementFormRefs.current.get(element.id);
      if (form && !validateElementForm(element, form)) {
        firstInvalidForm ??= form;
      }
    }

    return firstInvalidForm;
  };

  // Collect TTC values from forms
  const collectTtcValues = (): TResponseTtc => {
    // Clear the TTC collector before collecting new values
    ttcCollectorRef.current = {};

    // Call each form's submit method to trigger TTC calculation
    block.elements.forEach((element) => {
      const form = elementFormRefs.current.get(element.id);
      if (form) {
        form.requestSubmit();
      }
    });

    // Collect TTC from the ref (populated synchronously by form submissions)
    const blockTtc: TResponseTtc = {};
    block.elements.forEach((element) => {
      if (ttcCollectorRef.current[element.id] !== undefined) {
        blockTtc[element.id] = ttcCollectorRef.current[element.id];
      } else if (ttc[element.id] !== undefined) {
        blockTtc[element.id] = ttc[element.id];
      }
    });

    return blockTtc;
  };

  // Collect responses for all elements in this block
  const collectBlockResponses = (): TResponseData => {
    const blockResponses: TResponseData = {};
    block.elements.forEach((element) => {
      if (value[element.id] !== undefined) {
        blockResponses[element.id] = value[element.id];
      }
    });
    return blockResponses;
  };

  const handleBlockSubmit = (e?: Event) => {
    if (e) {
      e.preventDefault();
    }

    // Run centralized validation for elements that support it
    const errorMap = validateBlockResponses(block.elements, value, languageCode);

    // Check if there are any validation errors from centralized validation
    const hasValidationErrors = Object.keys(errorMap).length > 0;

    if (hasValidationErrors) {
      setElementErrors(errorMap);

      // Find the first element with an error, scroll to its input area (not the headline)
      // and move focus to its first invalid control so keyboard users can fix it directly.
      const firstErrorElementId = Object.keys(errorMap)[0];
      const form = elementFormRefs.current.get(firstErrorElementId);
      if (form) {
        const scrollTarget = form.querySelector("[data-element-input]") ?? form;
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
        // Defer so aria-invalid from the new error state is in the DOM.
        requestAnimationFrame(() => {
          focusFirstControl(form, true);
        });
      }
      return;
    }

    // Also run legacy validation for elements not yet migrated to centralized validation
    const firstInvalidForm = findFirstInvalidForm();
    if (firstInvalidForm) {
      const scrollTarget = firstInvalidForm.querySelector("[data-element-input]") ?? firstInvalidForm;
      scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
      requestAnimationFrame(() => {
        focusFirstControl(firstInvalidForm, true);
      });
      return;
    }

    // Clear any previous errors
    setElementErrors({});

    // Collect TTC and responses, then submit
    const blockTtc = collectTtcValues();
    const blockResponses = collectBlockResponses();
    onSubmit(blockResponses, blockTtc);
  };

  return (
    <div ref={containerRef} className={cn("space-y-6", fullSizeCards ? "h-full" : "")}>
      {/* Scrollable container for the entire block */}
      <ScrollableContainer fullSizeCards={fullSizeCards} disableInternalScroll={isCardless}>
        <div className="space-y-6">
          <div className="space-y-6">
            {block.elements.map((element, index) => {
              const isFirstElement = index === 0;

              return (
                <ElementConditional
                  key={element.id}
                  surveyLanguages={surveyLanguages}
                  element={resolveElementForRender(element)}
                  value={value[element.id]}
                  onChange={(responseData) => handleElementChange(element.id, responseData)}
                  onFileUpload={onFileUpload}
                  languageCode={languageCode}
                  ttc={ttc}
                  setTtc={setTtc}
                  surveyId={surveyId}
                  autoFocusEnabled={autoFocusEnabled && isFirstElement}
                  currentElementId={currentElementId}
                  onOpenExternalURL={onOpenExternalURL}
                  dir={dir}
                  formRef={(ref) => {
                    if (ref) {
                      elementFormRefs.current.set(element.id, ref);
                    } else {
                      elementFormRefs.current.delete(element.id);
                    }
                  }}
                  onTtcCollect={handleTtcCollect}
                  errorMessage={getFirstErrorMessage(elementErrors, element.id)}
                />
              );
            })}
          </div>

          <div
            className={cn(
              "flex w-full flex-row-reverse justify-between",
              fullSizeCards && !isCardless ? "bg-survey-bg sticky bottom-0" : ""
            )}>
            <div>
              {shouldHideSubmitButton ? (
                // Keep layout symmetry for Back button positioning (LTR/RTL).
                <div aria-hidden="true" className="mb-1 h-(--fb-button-height)" />
              ) : (
                <SubmitButton
                  buttonLabel={
                    block.buttonLabel ? getLocalizedValue(block.buttonLabel, languageCode) : undefined
                  }
                  isLastQuestion={isLastBlock}
                  onClick={handleBlockSubmit}
                  tabIndex={0}
                />
              )}
            </div>
            {!isFirstBlock && !isBackButtonHidden && (
              <BackButton
                backButtonLabel={
                  block.backButtonLabel ? getLocalizedValue(block.backButtonLabel, languageCode) : undefined
                }
                onClick={onBack}
                tabIndex={0}
              />
            )}
          </div>
        </div>
      </ScrollableContainer>
    </div>
  );
}
