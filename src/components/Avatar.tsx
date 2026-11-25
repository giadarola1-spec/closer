import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { PresenceStatus } from '../types/team.ts';
import { PRESENCE_META } from '../utils/presence.ts';

interface AvatarProps {
  name: string;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  presenceStatus?: PresenceStatus;
  presenceRingClass?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
};

const DOT_SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-2 h-2 ring-[1.5px] -bottom-0.5 -right-0.5',
  sm: 'w-2.5 h-2.5 ring-2 -bottom-0.5 -right-0.5',
  md: 'w-2.5 h-2.5 ring-2 bottom-0 right-0',
  lg: 'w-3 h-3 ring-2 bottom-0 right-0',
};

const MAX_CACHE_ENTRIES = 250;
const loadedAvatarUrls = new Set<string>();
const failedAvatarUrls = new Set<string>();

function rememberUrl(set: Set<string>, url: string) {
  if (set.has(url)) return;
  if (set.size >= MAX_CACHE_ENTRIES) {
    const oldest = set.values().next().value;
    if (oldest) set.delete(oldest);
  }
  set.add(url);
}

function getInitials(name: string): string {
  const parts = (name || 'C').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  photoUrl,
  size = 'md',
  className = '',
  presenceStatus,
  presenceRingClass = 'ring-[#141413]',
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cleanUrl = photoUrl?.trim() || '';
  const isInlineDataUri = cleanUrl.startsWith('data:image/');

  const [loadedSrc, setLoadedSrc] = useState<string>(() =>
    cleanUrl && (isInlineDataUri || loadedAvatarUrls.has(cleanUrl)) ? cleanUrl : ''
  );
  const [failedSrc, setFailedSrc] = useState<string>(() =>
    cleanUrl && failedAvatarUrls.has(cleanUrl) ? cleanUrl : ''
  );
  const [showShimmer, setShowShimmer] = useState(false);
  const [shouldFade, setShouldFade] = useState(false);

  useEffect(() => {
    setShowShimmer(false);

    if (!cleanUrl) {
      setLoadedSrc('');
      setFailedSrc('');
      setShouldFade(false);
      return;
    }
    if (failedAvatarUrls.has(cleanUrl)) {
      setFailedSrc(cleanUrl);
      setLoadedSrc('');
      setShouldFade(false);
      return;
    }
    if (isInlineDataUri || loadedAvatarUrls.has(cleanUrl)) {
      setLoadedSrc(cleanUrl);
      setFailedSrc('');
      setShouldFade(false);
      return;
    }

    setLoadedSrc('');
    setFailedSrc('');
    setShouldFade(true);

    const timer = window.setTimeout(() => {
      setShowShimmer(true);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [cleanUrl, isInlineDataUri]);

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!cleanUrl || !img) return;
    if (img.complete) {
      if (img.naturalWidth > 0) {
        rememberUrl(loadedAvatarUrls, cleanUrl);
        setLoadedSrc(cleanUrl);
        setShowShimmer(false);
        setShouldFade(false);
      } else {
        rememberUrl(failedAvatarUrls, cleanUrl);
        setFailedSrc(cleanUrl);
        setShowShimmer(false);
      }
    }
  }, [cleanUrl]);

  const showImage = Boolean(
    cleanUrl && failedSrc !== cleanUrl && !failedAvatarUrls.has(cleanUrl)
  );
  const isReady = Boolean(
    showImage && (isInlineDataUri || loadedSrc === cleanUrl || loadedAvatarUrls.has(cleanUrl))
  );
  const presenceMeta = presenceStatus ? PRESENCE_META[presenceStatus] : null;

  return (
    <div
      aria-label={name}
      className={`relative ${SIZE_CLASSES[size]} shrink-0 select-none ${className}`}
    >
      <div className="relative w-full h-full rounded-full bg-[#242422] border border-[#343430] text-[#edece8] font-medium flex items-center justify-center overflow-hidden">
        {showImage ? (
          <>
            {!isReady && showShimmer && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full skeleton-shimmer"
              />
            )}
            <img
              key={cleanUrl}
              ref={imgRef}
              src={cleanUrl}
              alt=""
              decoding="async"
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={() => {
                rememberUrl(loadedAvatarUrls, cleanUrl);
                setLoadedSrc(cleanUrl);
                setShowShimmer(false);
              }}
              onError={() => {
                rememberUrl(failedAvatarUrls, cleanUrl);
                setFailedSrc(cleanUrl);
                setShowShimmer(false);
              }}
              className={`absolute inset-0 w-full h-full object-cover ${
                shouldFade ? 'transition-opacity duration-150' : ''
              } ${isReady ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <span>{getInitials(name)}</span>
        )}
      </div>

      {presenceMeta && (
        <span
          title={presenceMeta.label}
          aria-label={presenceMeta.label}
          className={`absolute ${DOT_SIZE_CLASSES[size]} rounded-full ${presenceMeta.dotClass} ${presenceRingClass}`}
        />
      )}
    </div>
  );
};
