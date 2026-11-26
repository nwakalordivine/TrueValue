// Shrinks a picture in the browser before it is uploaded, so profile pictures stay small
// (at most 512px on the longest side, JPEG quality 0.85).
export const MAX_SIDE = 512;
const UNREADABLE = 'That file could not be read as a picture.';

// The size that fits inside max x max, keeping the shape. Never makes a picture bigger.
export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Decodes the file, upright (phone photos carry their rotation in EXIF)
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(UNREADABLE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Resolves to a JPEG Blob
export async function resizeImage(file) {
  const image = await decode(file);
  const { width, height } = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNG areas would turn black in a JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  image.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error(UNREADABLE);
  return blob;
}
