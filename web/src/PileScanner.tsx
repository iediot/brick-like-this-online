import { useEffect, useState } from 'react';
import type { InventoryEntry } from '@shared/inventory.ts';
import { api, type ScannerStatus } from './api.ts';
import { useCamera } from './useCamera.ts';

type Phase = 'closed' | 'live' | 'thinking';

export function PileScanner({ onResult }: { onResult: (entries: InventoryEntry[]) => void }) {
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('closed');
  const [failure, setFailure] = useState<string | null>(null);
  const camera = useCamera();

  // api.scanStatus answers "no scanner here" rather than failing, so this
  // always settles. Leaving it unset on failure parked the button on
  // "Checking scanner…" for good anywhere the app is served without one.
  useEffect(() => {
    void api.scanStatus().then(setStatus);
  }, []);

  const open = async () => {
    setFailure(null);
    if (await camera.start(false)) setPhase('live');
  };

  const close = () => {
    camera.stop();
    setPhase('closed');
  };

  const capture = async () => {
    const video = camera.videoRef.current;
    // A zero-dimension video yields an empty canvas, whose data URL is not a
    // valid image. Refuse rather than send something the model cannot read.
    if (!video || video.videoWidth === 0) {
      setFailure('The camera has not produced a frame yet. Give it a second and try again.');
      return;
    }

    // Downscale before sending: the model gains nothing from full sensor
    // resolution and a smaller image is markedly faster.
    const maxEdge = 900;
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = canvas.toDataURL('image/jpeg', 0.85);
    camera.stop();
    setPhase('thinking');
    setFailure(null);

    try {
      const { entries } = await api.scanPile(image);
      if (entries.length === 0) {
        setFailure('No pieces spotted. Try spreading them out in a single layer.');
      } else {
        onResult(entries);
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setPhase('closed');
    }
  };

  const ready = status?.running && status.modelReady;
  const message = failure ?? camera.error;

  if (status && !ready) {
    return (
      <p className="muted scanner-off">
        {/* This sits in the save bar, under the grid of steppers. */}
        Scanner offline — add pieces by hand above. {status.detail ?? ''}
      </p>
    );
  }

  return (
    <div className="scanner">
      {phase === 'closed' ? (
        <button onClick={() => void open()} disabled={!status}>
          {status ? 'Scan my pile' : 'Checking scanner…'}
        </button>
      ) : null}

      {phase === 'live' ? (
        <div className="center">
          <div className="viewport wide">
            <video ref={camera.videoRef} playsInline muted autoPlay />
          </div>
          <p className="muted">
            {camera.ready
              ? 'Spread the pieces in a single layer and fill the frame.'
              : 'Waiting for the camera…'}
          </p>
          <div className="actions center-actions">
            <button onClick={close}>Cancel</button>
            <button className="primary" onClick={() => void capture()} disabled={!camera.ready}>
              Take photo
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'thinking' ? (
        <p className="muted">Looking at your pieces… this takes a few seconds.</p>
      ) : null}

      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
