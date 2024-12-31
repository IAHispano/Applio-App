import React, { useRef } from "react";
import { useAudioPlayer } from "../../../../hooks/useAudioPlayer";
import ProgressBar from "./progress-bar";
import AudioControls from "./audio-controls";
import VolumeControl from "./volume-control";

interface AudioPlayerProps {
	audioBlob: Blob;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioBlob }) => {
	const audioRef = useRef<HTMLAudioElement>(null);
	const [state, actions] = useAudioPlayer(audioRef, audioBlob);

	return (
		<div className="flex flex-col border border-white/10 p-4 pt-6 rounded-xl h-full">
			<audio ref={audioRef} />

			<ProgressBar
				currentTime={state.currentTime}
				duration={state.duration}
				onTimeChange={actions.handleTimeChange}
			/>

			<div className="flex items-center justify-between">
				<AudioControls
					isPlaying={state.isPlaying}
					onTogglePlay={actions.togglePlay}
				/>

				<VolumeControl
					volume={state.volume}
					isMuted={state.isMuted}
					onVolumeChange={actions.handleVolumeChange}
					onToggleMute={actions.toggleMute}
				/>
			</div>
		</div>
	);
};

export default AudioPlayer;
