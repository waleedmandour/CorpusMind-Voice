"use client";

// Shared click-to-play controller. One hidden <audio> per component plays
// short clips from the session's media endpoint; playback windows come from
// token/utterance timestamps so a concordance hit or utterance can be heard
// in context (playback starts 0.8 s before and ends 0.8 s after the span).
//
// v1.3 fix: the previous version assigned el.currentTime right after load(),
// before the browser had parsed any metadata. On a cold <audio> element that
// assignment throws (InvalidStateError) or is silently dropped, the "seeked"
// event never fires and play() is never reached - while the playing badge was
// already set, so the UI stuck in "playing" forever. Metadata is now awaited
// (loadedmetadata) before seeking, stale seek handlers are detached on every
// new request, and the badge clears when playback ends naturally.
import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioPlay(defaultAudioId: string | null) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekHandler = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    // full-file playback (no stop window) must still clear the badge
    el.addEventListener("ended", () => setPlaying(null));
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
    (fromMs: number, toMs: number | null, key: string, audioId?: string) => {
      const el = elRef.current;
      const id = audioId ?? defaultAudioId;
      if (!el || !id) return;
      const src = `/api/media/${id}`;
      if (!el.src || el.src !== new URL(src, window.location.href).href) {
        el.src = src;
        el.load();
      }
      // detach a seek handler from an earlier click that never completed
      if (seekHandler.current) {
        el.removeEventListener("seeked", seekHandler.current);
        seekHandler.current = null;
      }

      const seekTo = Math.max(0, fromMs / 1000);
      const beginPlayback = () => {
        void el.play().catch(() => setPlaying(null));
      };
      const onSeek = () => {
        el.removeEventListener("seeked", onSeek);
        seekHandler.current = null;
        beginPlayback();
      };

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

      try {
        if (el.readyState >= 1) {
          // metadata already parsed: seeking is safe right now
          el.addEventListener("seeked", onSeek);
          seekHandler.current = onSeek;
          el.currentTime = seekTo;
        } else {
          // cold element: wait for metadata, then seek (the seeked handler
          // above picks up from there)
          const onMeta = () => {
            el.removeEventListener("loadedmetadata", onMeta);
            el.addEventListener("seeked", onSeek);
            seekHandler.current = onSeek;
            try {
              el.currentTime = seekTo;
            } catch {
              beginPlayback();
            }
          };
          el.addEventListener("loadedmetadata", onMeta);
          if (el.readyState >= 1) {
            // metadata landed between the check and the listener
            el.removeEventListener("loadedmetadata", onMeta);
            onMeta();
          }
        }
      } catch {
        beginPlayback();
      }
    },
    [defaultAudioId]
  );

  return { play, stop, playing };
}
