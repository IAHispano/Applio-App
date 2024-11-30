import { Howl } from "howler";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Background from "./components/background";
import Titlebar from "./components/titlebar";
import Home from "./pages/Home";
import Install from "./pages/Install";
import SelectPath from "./pages/Select-Path";

const App: React.FC = () => {
	const [isPlaying, setIsPlaying] = useState<boolean>(true);
	const [currentPosition, setCurrentPosition] = useState<number>(0);
	const soundRef = useRef<Howl | null>(null);

	useEffect(() => {
		soundRef.current = new Howl({
			src: ["/app.mp3"],
			volume: 0.1,
			loop: true,
			autoplay: true,
			onplay: () => {
				soundRef.current?.seek(2.5);
			},
		});

		return () => {
			soundRef.current?.stop();
		};
	}, []);

	const playAudio = () => {
		if (soundRef.current) {
			soundRef.current.seek(currentPosition);
			soundRef.current.play();
			soundRef.current.volume(0.1);
			setIsPlaying(true);
			console.log("audio playing");
		}
	};

	const stopAudio = () => {
		if (soundRef.current) {
			const position = soundRef.current.seek() as number;
			setCurrentPosition(position);
			soundRef.current.stop();
			setIsPlaying(false);
			console.log("audio stopped at position:", position);
		}
	};

	const handleAudio = () => {
		if (isPlaying) {
			stopAudio();
		} else {
			playAudio();
		}
	};

	return (
		<div className="bg-[#1c1c1c]/90 w-screen h-screen">
			<Titlebar />
			<Background />
			<div className="absolute w-screen h-screen">
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/select-path" element={<SelectPath />} />
					<Route path="/install" element={<Install />} />
				</Routes>
			</div>
			<div className="absolute bottom-3 left-4 flex flex-col items-center group">
				<p className="text-neutral-400 absolute text-xs text-balance text-end bottom-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
					{isPlaying ? "Pause" : "Play"}
				</p>
				<button
					onClick={handleAudio}
					type="button"
					className="w-8 h-8 items-center flex justify-center bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm rounded-xl hover:bg-[#1c1c1c]/30 transition-all duration-400"
				>
					{isPlaying ? (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
							<path d="M16 9a5 5 0 0 1 0 6" />
							<path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
						</svg>
					) : (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
							<line x1="22" x2="16" y1="9" y2="15" />
							<line x1="16" x2="22" y1="9" y2="15" />
						</svg>
					)}
				</button>
			</div>
		</div>
	);
};

export default App;
