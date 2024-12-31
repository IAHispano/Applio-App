import { useState, useEffect, RefObject } from "react";

export interface AudioPlayerState {
	isPlaying: boolean;
	duration: number;
	currentTime: number;
	isMuted: boolean;
	volume: number;
}

export interface AudioPlayerActions {
	togglePlay: () => void;
	toggleMute: () => void;
	handleTimeChange: (time: number) => void;
	handleVolumeChange: (volume: number) => void;
}

export const useAudioPlayer = (
	audioRef: RefObject<HTMLAudioElement>,
	audioBlob: Blob,
): [AudioPlayerState, AudioPlayerActions] => {
	const [isPlaying, setIsPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [isMuted, setIsMuted] = useState(false);
	const [volume, setVolume] = useState(1);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const audioUrl = URL.createObjectURL(audioBlob);
		audio.src = audioUrl;
		audio.load();

		return () => {
			URL.revokeObjectURL(audioUrl);
			audio.src = "";
		};
	}, [audioBlob]);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const handleLoadMetadata = () => {
			setDuration(audio.duration);
			setVolume(audio.volume);
		};

		const handleTimeUpdate = () => {
			setCurrentTime(audio.currentTime);
		};

		const handleEnded = () => {
			setIsPlaying(false);
			setCurrentTime(0);
		};

		const handlePlay = () => setIsPlaying(true);
		const handlePause = () => setIsPlaying(false);

		audio.addEventListener("loadedmetadata", handleLoadMetadata);
		audio.addEventListener("timeupdate", handleTimeUpdate);
		audio.addEventListener("ended", handleEnded);
		audio.addEventListener("play", handlePlay);
		audio.addEventListener("pause", handlePause);

		return () => {
			audio.removeEventListener("loadedmetadata", handleLoadMetadata);
			audio.removeEventListener("timeupdate", handleTimeUpdate);
			audio.removeEventListener("ended", handleEnded);
			audio.removeEventListener("play", handlePlay);
			audio.removeEventListener("pause", handlePause);
		};
	}, []);

	const controls: AudioPlayerActions = {
		togglePlay: async () => {
			const audio = audioRef.current;
			if (!audio) return;

			try {
				if (isPlaying) {
					await audio.pause();
				} else {
					await audio.play();
				}
			} catch (error) {
				console.error("Error toggling play state:", error);
			}
		},

		toggleMute: () => {
			const audio = audioRef.current;
			if (!audio) return;

			audio.muted = !isMuted;
			setIsMuted(!isMuted);
		},

		handleTimeChange: (time: number) => {
			const audio = audioRef.current;
			if (!audio) return;

			audio.currentTime = time;
			setCurrentTime(time);
		},

		handleVolumeChange: (value: number) => {
			const audio = audioRef.current;
			if (!audio) return;

			audio.volume = value;
			setVolume(value);
			setIsMuted(value === 0);
		},
	};

	return [{ isPlaying, duration, currentTime, isMuted, volume }, controls];
};
