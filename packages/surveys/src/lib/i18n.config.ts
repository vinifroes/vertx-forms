import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_SURVEY_LANGUAGE_CODE,
  SURVEY_RUNTIME_LANGUAGE_CODES,
  resolveSurveyLanguageDefaultTag,
} from "@formbricks/i18n-utils/survey-runtime-languages";
import arEGTranslations from "../../locales/ar-EG.json";
import daDKTranslations from "../../locales/da-DK.json";
import deDETranslations from "../../locales/de-DE.json";
import enUSTranslations from "../../locales/en-US.json";
import esESTranslations from "../../locales/es-ES.json";
import etEETranslations from "../../locales/et-EE.json";
import frFRTranslations from "../../locales/fr-FR.json";
import hiINTranslations from "../../locales/hi-IN.json";
import huHUTranslations from "../../locales/hu-HU.json";
import idIDTranslations from "../../locales/id-ID.json";
import itITTranslations from "../../locales/it-IT.json";
import jaJPTranslations from "../../locales/ja-JP.json";
import kmKHTranslations from "../../locales/km-KH.json";
import neNPTranslations from "../../locales/ne-NP.json";
import nlNLTranslations from "../../locales/nl-NL.json";
import ptBRTranslations from "../../locales/pt-BR.json";
import roROTranslations from "../../locales/ro-RO.json";
import ruRUTranslations from "../../locales/ru-RU.json";
import svSETranslations from "../../locales/sv-SE.json";
import trTRTranslations from "../../locales/tr-TR.json";
import urPKTranslations from "../../locales/ur-PK.json";
import uzUZTranslations from "../../locales/uz-UZ.json";
import viVNTranslations from "../../locales/vi-VN.json";
import zhHansCNTranslations from "../../locales/zh-Hans-CN.json";
import zhHantTWTranslations from "../../locales/zh-Hant-TW.json";

/**
 * Map any requested language tag to the bundle we actually ship, then English.
 *
 * Bundles are keyed by each language's canonical CLDR-default tag (`de-DE`, `ar-EG`, `zh-Hans-CN`), and
 * `resolveSurveyLanguageDefaultTag` is what turns a requested tag into that key — `de-AT`/`de` -> `de-DE`,
 * `pt-PT` -> `pt-BR`, while preserving script so `zh-Hant`/`zh-TW` resolve to Traditional. It is shared
 * with the workspace default-language picker, which uses it to decide whether a language has strings at
 * all, so the two can never disagree about what this runtime serves.
 */
export const resolveFallbackBundles = (code: string): string[] => {
  const defaultBundle = resolveSurveyLanguageDefaultTag(code);
  return defaultBundle && defaultBundle !== code
    ? [defaultBundle, DEFAULT_SURVEY_LANGUAGE_CODE]
    : [DEFAULT_SURVEY_LANGUAGE_CODE];
};

// Vertx fork note: this Formbricks instance serves a single Portuguese-language project end to end,
// so the survey "chrome" strings (Required, Takes X minutes, Please fill out this field, etc.) must
// always render in pt-BR. Normally that would come from the survey's `defaultLanguage`/`languages`,
// but this particular survey's content was saved under the "en-US" key by an early configuration
// mistake, and the management API's PATCH /surveys endpoint does not accept `defaultLanguage` as an
// editable field (nor would server-side validation allow `languages[].default` to disagree with the
// stored `defaultLanguage`), so it cannot be corrected after creation. Rather than depend on that,
// force the chrome locale here, independent of whatever language code the survey/backend reports.
//
// This only affects the i18next-driven UI chrome (via this shared `i18n` instance) — it does not
// touch question/choice CONTENT, which is looked up separately by `getLocalizedValue`/`getI18nLanguage`
// against the survey's own language-keyed content object and must keep resolving "en-US"/"default".
export const FORCED_SURVEY_CHROME_LANGUAGE = "pt-BR";

i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: FORCED_SURVEY_CHROME_LANGUAGE,
    fallbackLng: resolveFallbackBundles,
    supportedLngs: [...SURVEY_RUNTIME_LANGUAGE_CODES],

    resources: {
      "ar-EG": { translation: arEGTranslations },
      "da-DK": { translation: daDKTranslations },
      "de-DE": { translation: deDETranslations },
      "en-US": { translation: enUSTranslations },
      "es-ES": { translation: esESTranslations },
      "et-EE": { translation: etEETranslations },
      "fr-FR": { translation: frFRTranslations },
      "hi-IN": { translation: hiINTranslations },
      "hu-HU": { translation: huHUTranslations },
      "id-ID": { translation: idIDTranslations },
      "it-IT": { translation: itITTranslations },
      "ja-JP": { translation: jaJPTranslations },
      "km-KH": { translation: kmKHTranslations },
      "ne-NP": { translation: neNPTranslations },
      "nl-NL": { translation: nlNLTranslations },
      "pt-BR": { translation: ptBRTranslations },
      "ro-RO": { translation: roROTranslations },
      "ru-RU": { translation: ruRUTranslations },
      "sv-SE": { translation: svSETranslations },
      "tr-TR": { translation: trTRTranslations },
      "ur-PK": { translation: urPKTranslations },
      "uz-UZ": { translation: uzUZTranslations },
      "vi-VN": { translation: viVNTranslations },
      "zh-Hans-CN": { translation: zhHansCNTranslations },
      "zh-Hant-TW": { translation: zhHantTWTranslations },
    },

    interpolation: { escapeValue: false },
  });

// Every caller in this codebase that wants to change the chrome language ultimately calls
// `i18n.changeLanguage` on this shared singleton (I18nProvider, LanguageSwitch, getTranslations()).
// Overriding it here — rather than at each call site — is the one chokepoint that guarantees none of
// them can drift the chrome UI away from pt-BR, including future call sites.
const originalChangeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = ((_lng?: string, callback?: (...args: any[]) => void) =>
  originalChangeLanguage(FORCED_SURVEY_CHROME_LANGUAGE, callback)) as typeof i18n.changeLanguage;

export default i18n;
