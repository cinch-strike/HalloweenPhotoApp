const MAX_EDGE = 1600;

/**
 * Resize a camera/library photo to a JPEG with a ~1600px long edge, applying EXIF orientation.
 * iOS hands HEIC over as JPEG through the file input, and createImageBitmap decodes what the browser can display.
 */
export async function resizeToJpeg(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo format isn’t supported here — try a different photo or take a new one.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo'))), 'image/jpeg', 0.85),
  );
}
