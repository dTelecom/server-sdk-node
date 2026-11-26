/** Endpoints ranked by the issuer. Keep the original URL for each distinct node. */
export function rankedUrls(primary: string, candidates: string[] = []): string[] {
  const urls = [primary];
  const seen = new Set<string>();
  const key = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol)) return undefined;
      return parsed.href.replace(/^http/, 'ws').replace(/\/$/, '');
    } catch {
      return undefined;
    }
  };
  const first = key(primary);
  if (first) seen.add(first);
  for (const url of candidates) {
    const id = key(url);
    if (!id || seen.has(id) || (first?.startsWith('wss:') && id.startsWith('ws:'))) continue;
    seen.add(id);
    urls.push(url);
  }
  return urls;
}

/** Only transport failures may advance to a different signaling endpoint. */
export class TransportError extends Error {}
export class SessionEnded extends Error {}
