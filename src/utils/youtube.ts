export interface YouTubeLinkPreview {
  videoId: string;
  url: string;
  thumbnailUrl: string;
  fallbackThumbnailUrl: string;
}

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const URL_CANDIDATE_REGEX =
  /(?:^|[\s(<"'])((?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"']+)/gi;

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,!?;:)\]]+$/g, '');
}

function normalizeCandidateUrl(raw: string): URL | null {
  const cleaned = stripTrailingPunctuation(raw.trim());
  if (!cleaned) return null;

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) {
      return null;
    }
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const parsed = normalizeCandidateUrl(rawUrl);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const candidate = segments[0] || '';
    return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
  }

  if (segments[0] === 'watch' || parsed.pathname === '/watch') {
    const v = parsed.searchParams.get('v') || '';
    return YOUTUBE_ID_REGEX.test(v) ? v : null;
  }

  if (
    segments.length >= 2 &&
    ['shorts', 'embed', 'live', 'v', 'e'].includes(segments[0])
  ) {
    const candidate = segments[1] || '';
    return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
  }

  // Fallback: ?v= on other valid YouTube paths (e.g., attribution_link or root)
  const vParam = parsed.searchParams.get('v') || '';
  return YOUTUBE_ID_REGEX.test(vParam) ? vParam : null;
}

export function extractYouTubeLinks(text: string, maxItems = 3): YouTubeLinkPreview[] {
  if (!text || typeof text !== 'string') return [];

  const results: YouTubeLinkPreview[] = [];
  const seenIds = new Set<string>();
  URL_CANDIDATE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_CANDIDATE_REGEX.exec(text)) !== null) {
    const candidate = match[1];
    if (!candidate) continue;

    const parsed = normalizeCandidateUrl(candidate);
    if (!parsed) continue;

    const videoId = extractYouTubeVideoId(parsed.toString());
    if (!videoId || seenIds.has(videoId)) continue;

    seenIds.add(videoId);
    results.push({
      videoId,
      url: parsed.toString(),
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      fallbackThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    });

    if (results.length >= maxItems) break;
  }

  return results;
}
