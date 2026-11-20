import React, { useState, useEffect } from 'react';

interface AvatarProps {
  name: string;
  photoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
};

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
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const showImage = Boolean(photoUrl && !imgError);

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full bg-[#242422] border border-[#343430] text-[#edece8] font-medium flex items-center justify-center overflow-hidden shrink-0 select-none ${className}`}
    >
      {showImage ? (
        <img
          src={photoUrl}
          alt={name}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
};
