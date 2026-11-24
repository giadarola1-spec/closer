import React, { useEffect, useRef } from 'react';

const TILE_SIZE = 512;

// Rich CRT/RGB subpixel palette for crisp, colorful chromatic TV static
const CHROMATIC_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 59, 92],   // Crimson
  [34, 211, 238],  // Cyan
  [59, 130, 246],  // Cobalt blue
  [34, 197, 94],   // Emerald green
  [251, 191, 36],  // Amber gold
  [217, 70, 239],  // Magenta
  [249, 115, 22],  // Warm orange
  [129, 140, 248], // Periwinkle
];

function createNoiseTile(): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = TILE_SIZE;
  tile.height = TILE_SIZE;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return tile;

  const imageData = tileCtx.createImageData(TILE_SIZE, TILE_SIZE);
  const data = imageData.data;

  // Seeded PRNG so grain density & color balance stay deterministic
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const idx = (y * TILE_SIZE + x) * 4;
      const roll = rand();

      if (roll < 0.4) {
        // Leave transparent unless filled as the second half of a 2x1 subpixel fleck
        continue;
      }

      if (roll < 0.88) {
        const color =
          CHROMATIC_PALETTE[Math.floor(rand() * CHROMATIC_PALETTE.length)];
        const brightness = 0.72 + rand() * 0.35;
        data[idx] = Math.min(255, Math.round(color[0] * brightness));
        data[idx + 1] = Math.min(255, Math.round(color[1] * brightness));
        data[idx + 2] = Math.min(255, Math.round(color[2] * brightness));
        data[idx + 3] = Math.round(135 + rand() * 115);

        // Occasional 2x1 subpixel horizontal scan fleck for crispness on Retina displays
        if (rand() < 0.22 && x + 1 < TILE_SIZE) {
          const nextIdx = idx + 4;
          data[nextIdx] = data[idx];
          data[nextIdx + 1] = data[idx + 1];
          data[nextIdx + 2] = data[idx + 2];
          data[nextIdx + 3] = Math.round(data[idx + 3] * 0.85);
        }
      } else {
        // Subtle monochrome grain flecks to balance the RGB subpixels
        const luma = Math.round(95 + rand() * 135);
        data[idx] = luma;
        data[idx + 1] = luma;
        data[idx + 2] = luma;
        data[idx + 3] = Math.round(80 + rand() * 110);
      }
    }
  }

  tileCtx.putImageData(imageData, 0, 0);
  return tile;
}

export const AmbientChromaticStatic: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const tile = createNoiseTile();

    const paintStatic = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // Match CSS -inset-16 (+128px each axis) at crisp 1:1 CSS-pixel density
      const targetWidth = Math.ceil(rect.width) + 128;
      const targetHeight = Math.ceil(rect.height) + 128;

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      const pattern = ctx.createPattern(tile, 'repeat');
      if (!pattern) return;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    };

    paintStatic();

    const observer = new ResizeObserver(paintStatic);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="hidden lg:block fixed inset-y-0 right-0 w-[52vw] xl:w-[56vw] pointer-events-none select-none overflow-hidden z-0 ambient-static-mask"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] ambient-static-grain"
      />
    </div>
  );
};
