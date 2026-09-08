"use client";

// Shared click-to-play controller. One hidden <audio> per component plays
// short clips from the session's media endpoint; playback windows come from
// token/utterance timestamps so a concordance hit or utterance can be heard
// in context (playback starts 0.8 s before and ends 0.8 s after the span).
import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioPlay(audioId: string | null) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    elRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
      elRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    elRef.current?.pause();
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    setPlaying(null);
  }, []);

  const play = useCallback(
    (fromMs: number, toMs: number | null, key: string) => {
      const el = elRef.current;
      if (!el || !audioId) return;
      const src = `/api/media/${audioId}`;
      if (!el.src || el.src !== new URL(src, window.location.href).href) {
        el.src = src;
        el.load();
      }
      const onSeek = () => {
        el.removeEventListener("seeked", onSeek);
        void el.play().catch(() => setPlaying(null));
      };
      el.addEventListener("seeked", onSeek);
      el.currentTime = Math.max(0, fromMs / 1000);
      setPlaying(key);
      if (stopTimer.current) clearTimeout(stopTimer.current);
      const windowSec = toMs !== null ? Math.max(0.4, (toMs - fromMs) / 1000 + 1.6) : null;
      if (windowSec !== null) {
        stopTimer.current = setTimeout(() => {
          el.pause();
          setPlaying(null);
          stopTimer.current = null;
        }, windowSec * 1000);
      }
    },
    [audioId]
  );

  return { play, stop, playing };
}
