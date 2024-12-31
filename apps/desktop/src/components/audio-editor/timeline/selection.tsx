import React from "react";

interface TimelineSelectionProps {
	width: number;
	height: number;
	selection: { start: number; end: number };
	duration: number;
}

const TimelineSelection: React.FC<TimelineSelectionProps> = ({
	width,
	height,
	selection,
	duration,
}) => {
	const startX = (selection.start / duration) * width;
	const endX = (selection.end / duration) * width;
	const selectionWidth = endX - startX;

	return (
		<g>
			<rect
				x={startX}
				y={0}
				width={selectionWidth}
				height={height - 20}
				fill="rgba(0, 0, 0, 0.2)"
			/>

			<rect
				x={startX - 4}
				y={0}
				width={8}
				height={height - 20}
				fill="#ffffff"
				className="cursor-ew-resize"
			/>

			<rect
				x={endX - 4}
				y={0}
				width={8}
				height={height - 20}
				fill="#ffffff"
				className="cursor-ew-resize"
			/>
		</g>
	);
};

export default TimelineSelection;
