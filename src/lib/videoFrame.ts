import type { ImageSource } from '../services/geminiService';

export async function videoUrlToFirstFrameSource(url: string): Promise<ImageSource> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('video load timeout')), 60000);
    video.onloadeddata = () => {
      window.clearTimeout(t);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(t);
      reject(new Error('video load failed'));
    };
  });

  video.currentTime = Math.min(0.1, (video.duration || 8) * 0.02);
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('seek timeout')), 15000);
    video.onseeked = () => {
      window.clearTimeout(t);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(t);
      reject(new Error('seek failed'));
    };
  });

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w < 2 || h < 2) throw new Error('invalid video dimensions');
  const canvas = document.createElement('canvas');
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.85);
  video.src = '';
  return { data, mimeType: 'image/jpeg' };
}
