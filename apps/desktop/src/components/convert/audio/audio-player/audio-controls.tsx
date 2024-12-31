import React from "react";
import { Play, Pause } from "lucide-react";

interface ControlsProps {
	isPlaying: boolean;
	onTogglePlay: () => void;
}

const AudioControls: React.FC<ControlsProps> = ({
	isPlaying,
	onTogglePlay,
}) => (
	<button
		onClick={onTogglePlay}
		className="p-3 rounded-full bg-white/10 text-neutral-300 hover:bg-white/20 slow flex"
		aria-label={isPlaying ? "Pause" : "Play"}
	>
		{isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
	</button>
);

export default AudioControls;
