import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useConvertContext } from "../convert/conversion-context";

const icons = {
	Home: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
			/>
		</svg>
	),
	Models: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
			/>
		</svg>
	),
	Convert: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-6 h-6 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
			/>
		</svg>
	),
	Settings: (
		<svg
			className="w-6 h-6 opacity-70"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<g id="SVGRepo_bgCarrier" stroke-width="0"></g>
			<g
				id="SVGRepo_tracerCarrier"
				stroke-linecap="round"
				stroke-linejoin="round"
			></g>
			<g id="SVGRepo_iconCarrier">
				{" "}
				<g id="Interface / Settings_Future">
					{" "}
					<g id="Vector">
						{" "}
						<path
							d="M13.6006 21.0761L19.0608 17.9236C19.6437 17.5871 19.9346 17.4188 20.1465 17.1834C20.3341 16.9751 20.4759 16.7297 20.5625 16.4632C20.6602 16.1626 20.6602 15.8267 20.6602 15.1568V8.84268C20.6602 8.17277 20.6602 7.83694 20.5625 7.53638C20.4759 7.26982 20.3341 7.02428 20.1465 6.816C19.9355 6.58161 19.6453 6.41405 19.0674 6.08043L13.5996 2.92359C13.0167 2.58706 12.7259 2.41913 12.416 2.35328C12.1419 2.295 11.8584 2.295 11.5843 2.35328C11.2744 2.41914 10.9826 2.58706 10.3997 2.92359L4.93843 6.07666C4.35623 6.41279 4.06535 6.58073 3.85352 6.816C3.66597 7.02428 3.52434 7.26982 3.43773 7.53638C3.33984 7.83765 3.33984 8.17436 3.33984 8.84742V15.1524C3.33984 15.8254 3.33984 16.1619 3.43773 16.4632C3.52434 16.7297 3.66597 16.9751 3.85352 17.1834C4.06548 17.4188 4.35657 17.5871 4.93945 17.9236L10.3997 21.0761C10.9826 21.4126 11.2744 21.5806 11.5843 21.6465C11.8584 21.7047 12.1419 21.7047 12.416 21.6465C12.7259 21.5806 13.0177 21.4126 13.6006 21.0761Z"
							stroke="#f2f2f2"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						></path>{" "}
						<path
							d="M9 11.9998C9 13.6566 10.3431 14.9998 12 14.9998C13.6569 14.9998 15 13.6566 15 11.9998C15 10.3429 13.6569 8.99976 12 8.99976C10.3431 8.99976 9 10.3429 9 11.9998Z"
							stroke="#f2f2f2"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						></path>{" "}
					</g>{" "}
				</g>{" "}
			</g>
		</svg>
	),
	MoreHorizontal: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
			/>
		</svg>
	),
	ArrowRight: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M14 5l7 7m0 0l-7 7m7-7H3"
			/>
		</svg>
	),
	ArrowLeft: (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			className="w-5 h-5 opacity-70"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M10 19l-7-7m0 0l7-7m-7 7h18"
			/>
		</svg>
	),
	Converting: (
		<svg
		className="w-5 h-5 opacity-70"
		viewBox="0 0 32 32"
		fill="#f8f8f8"
		stroke="#f8f8f8"
		aria-hidden="true"
	>
		<g id="SVGRepo_bgCarrier" strokeWidth="0" />
		<g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round" />
		<g id="SVGRepo_iconCarrier">
			<g>
				<path
					className="st0"
					d="M17.9,9.9c-4.6,0.9-6,2.3-6.9,6.9c-0.9-4.6-2.3-6-6.9-6.9C8.7,9,10.1,7.6,11,3C11.9,7.6,13.3,9,17.9,9.9z"
				/>
			</g>
			<g>
				<path
					className="st0"
					d="M21.8,25c-3.2,0.6-4.1,1.6-4.8,4.8c-0.6-3.2-1.6-4.1-4.8-4.8c3.2-0.6,4.1-1.6,4.8-4.8 C17.6,23.4,18.6,24.4,21.8,25z"
				/>
			</g>
			<g>
				<path
					className="st0"
					d="M29,15c-2.6,0.5-3.4,1.3-3.9,3.9c-0.5-2.6-1.3-3.4-3.9-3.9c2.6-0.5,3.4-1.3,3.9-3.9C25.6,13.7,26.4,14.5,29,15 z"
				/>
			</g>
			<line className="st0" x1="5" y1="23" x2="5" y2="23" />
			<line className="st0" x1="28" y1="6" x2="28" y2="6" />
		</g>
	</svg>
	)
};

export default function Sidebar() {
	const [isExpanded, setIsExpanded] = useState(false);
	const {info} = useConvertContext();

	const menuItems = [
		{ icon: "Home", label: "Home", to: "/" },
		{ icon: "Models", label: "Models", to: "/models" },
		{ icon: "Convert", label: "Convert", to: "/convert" },
		{ icon: "Settings", label: "Settings", to: "/settings" },
	];

	const handleClick = () => {
		setIsExpanded(!isExpanded);
		localStorage.setItem("sidebar-expanded", `${!isExpanded}`);
	};

	useEffect(() => {
		const expanded = localStorage.getItem("sidebar-expanded");
		if (expanded) {
			setIsExpanded(expanded === "true");
		}
	}, []);

	return (
		<div
			className={`flex flex-col mt-10 bg-[#111111]/10 border border-white/10 text-gray-100 p-4 m-4 mr-0 rounded-xl transition-all duration-300 ease-in-out ${
				isExpanded ? "w-64" : "w-20"
			}`}
			style={{ zIndex: 200 }}
		>
			<nav className="flex-1">
				<ul className="space-y-2">
					{menuItems.map((item, index) => (
						<li key={index}>
							<Link
								to={item.to}
								className="flex items-center justify-start space-x-3 p-2 rounded-lg hover:bg-neutral-700 transition-colors duration-200"
							>
								{icons[item.icon as keyof typeof icons]}
								{isExpanded && <span>{item.label}</span>}
							</Link>
						</li>
					))}
				</ul>
			</nav>
			<div className="mt-auto flex flex-col gap-2">
				{!isExpanded && info && (
					<Link
						to="/convert"
						className={`p-2 ${isExpanded ? "justify-start items-start" : "justify-center items-center"} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}	
						aria-label="Convert"
					>
						{icons.Converting}
					</Link>
				)}
				<div
					className={`flex items-center ${isExpanded ? "justify-start" : "justify-center"} space-x-2 mb-4`}
				>
					<button
						type="button"
						className="p-2 rounded-full bg-neutral-700/50 hover:bg-neutral-700 transition-colors duration-200"
						onClick={handleClick}
						aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						{isExpanded ? icons.ArrowLeft : icons.ArrowRight}
					</button>
					{isExpanded && (
						<button
							className="p-2 rounded-full bg-neutral-700/50 hover:bg-neutral-700 transition-colors duration-200"
							type="button"
						>
							{icons.MoreHorizontal}
						</button>
					)}
					{isExpanded && info && (
						<Link
							to="/convert"
							className={`p-2 ${isExpanded ? "justify-start items-start" : "justify-center items-center"} flex m-auto rounded-full bg-gradient-to-t from-transparent to-[#00AA68]/40 hover:saturate-200 slow transition-colors duration-200`}	
							aria-label="Convert"
						>
							{icons.Converting}
						</Link>
					)}
				</div>
				{/* Add when login is implemented */}
				{/* {isExpanded && (
					<div className="flex items-center space-x-3 px-4 py-3 bg-neutral-700/50 rounded-lg">
						<img
							src="https://avatars.githubusercontent.com/u/100789151?v=4"
							alt="User avatar"
							className="w-10 h-10 rounded-full"
						/>
						<div className="flex-1">
							<p className="font-semibold">Messi</p>
							<p className="text-sm text-gray-400">@messi</p>
						</div>
					</div>
				)} */}
			</div>
		</div>
	);
}
