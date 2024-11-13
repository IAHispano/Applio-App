export default function Loading() {
	return (
		<div className="flex justify-center items-center h-full">
			<svg
				className="animate-spin h-8 w-8"
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true"
			>
				<circle
					className="opacity-20"
					cx="12"
					cy="12"
					r="10"
					stroke="currentColor"
					strokeWidth="4"
					fill="none"
				/>
				<path
					className="opacity-75"
					fill="white"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
				/>
			</svg>
		</div>
	);
}
