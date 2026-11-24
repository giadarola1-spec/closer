import React, { useState, useEffect } from 'react';
import { Play, ExternalLink } from 'lucide-react';
import { YouTubeLinkPreview } from '../utils/youtube.ts';

interface YouTubeThumbnailCardProps {
  preview: YouTubeLinkPreview;
  compact?: boolean;
  className?: string;
}

export const YouTubeThumbnailCard: React.FC<YouTubeThumbnailCardProps> = ({
  preview,
  compact = false,
  className = '',
}) => {
  const [src, setSrc] = useState(preview.thumbnailUrl);
  const [usedFallback, setUsedFallback] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setSrc(preview.thumbnailUrl);
    setUsedFallback(false);
    setHidden(false);
  }, [preview.videoId, preview.thumbnailUrl]);

  if (hidden) return null;

  const handleImageError = () => {
    if (!usedFallback) {
      setUsedFallback(true);
      setSrc(preview.fallbackThumbnailUrl);
    } else {
      setHidden(true);
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // YouTube returns a 120x90 grey placeholder when a video thumbnail is unavailable
    if (e.currentTarget.naturalWidth === 120 && e.currentTarget.naturalHeight === 90) {
      handleImageError();
    }
  };

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Watch video on YouTube"
      title="Open video on YouTube"
      className={`group relative block overflow-hidden rounded-xl border border-[#262624] hover:border-[#3d3d39] bg-[#141413] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#edece8]/40 ${
        compact ? 'w-full max-w-[260px]' : 'w-full sm:max-w-[360px]'
      } ${className}`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[#0f0f0e]">
        <img
          src={src}
          alt="YouTube video thumbnail"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleImageError}
          onLoad={handleImageLoad}
          className="block h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span
            className={`flex items-center justify-center rounded-full bg-black/75 border border-white/20 text-white shadow-lg backdrop-blur-xs transition-colors group-hover:bg-[#ff0000] group-hover:border-[#ff0000] ${
              compact ? 'size-9' : 'size-11'
            }`}
          >
            <Play
              className={`fill-current ml-0.5 ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}
            />
          </span>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-black/70 border border-white/10 px-2 py-0.5 text-[10px] font-medium text-[#edece8] tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff0000]" aria-hidden="true" />
            YouTube
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#d1d1cf] group-hover:text-white transition-colors">
            <ExternalLink className="w-3 h-3" />
          </span>
        </div>
      </div>
    </a>
  );
};
