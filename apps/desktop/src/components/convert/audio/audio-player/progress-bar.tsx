import React from "react";
import { formatTime } from "../../../../utils/time";

interface ProgressBarProps {
	currentTime: number;
	duration: number;
	onTimeChange: (time: number) => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
	currentTime,
	duration,
	onTimeChange,
}) => (
	<div className="flex flex-col mt-auto justify-end items-end">
		<input
			type="range"
			value={currentTime}
			min={0}
			max={duration || 1}
			onChange={(e) => onTimeChange(parseFloat(e.target.value))}
			className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
			aria-label="Progress"
		/>
		<div className="flex w-full my-2 justify-between text-sm text-neutral-400">
			<span>{formatTime(currentTime)}</span>
			<span>{formatTime(duration || 0)}</span>
		</div>
	</div>
);

export default ProgressBar;
