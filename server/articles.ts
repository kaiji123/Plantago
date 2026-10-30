// Short plant and tool articles from Wikipedia's REST API, cached in memory.
// Content is CC BY-SA 4.0; the page shows attribution and a link to the article.

export interface Article {
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
  license: string;
}

const cache = new Map<string, { at: number; article: Article }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function wikipediaSummary(title: string): Promise<Article> {
  const hit = cache.get(title);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.article;
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": "Plantago/0.1 (PayPal AI Hackathon demo; https://github.com/)", Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  const v = (await res.json()) as any;
  const article: Article = {
    title: v.title,
    extract: v.extract ?? "",
    url: v.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumbnail: v.thumbnail?.source ?? null,
    license: "CC BY-SA 4.0",
  };
  cache.set(title, { at: Date.now(), article });
  return article;
}
