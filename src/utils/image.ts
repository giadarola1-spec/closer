import { LIMITS } from '../types/team.ts';

export function sanitizePhotoUrl(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.length > LIMITS.PHOTO_URL_MAX) return '';
  if (
    /^https:\/\/.+/.test(trimmed) ||
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return '';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read selected image file.'));
    img.src = src;
  });
}

function renderSquareJpeg(img: HTMLImageElement, size: number, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sx = ((img.naturalWidth || img.width) - minSide) / 2;
  const sy = ((img.naturalHeight || img.height) - minSide) / 2;

  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function compressProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (PNG, JPG, or WebP).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Image is too large (max 15 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    const attempts: [number, number][] = [
      [160, 0.8],
      [160, 0.62],
      [120, 0.68],
      [96, 0.58],
    ];

    for (const [size, quality] of attempts) {
      const dataUrl = renderSquareJpeg(img, size, quality);
      if (dataUrl.length <= LIMITS.PHOTO_URL_MAX - 200) {
        return dataUrl;
      }
    }

    throw new Error('Image could not be compressed small enough. Please choose another photo.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
