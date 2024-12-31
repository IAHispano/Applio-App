import { formatTime } from "../../../utils/time";

interface TimelineMarkersProps {
	width: number;
	height: number;
	duration: number;
	markerCount?: number;
}

const TimelineMarkers: React.FC<TimelineMarkersProps> = ({
	width,
	height,
	duration,
	markerCount = 10,
}) => {
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) return null;

	ctx.font = "12px";
	const timeWidth = ctx.measureText("00:00").width;
	const markers = [];

	for (let i = 0; i <= markerCount; i++) {
		const x = (width * i) / markerCount;
		const time = (duration * i) / markerCount;
		const label = formatTime(time);

		markers.push(
			<g key={i}>
				<line x1={x} y1={0} x2={x} y2={10} stroke="#9CA3AF" strokeWidth={1} />
				<text
					x={Math.min(Math.max(x - timeWidth / 2, 0), width - timeWidth)}
					y={height - 5}
					className="text-xs fill-neutral-300"
				>
					{label}
				</text>
			</g>,
		);
	}

	return <>{markers}</>;
};

export default TimelineMarkers;
