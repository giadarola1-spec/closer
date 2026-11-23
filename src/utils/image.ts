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

export const CLOUDINARY_CLOUD_NAME = 'uk6nkyzk';
export const CLOUDINARY_UPLOAD_PRESET = 'closerimages';
export const CLOUDINARY_UPLOAD_ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
export const MAX_POST_IMAGE_BYTES = 15 * 1024 * 1024;

export function sanitizePostImageUrl(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.length > LIMITS.IMAGE_URL_MAX) return '';
  if (/^https:\/\/.+/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export async function uploadPostImageToCloudinary(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (PNG, JPG, WebP, or GIF).');
  }
  if (file.size > MAX_POST_IMAGE_BYTES) {
    throw new Error('Image is too large (max 15 MB).');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  let response: Response;
  try {
    response = await fetch(CLOUDINARY_UPLOAD_ENDPOINT, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw new Error('Network error while uploading image. Please check your connection and try again.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage =
      typeof data?.error?.message === 'string' && data.error.message.trim()
        ? data.error.message.trim()
        : `Image upload failed (HTTP ${response.status}).`;
    throw new Error(apiMessage);
  }

  const secureUrl = typeof data?.secure_url === 'string' ? data.secure_url.trim() : '';
  if (!secureUrl || !/^https:\/\/.+/.test(secureUrl)) {
    throw new Error('Image upload succeeded but did not return a valid secure URL.');
  }

  return secureUrl;
}

