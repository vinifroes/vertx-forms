import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { IS_FORMBRICKS_CLOUD } from "@/lib/constants";
import { getSurveyBySlug } from "@/modules/survey/lib/slug";
import { getMetadataForLinkSurvey } from "@/modules/survey/link/metadata";

interface PrettyUrlPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// The redirect below reaches the browser as a client-side (streamed) redirect with HTTP 200, which
// link-preview crawlers (WhatsApp, Instagram, Facebook) never follow. Expose the survey's own
// metadata here so pretty URLs get the same title, description and og:image as /s/{surveyId}.
export async function generateMetadata(props: PrettyUrlPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;

  if (IS_FORMBRICKS_CLOUD) {
    return {};
  }

  const survey = await getSurveyBySlug(slug);
  if (!survey) {
    return {};
  }

  const languageCode = typeof searchParams.lang === "string" ? searchParams.lang : undefined;
  return getMetadataForLinkSurvey(survey.id, languageCode);
}

export default async function PrettyUrlPage(props: PrettyUrlPageProps) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;

  if (IS_FORMBRICKS_CLOUD) {
    return notFound();
  }

  const survey = await getSurveyBySlug(slug);
  if (!survey) {
    return notFound();
  }

  // Preserve query params (suId, lang, etc.)
  const queryString = new URLSearchParams(
    Object.entries(searchParams).filter(([_, v]) => v !== undefined) as [string, string][]
  ).toString();

  const baseUrl = `/s/${survey.id}`;
  const redirectUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  redirect(redirectUrl);
}
