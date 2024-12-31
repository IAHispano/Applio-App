import React, { useRef, useEffect, useCallback } from "react";

interface WaveformVisualizerProps {
	audioBuffer: AudioBuffer;
	selection: { start: number; end: number };
	onSelectionChange: (selection: { start: number; end: number }) => void;
	currentTime: number;
	onTimeChange: (time: number) => void;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
	audioBuffer,
	selection,
	currentTime,
	onTimeChange,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		drawWaveform();
	}, [audioBuffer, selection, currentTime]);

	const getTimeFromX = useCallback(
		(x: number): number => {
			const canvas = canvasRef.current;
			if (!canvas) return 0;

			const rect = canvas.getBoundingClientRect();
			const width = rect.width;
			const relativeX = Math.max(0, Math.min(x - rect.left, width));
			return (relativeX / width) * audioBuffer.duration;
		},
		[audioBuffer],
	);

	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			const time = getTimeFromX(e.clientX);
			onTimeChange(time);
		},
		[getTimeFromX, onTimeChange],
	);

	const drawWaveform = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const width = canvas.width;
		const height = canvas.height;
		const data = audioBuffer.getChannelData(0);
		const step = Math.ceil(data.length / width);
		const amp = height / 2;

		ctx.clearRect(0, 0, width, height);

		ctx.lineWidth = 1.5;

		ctx.beginPath();
		ctx.moveTo(0, amp);

		for (let i = 0; i < width; i++) {
			let min = 1.0;
			let max = -1.0;

			for (let j = 0; j < step; j++) {
				const datum = data[i * step + j];
				if (datum < min) min = datum;
				if (datum > max) max = datum;
			}

			const x = i;
			ctx.strokeStyle = "rgba(255, 255, 255, 1)";
			ctx.lineTo(x, (1 + min) * amp);
			ctx.lineTo(x, (1 + max) * amp);
		}

		ctx.lineJoin = "round";

		ctx.stroke();

		const selectionStartX = (selection.start / audioBuffer.duration) * width;
		const selectionEndX = (selection.end / audioBuffer.duration) * width;
		ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
		ctx.fillRect(selectionStartX, 0, selectionEndX - selectionStartX, height);

		const playheadX = (currentTime / audioBuffer.duration) * width;
		ctx.beginPath();
		ctx.moveTo(playheadX, 0);
		ctx.lineTo(playheadX, height);
		ctx.strokeStyle = "#ef4444";
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.lineWidth = 1;
	};

	return (
		<canvas
			ref={canvasRef}
			width={800}
			height={200}
			className="w-full h-[200px] mb-4 cursor-pointer shadow-xl"
			onClick={handleClick}
			style={{ backgroundColor: "transparent" }}
		/>
	);
};

export default WaveformVisualizer;
