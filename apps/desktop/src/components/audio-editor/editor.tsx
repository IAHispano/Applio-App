import React, { useRef, useState, useEffect, useCallback } from "react";
import {
	Play,
	Pause,
	Save,
	Scissors,
	CornerDownLeft,
	Volume2,
	ArrowLeft,
} from "lucide-react";
import { useAudioProcessor } from "../../hooks/useAudioProcessor";
import { bufferToWav } from "../../utils/audioUtils";
import WaveformVisualizer from "./waveform";
import Timeline from "./timeline/timeline";
import { formatTime } from "../../utils/time";
import SelectAudio from "./selectaudio";
import { getServerPort } from "../../utils/getBackendPort";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

const AudioEditorComponent: React.FC = () => {
	const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [selection, setSelection] = useState({ start: 0, end: 0 });
	const [volume, setVolume] = useState(1);

	const audioContextRef = useRef<AudioContext | null>(null);
	const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
	const gainNodeRef = useRef<GainNode | null>(null);
	const animationRef = useRef<number | null>(null);
	const pausedAtRef = useRef<number | null>(null);
	const { cutAudio } = useAudioProcessor();

	const [selectedAudio, setSelectedAudio] = useState<string | undefined>();
	const [file, setFile] = useState<File | null>(null);
	const [_audioUrl, setAudioUrl] = useState<string | null>(null);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

	const playPauseButtonRef = useRef<HTMLButtonElement | null>(null);
	const cutButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		audioContextRef.current = new AudioContext();
		gainNodeRef.current = audioContextRef.current.createGain();
		gainNodeRef.current.connect(audioContextRef.current.destination);
		return () => {
			stopPlayback();
			audioContextRef.current?.close();
		};
	}, []);

	useEffect(() => {
		if (gainNodeRef.current) {
			gainNodeRef.current.gain.value = volume;
		}
	}, [volume]);

	const handleTimeChange = useCallback(
		(time: number) => {
			if (isPlaying) stopPlayback();
			setCurrentTime(time);
		},
		[isPlaying],
	);

	useEffect(() => {
		if (file) {
			handleUpload();
		}
	}, [file]);

	useEffect(() => {
		if (audioBlob) {
			loadAudioFile(audioBlob);
		}
	}, [audioBlob]);

	const handleUpload = async () => {
		if (!file) {
			console.error("No file selected");
			return;
		}

		const formData = new FormData();
		formData.append("audio", file);

		try {
			const port = await getServerPort();
			console.log("Server port:", port);
			const response = await fetch(`http://localhost:${port}/upload`, {
				method: "POST",
				body: formData,
			});

			console.log("response", response);

			if (!response.ok) {
				throw new Error("Error uploading file");
			}

			const data = await response.json();
			console.log("Upload response:", data);
			setAudioUrl(URL.createObjectURL(file));
			setAudioBlob(file);
		} catch (error) {
			console.error("Upload error:", error);
		}
	};

	const uploadAudioFileInLibrary = async (file: string) => {
		const port = await getServerPort();
		try {
			const response = await fetch(
				`http://localhost:${port}/audio?path=${encodeURIComponent(file)}`,
			);
			if (!response.ok) {
				throw new Error("Error getting audio");
			}
			const audioBlob = await response.blob();
			setAudioUrl(URL.createObjectURL(audioBlob));
			setAudioBlob(audioBlob);
			loadAudioFile(audioBlob);
		} catch (error) {
			console.error("Error:", error);
		}
	};

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFile = e.target.files?.[0];
		if (selectedFile) {
			setFile(selectedFile);
			console.log("File selected:", selectedFile);
		}
	};

	const loadAudioFile = async (file: Blob) => {
		if (!file || !audioContextRef.current) return;

		try {
			const arrayBuffer = await file.arrayBuffer();
			const audioBuffer =
				await audioContextRef.current.decodeAudioData(arrayBuffer);
			setAudioBuffer(audioBuffer);
			setSelection({ start: 0, end: audioBuffer.duration });
			setCurrentTime(0);
		} catch (error) {
			console.error("Error loading audio file:", error);
		}
	};

	const stopPlayback = useCallback(() => {
		if (sourceNodeRef.current) {
			sourceNodeRef.current.stop();
			sourceNodeRef.current.disconnect();
			sourceNodeRef.current = null;
		}
		if (animationRef.current) {
			cancelAnimationFrame(animationRef.current);
			animationRef.current = null;
		}
		setIsPlaying(false);
	}, []);

	const pausePlayback = useCallback(() => {
		if (isPlaying) {
			stopPlayback();
			pausedAtRef.current = currentTime;
		}
	}, [isPlaying, stopPlayback, currentTime]);

	const togglePlayback = useCallback(() => {
		if (!audioBuffer || !audioContextRef.current || !gainNodeRef.current)
			return;

		if (isPlaying) {
			pausePlayback();
			return;
		}

		const source = audioContextRef.current.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(gainNodeRef.current);

		const offset = pausedAtRef.current ?? currentTime;
		const duration = Math.max(0, selection.end - offset);

		source.start(0, offset, duration);
		sourceNodeRef.current = source;

		const startTimestamp = performance.now();

		const updateTime = (timestamp: number) => {
			const elapsed = (timestamp - startTimestamp) / 1000;
			const newTime = offset + elapsed;

			if (newTime >= selection.end) {
				stopPlayback();
				setCurrentTime(selection.start);
			} else {
				setCurrentTime(newTime);
				animationRef.current = requestAnimationFrame(updateTime);
			}
		};

		animationRef.current = requestAnimationFrame(updateTime);

		source.onended = () => {
			stopPlayback();
			setCurrentTime(pausedAtRef.current ?? selection.start);
		};

		setIsPlaying(true);
		pausedAtRef.current = null;
	}, [
		audioBuffer,
		audioContextRef,
		currentTime,
		selection,
		pausePlayback,
		isPlaying,
		stopPlayback,
	]);

	const handleCutAudio = useCallback(() => {
		if (!audioBuffer) return;

		try {
			const newBuffer = cutAudio(audioBuffer, selection);
			stopPlayback();
			audioContextRef.current?.suspend();

			setAudioBuffer(newBuffer);
			setSelection({ start: 0, end: newBuffer.duration });
			setCurrentTime(0);

			audioContextRef.current?.resume();
		} catch (error) {
			console.error("Error cutting audio:", error);
		}
	}, [audioBuffer, selection, cutAudio, stopPlayback]);

	const exportAudio = useCallback(() => {
		if (!audioBuffer) return;

		stopPlayback();

		try {
			const offlineContext = new OfflineAudioContext(
				audioBuffer.numberOfChannels,
				audioBuffer.length,
				audioBuffer.sampleRate,
			);

			const source = offlineContext.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(offlineContext.destination);
			source.start();

			offlineContext.startRendering().then((renderedBuffer) => {
				const wav = bufferToWav(renderedBuffer);
				const blob = new Blob([wav], { type: "audio/wav" });
				const url = URL.createObjectURL(blob);

				const a = document.createElement("a");
				a.href = url;
				a.download = "edited-audio.wav";
				a.click();
				URL.revokeObjectURL(url);
			});
		} catch (error) {
			console.error("Error exporting audio:", error);
		}
	}, [audioBuffer]);

	const handleGoBack = useCallback(() => {
		setCurrentTime(0);
		stopPlayback();
		pausedAtRef.current = null;
		setIsPlaying(false);
	}, [audioBuffer, setSelection]);

	const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newVolume = parseFloat(e.target.value);
		setVolume(newVolume);
	};

	useEffect(() => {
		const commands = async () => {
			await register("C", () => {
				console.log("Shortcut triggered: C");
				event?.preventDefault();
				cutButtonRef.current?.click();
			});
			await register("Space", () => {
				console.log("Shortcut triggered: Space");
				event?.preventDefault();
				playPauseButtonRef.current?.click();
			});
		};

		const unregisterCommands = async () => {
			await unregister("C");
			await unregister("Space");
		};

		commands();

		return () => {
			unregisterCommands();
		};
	}, []);

	return (
		<div className="flex flex-col gap-4 h-full overflow-hidden w-full border border-white/10 p-4 pb-0 rounded-xl">
			{audioBuffer && (
				<div className="">
					<div className="space-y-6">
						<WaveformVisualizer
							audioBuffer={audioBuffer}
							selection={selection}
							onSelectionChange={setSelection}
							currentTime={currentTime}
							onTimeChange={handleTimeChange}
						/>
						<Timeline
							duration={audioBuffer.duration}
							selection={selection}
							onSelectionChange={setSelection}
						/>
						<div className="flex flex-wrap gap-4 justify-between items-center">
							<div className="flex gap-2">
								<button
									ref={playPauseButtonRef}
									onClick={togglePlayback}
									className="p-2 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
									aria-label={isPlaying ? "Pause" : "Play"}
								>
									{isPlaying ? (
										<Pause className="h-4 w-4" />
									) : (
										<Play className="h-4 w-4" />
									)}
								</button>
								<button
									className="p-2 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
									aria-label="Go to start"
									onClick={handleGoBack}
								>
									<CornerDownLeft className="h-4 w-4" />
								</button>
								<button
									ref={cutButtonRef}
									onClick={handleCutAudio}
									className="p-2 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
									aria-label="Cut Selection"
								>
									<Scissors className="h-4 w-4" />
								</button>
								<button
									onClick={exportAudio}
									className="p-2 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
									aria-label="Export"
								>
									<Save className="h-4 w-4" />
								</button>
								<div className="flex items-center gap-2 border border-white/10 rounded-xl px-2">
									<Volume2 className="h-4 w-4" />
									<input
										type="range"
										min="0"
										max="2"
										step="0.1"
										value={volume}
										onChange={handleVolumeChange}
										className="w-24 h-4 accent-white/80"
										aria-label="Volume"
									/>
								</div>
							</div>
							<div className="text-sm text-neutral-400">
								Selection: {formatTime(selection.start)} -{" "}
								{formatTime(selection.end)}
							</div>
						</div>
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="hover:bg-white/10 px-4 py-2 text-sm border border-white/10 rounded-xl flex gap-2 items-center justify-center w-fit"
						>
							<ArrowLeft className="w-4 h-4 opacity-80" />
							Go back
						</button>
					</div>
				</div>
			)}
			{!audioBuffer && (
				<div className="flex flex-col h-full pb-4 overflow-auto">
					{/* {audioBuffer && <div className='h-px bg-white/10 w-full rounded-xl my-4' />} */}
					<SelectAudio
						setSelectedAudio={setSelectedAudio}
						selectAudio={selectedAudio}
						handleUpload={handleFileUpload}
						uploadAudioFileInLibrary={uploadAudioFileInLibrary}
					/>
				</div>
			)}
		</div>
	);
};

export default AudioEditorComponent;
