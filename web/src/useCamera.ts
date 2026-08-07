import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera plumbing, in one place because getting it wrong is silent.
 *
 * The stream must be attached to the <video> in an effect, not immediately
 * after calling setState: React commits the DOM asynchronously, so the element
 * does not exist yet at that point. Attaching too early leaves srcObject
 * unset, and the failure is invisible — the video stays black, videoWidth
 * stays 0, and any capture produces an empty canvas that looks like a
 * corrupt-image error much further downstream.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    const onReady = () => setReady(video.videoWidth > 0);
    video.addEventListener('loadedmetadata', onReady);
    void video.play().catch(() => {
      setError('The browser blocked video playback.');
    });

    return () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.srcObject = null;
    };
  }, [stream]);

  const stop = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setReady(false);
  }, []);

  const start = useCallback(async (square: boolean) => {
    setError(null);
    setReady(false);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: square
          ? { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }
          : { facingMode: 'environment', width: { ideal: 1280 } },
      });
      setStream(next);
      return true;
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in the address bar and try again.'
          : name === 'NotFoundError'
            ? 'No camera found on this device.'
            : 'Could not open the camera. It needs permission, and HTTPS or localhost.',
      );
      return false;
    }
  }, []);

  // Never leave the camera light on.
  useEffect(() => stop, [stop]);

  return { videoRef, stream, ready, error, setError, start, stop };
}
