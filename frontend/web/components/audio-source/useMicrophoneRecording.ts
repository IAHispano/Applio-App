"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { blobToWavFile, pickRecordingMimeType } from "./recording";

function stopTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() || []) track.stop();
}

interface RecordingSession {
  recorder: MediaRecorder;
  stream: MediaStream;
}

export function useMicrophoneRecording({
  disabled,
  onRecorded,
}: {
  disabled: boolean;
  onRecorded: (file: File) => void;
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [micError, setMicError] = useState("");
  const session = useRef<RecordingSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ disabled, onRecorded, t });
  latest.current = { disabled, onRecorded, t };

  function clearTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      const current = session.current;
      session.current = null;
      if (!current) return;
      current.recorder.onstop = null;
      current.recorder.ondataavailable = null;
      try {
        if (current.recorder.state !== "inactive") current.recorder.stop();
      } finally {
        stopTracks(current.stream);
      }
    };
  }, []);

  async function startMic() {
    if (latest.current.disabled || starting.current || session.current) return;
    const epoch = ++generation.current;
    const current = () => mounted.current && generation.current === epoch;
    starting.current = true;
    setMicError("");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current() || latest.current.disabled) {
        stopTracks(stream);
        return;
      }
      const mime = pickRecordingMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const capture = { recorder, stream };
      session.current = capture;
      recorder.ondataavailable = (event) => {
        if (current() && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stopTracks(capture.stream);
        if (session.current === capture) session.current = null;
        if (!current()) return;
        clearTimer();
        setRecording(false);
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        void blobToWavFile(blob, `mic-recording-${Date.now()}`)
          .then((file) => {
            if (current()) latest.current.onRecorded(file);
          })
          .catch(() => {
            if (current())
              setMicError(latest.current.t("Could not process the recording — try uploading a WAV file."));
          });
      };
      recorder.start();
      setRecording(true);
      setRecDuration(0);
      timer.current = setInterval(() => {
        if (current()) setRecDuration((duration) => duration + 1);
      }, 1000);
    } catch {
      // Permission may succeed even when recorder construction/start fails.
      // That stream still belongs to this hook and must release its tracks.
      if (session.current?.stream === stream) {
        session.current.recorder.onstop = null;
        session.current.recorder.ondataavailable = null;
      }
      stopTracks(stream);
      if (current()) {
        session.current = null;
        clearTimer();
        setMicError(latest.current.t("Microphone unavailable — check permissions."));
        setRecording(false);
      }
    } finally {
      starting.current = false;
    }
  }

  function stopMic() {
    const recorder = session.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  return { recording, recDuration, micError, startMic, stopMic };
}
