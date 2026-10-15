// Barcode reading with zxing-wasm (ZXing C++ compiled to WebAssembly). Much better than html5-qrcode at
// 1D product barcodes (EAN-13, UPC-A) in phone photos and on webcams. Loaded only when first used.
let zx = null;
async function reader() {
  if (!zx) {
    const mod = await import('zxing-wasm/reader');
    zx = mod.readBarcodes || mod.readBarcodesFromImageData || mod.readBarcodesFromImageFile;
  }
  return zx;
}
const OPTIONS = { tryHarder: true, maxNumberOfSymbols: 1 };

async function decode(input) {
  const read = await reader();
  const results = await read(input, OPTIONS);
  const hit = (results || []).find(r => r.text && (r.isValid === undefined || r.isValid));
  return hit ? hit.text.trim() : null;
}

// Draw (part of) an image or video frame onto a canvas, scaled down so the decoder isn't fed a 12-megapixel photo.
function frameToImageData(source, srcW, srcH, maxSide = 1600, crop = null, rotate = 0) {
  const [sx, sy, sw, sh] = crop || [0, 0, srcW, srcH];
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (rotate % 180) { canvas.width = h; canvas.height = w; } else { canvas.width = w; canvas.height = h; }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(source, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// ---------- photo upload ----------
export async function scanImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("That file couldn't be opened as an image. Try a JPG or PNG photo."); }
  const W = bitmap.width, H = bitmap.height;
  const attempts = [
    () => frameToImageData(bitmap, W, H, 1600),                      // whole photo, scaled
    () => frameToImageData(bitmap, W, H, 2400),                      // bigger, for small barcodes
    () => frameToImageData(bitmap, W, H, 1600, [W * 0.15, H * 0.2, W * 0.7, H * 0.6]), // centre crop
    () => frameToImageData(bitmap, W, H, 1600, null, 90),            // sideways photo
    () => file,                                                      // original file, full resolution
  ];
  try {
    for (const attempt of attempts) {
      const code = await decode(attempt());
      if (code) return code;
    }
  } catch (err) {
    if (String(err).toLowerCase().includes('fetch') || String(err).toLowerCase().includes('wasm')) {
      throw new Error('The barcode reader could not load (it needs internet the first time). Check your connection and try again.');
    }
    throw err;
  } finally {
    bitmap.close?.();
  }
  throw new Error("No barcode found in that photo. Fill most of the photo with the barcode, keep it sharp and well lit, or type the number instead.");
}

// ---------- live camera ----------
let session = null;

export async function startCamera(elementId, onCode) {
  await stopCamera();
  if (!window.isSecureContext) throw new Error('The camera needs https (or localhost). Upload a photo or type the barcode instead.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera. Upload a photo or type the barcode instead.');
  const host = document.getElementById(elementId);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    throw new Error(err?.name === 'NotAllowedError'
      ? 'Camera permission was declined. Allow it in the address bar, or upload a photo instead.'
      : 'No camera available. Upload a photo or type the barcode instead.');
  }
  // Ask for continuous autofocus where the camera supports it (phones); ignored elsewhere.
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }

  host.innerHTML = '<div class="scan-view"><video playsinline muted></video><div class="scan-guide"><span></span></div><p class="scan-hint">Hold the barcode inside the box, about 15 cm away</p></div>';
  const video = host.querySelector('video');
  video.srcObject = stream;
  await video.play();
  await reader(); // load the decoder before the first frame

  session = { stream, stop: false, host };
  const current = session;
  let busy = false;
  const tick = async () => {
    if (current.stop) return;
    if (!busy && video.readyState >= 2 && video.videoWidth) {
      busy = true;
      try {
        const W = video.videoWidth, H = video.videoHeight;
        // Centre band where the guide box is: easier and faster to decode than the full frame
        const code = await decode(frameToImageData(video, W, H, 1280, [W * 0.1, H * 0.25, W * 0.8, H * 0.5]))
          || await decode(frameToImageData(video, W, H, 1280));
        if (code && !current.stop) {
          navigator.vibrate?.(80);
          await stopCamera();
          onCode(code);
          return;
        }
      } catch { /* keep trying on the next frame */ }
      busy = false;
    }
    setTimeout(tick, 200);
  };
  tick();
}

export async function stopCamera() {
  if (!session) return;
  session.stop = true;
  session.stream.getTracks().forEach(t => t.stop());
  session.host.innerHTML = '';
  session = null;
}
