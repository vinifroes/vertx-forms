/**
 * Vertx-fork-specific helper: fetches Brazilian municipality names for a given state (UF) from the
 * public IBGE "localidades" API, at render time in the respondent's browser.
 *
 * Why this exists: Formbricks has no concept of one element's choices depending on another
 * element's answer (see `packages/types/surveys/elements.ts` — no such field), and packaging a
 * static ~5.570-municipality dataset into the survey bundle would bloat every survey load for a
 * feature only this one project's block 01 (b1q5 "estado" -> b1q6 "município") needs. Fetching on
 * demand, keyed by the 2-letter UF the respondent just picked, avoids both problems. See
 * `BlockConditional`'s municipio-dependency handling for how this is wired to the UI.
 */

const IBGE_MUNICIPIOS_ENDPOINT = (uf: string) =>
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`;

// Module-level cache: the respondent may flip back and forth between states while answering (or
// re-open the same UF), and there is no reason to hit the IBGE API again for a UF already fetched
// during this page load.
const municipiosCache = new Map<string, string[]>();

interface IbgeMunicipioResponse {
  nome?: unknown;
}

/**
 * Resolves to the sorted list of municipality names for `uf` (e.g. "GO", "SP"), or `null` if the
 * list could not be obtained for any reason (network failure, non-2xx response, a timeout, or an
 * unexpected payload shape). This never throws — callers must treat `null` as "fetching failed,
 * fall back to a manual/free-text input" rather than as an empty result to render as-is.
 */
export async function fetchMunicipiosByUf(uf: string, timeoutMs = 8000): Promise<string[] | null> {
  const normalizedUf = uf.trim().toUpperCase();
  if (!normalizedUf) return null;

  const cached = municipiosCache.get(normalizedUf);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(IBGE_MUNICIPIOS_ENDPOINT(normalizedUf), { signal: controller.signal });
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (!Array.isArray(data)) return null;

    const names = (data as IbgeMunicipioResponse[])
      .map((item) => (item && typeof item.nome === "string" ? item.nome : null))
      .filter((name): name is string => Boolean(name));

    if (names.length === 0) return null;

    const sorted = [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
    municipiosCache.set(normalizedUf, sorted);
    return sorted;
  } catch {
    // Covers network errors, JSON parse errors, and the AbortController timeout firing.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
