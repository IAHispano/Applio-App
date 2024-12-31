import { useCallback, useRef } from "react";
import TimelineMarkers from "./markers";
import TimelineSelection from "./selection";

interface TimelineProps {
	duration: number;
	selection: { start: number; end: number };
	onSelectionChange: (selection: { start: number; end: number }) => void;
}

const Timeline: React.FC<TimelineProps> = ({
	duration,
	selection,
	onSelectionChange,
}) => {
	const svgRef = useRef<SVGSVGElement>(null);
	const isDraggingRef = useRef<boolean>(false);
	const currentHandleRef = useRef<"start" | "end" | null>(null);

	const getTimeFromX = useCallback(
		(x: number): number => {
			if (!svgRef.current) return 0;
			const rect = svgRef.current.getBoundingClientRect();
			const width = rect.width;
			const relativeX = Math.max(0, Math.min(x - rect.left, width));
			return (relativeX / width) * duration;
		},
		[duration],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (!svgRef.current) return;

			const time = getTimeFromX(e.clientX);
			const startDistance = Math.abs(time - selection.start);
			const endDistance = Math.abs(time - selection.end);
			const threshold = duration * 0.02;

			if (startDistance < threshold) {
				currentHandleRef.current = "start";
				isDraggingRef.current = true;
			} else if (endDistance < threshold) {
				currentHandleRef.current = "end";
				isDraggingRef.current = true;
			}
		},
		[duration, selection, getTimeFromX],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!isDraggingRef.current || !currentHandleRef.current) return;

			const time = getTimeFromX(e.clientX);

			if (currentHandleRef.current === "start") {
				onSelectionChange({
					start: Math.min(time, selection.end - duration * 0.01),
					end: selection.end,
				});
			} else {
				onSelectionChange({
					start: selection.start,
					end: Math.max(time, selection.start + duration * 0.01),
				});
			}
		},
		[duration, selection, onSelectionChange, getTimeFromX],
	);

	const handleMouseUp = useCallback(() => {
		isDraggingRef.current = false;
		currentHandleRef.current = null;
	}, []);

	return (
		<svg
			ref={svgRef}
			className="w-full h-[60px] select-none"
			viewBox="0 0 800 60"
			preserveAspectRatio="none"
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
		>
			<rect x={0} y={0} width={800} height={40} fill="none" />

			<TimelineSelection
				width={800}
				height={60}
				selection={selection}
				duration={duration}
			/>

			<TimelineMarkers width={800} height={60} duration={duration} />
		</svg>
	);
};

export default Timeline;
