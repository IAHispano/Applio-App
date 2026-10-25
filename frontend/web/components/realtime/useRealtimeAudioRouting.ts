"use client";
import type React from "react";
import { useEffect } from "react";
import type { RealtimeAudioSession } from "@/components/realtime/types";
import { errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { connectRealtimeOutput } from "@/lib/realtime-output";
import { connectVoiceFocus, realtimeMicrophoneConstraints, type VoiceFocusVariant } from "@/lib/voice-focus";

interface AudioRoutingOptions {
  sessRef: React.RefObject<RealtimeAudioSession | null>;
  streaming: boolean;
  inDev: string;
  controlRef: React.RefObject<{ start: () => void; stop: (_silent?: boolean) => void }>;
  setMsg: React.Dispatch<React.SetStateAction<string>>;
  audioRoutingRef: React.RefObject<{ input: string; output: string; focus: VoiceFocusVariant }>;
  voiceFocus: VoiceFocusVariant;
  audioApplyCountRef: React.RefObject<number>;
  setApplyingAudio: React.Dispatch<React.SetStateAction<boolean>>;
  voiceFocusCleanupRef: React.RefObject<(() => Promise<void>) | null>;
  setVoiceFocusError: React.Dispatch<React.SetStateAction<string>>;
  setInDev: React.Dispatch<React.SetStateAction<string>>;
  setVoiceFocus: React.Dispatch<React.SetStateAction<VoiceFocusVariant>>;
  outDev: string;
  outGainNodeRef: React.RefObject<GainNode | null>;
  setOutDev: React.Dispatch<React.SetStateAction<string>>;
}
export function useRealtimeAudioRouting(options: AudioRoutingOptions) {
  const { t } = useI18n();
  const {
    sessRef,
    streaming,
    inDev,
    controlRef,
    setMsg,
    audioRoutingRef,
    voiceFocus,
    audioApplyCountRef,
    setApplyingAudio,
    voiceFocusCleanupRef,
    setVoiceFocusError,
    setInDev,
    setVoiceFocus,
    outDev,
    outGainNodeRef,
    setOutDev,
  } = options;
  useEffect(() => {
    const session = sessRef.current;
    if (!streaming || !session) return;
    if (!inDev) {
      controlRef.current.stop();
      setMsg(t("Select input and output devices before starting realtime."));
      return;
    }
    const previous = { ...audioRoutingRef.current };
    if (previous.input === inDev && previous.focus === voiceFocus) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      audioApplyCountRef.current++;
      setApplyingAudio(true);
      void (async () => {
        let stream: MediaStream | undefined;
        let source: MediaStreamAudioSourceNode | undefined;
        let bridge: GainNode | undefined;
        let cleanup: (() => Promise<void>) | undefined;
        let committed = false;
        try {
          // Reopening the same microphone can mute the existing track in
          // WebKit. A Voice Focus change only needs different constraints.
          if (previous.input === inDev) {
            stream = session.stream;
            await stream
              .getAudioTracks()[0]
              ?.applyConstraints(realtimeMicrophoneConstraints(inDev, voiceFocus));
          } else {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: realtimeMicrophoneConstraints(inDev, voiceFocus),
            });
          }
          if (cancelled || sessRef.current !== session) return;
          source = session.ctx.createMediaStreamSource(stream);
          bridge = session.ctx.createGain();
          if (voiceFocus === "off") source.connect(bridge);
          else cleanup = await connectVoiceFocus(session.ctx, source, bridge, stream, voiceFocus);
          if (cancelled || sessRef.current !== session) return;
          const oldStream = session.stream;
          const oldSource = session.nodes[0];
          const oldBridge = session.inputBridge;
          const oldCleanup = voiceFocusCleanupRef.current;
          bridge.connect(session.nodes[1]);
          source.connect(session.playback);
          oldSource.disconnect();
          oldBridge?.disconnect();
          session.stream = stream;
          session.nodes[0] = source;
          session.nodes = session.nodes.filter((node) => node !== oldBridge);
          session.nodes.push(bridge);
          session.inputBridge = bridge;
          session.inputLatencyMs =
            ((stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number })
              ?.latency || 0) * 1000;
          voiceFocusCleanupRef.current = cleanup || null;
          audioRoutingRef.current.input = inDev;
          audioRoutingRef.current.focus = voiceFocus;
          committed = true;
          if (oldStream !== stream)
            oldStream.getTracks().forEach((track) => {
              track.stop();
            });
          void oldCleanup?.().catch(() => {});
          setVoiceFocusError("");
          setMsg(t("Settings applied"));
        } catch (error) {
          if (!cancelled && sessRef.current === session) {
            setInDev(previous.input);
            setVoiceFocus(previous.focus);
            setVoiceFocusError(errMsg(error));
            setMsg(t("Could not apply settings: {message}", { message: t(errMsg(error)) }));
          }
        } finally {
          if (!committed) {
            if (stream !== session.stream) {
              stream?.getTracks().forEach((track) => {
                track.stop();
              });
            } else if (!cancelled && sessRef.current === session) {
              await stream
                ?.getAudioTracks()[0]
                ?.applyConstraints(realtimeMicrophoneConstraints(previous.input, previous.focus))
                .catch(() => {});
            }
            source?.disconnect();
            bridge?.disconnect();
            await cleanup?.().catch(() => {});
          }
          audioApplyCountRef.current--;
          setApplyingAudio(audioApplyCountRef.current > 0);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    sessRef,
    streaming,
    inDev,
    controlRef,
    setMsg,
    audioRoutingRef,
    voiceFocus,
    audioApplyCountRef,
    setApplyingAudio,
    voiceFocusCleanupRef,
    setVoiceFocusError,
    setInDev,
    setVoiceFocus,
    t,
  ]);
  useEffect(() => {
    const session = sessRef.current;
    if (!streaming || !session || audioRoutingRef.current.output === outDev) return;
    if (!outDev) {
      controlRef.current.stop();
      setMsg(t("Select input and output devices before starting realtime."));
      return;
    }
    const previous = audioRoutingRef.current.output;
    let cancelled = false;
    const timer = setTimeout(() => {
      audioApplyCountRef.current++;
      setApplyingAudio(true);
      void (async () => {
        const bridge = session.ctx.createGain();
        let elements: HTMLAudioElement[] = [];
        let committed = false;
        try {
          elements = await connectRealtimeOutput(session.ctx, bridge, outDev);
          if (cancelled || sessRef.current !== session) return;
          const gain = outGainNodeRef.current;
          if (!gain) return;
          gain.disconnect();
          gain.connect(bridge);
          session.outputBridge?.disconnect();
          session.nodes = session.nodes.filter((node) => node !== session.outputBridge);
          session.nodes.push(bridge);
          session.outputBridge = bridge;
          session.els.forEach((element) => {
            element.pause();
            element.srcObject = null;
          });
          session.els = elements;
          audioRoutingRef.current.output = outDev;
          committed = true;
          setMsg(t("Settings applied"));
        } catch (error) {
          if (!cancelled && sessRef.current === session) {
            setOutDev(previous);
            setMsg(t("Could not apply settings: {message}", { message: t(errMsg(error)) }));
          }
        } finally {
          if (!committed) {
            bridge.disconnect();
            elements.forEach((element) => {
              element.pause();
              element.srcObject = null;
            });
          }
          audioApplyCountRef.current--;
          setApplyingAudio(audioApplyCountRef.current > 0);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    sessRef,
    streaming,
    audioRoutingRef,
    outDev,
    controlRef,
    setMsg,
    audioApplyCountRef,
    setApplyingAudio,
    outGainNodeRef,
    setOutDev,
    t,
  ]);
}
