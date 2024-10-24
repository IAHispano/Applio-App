import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useConvertContext } from "../convert/conversion-context";

export default function Header() {
	const { status } = useConvertContext();

	const isConverting = status && !status.includes("successfully");

	return (
		<header className="max-w-[25svh] w-fit h-full bg-[#111111]/50 border-r border-white/10 z-[200]">
			<div className="flex flex-col gap-4 justify-start items-end ml-auto p-4 h-full">
				<Link
					className="text-xl flex gap-4 w-full ml-auto items-center justify-end"
					to="/"
				>
					<span className="flex items-center justify-center m-auto h-12 w-12 rounded-xl border-white/20 border hover:bg-white/10 slow hover:shadow-xl hover:shadow-[#00AA68]/20">
						<svg
							className="w-6 h-6"
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							width="246"
							height="277"
							viewBox="0 0 246 277"
							fill="none"
						>
							<path
								d="M142.546 65.9462C154.744 61.4426 166.841 59.0827 179.348 59.5337C197.564 59.9161 211.312 68.5078 222.768 81.8792C235.667 96.9345 243.113 114.515 245.278 134.439C246.525 145.917 246.084 157.39 244.518 168.856C242.388 184.449 238.845 199.624 232.498 213.964C227.037 226.301 221.317 238.591 212.676 248.947C201.87 261.897 188.857 271.644 172.58 276.017C166.998 277.516 161.425 277.3 155.914 275.372C147.617 272.47 139.192 269.998 130.793 267.432C126.89 266.24 123.079 266.193 119.179 267.251C108.974 270.019 98.8226 273.048 88.5304 275.415C74.1206 278.729 61.192 275.509 50.0251 265.105C32.7469 249.009 20.633 229.306 11.7755 207.281C6.1537 193.302 1.99027 178.843 0.647594 163.756C-1.58648 138.653 1.68141 114.492 14.8237 92.6888C22.0198 80.7505 31.3059 70.7559 43.6319 64.2519C51.1145 60.3036 59.174 59.2029 67.4627 59.4291C81.6658 59.8168 95.457 63.0475 109.298 65.9345C110.256 66.1342 111.221 66.2973 112.187 66.4485C112.317 66.4689 112.473 66.319 112.85 66.1326C111.9 62.4624 110.097 59.1468 108.199 55.9415C103.617 48.2035 98.4703 40.8635 93.0673 33.7141C91.4254 31.5415 89.4436 30.5494 86.7276 30.597C80.9899 30.6976 78.7957 27.4036 80.5906 21.6925C82.458 15.7512 87.7745 13.78 92.8396 17.1207C94.5208 18.2295 95.9083 19.6384 97.1803 21.2069C102.677 27.9852 107.245 35.4171 111.506 43.0592C113.689 46.9754 115.045 51.2461 116.276 55.5633C116.591 56.6648 116.678 57.9147 117.819 58.7835C119.336 57.4697 119.06 55.5086 119.221 53.9181C120.825 38.1083 128.378 26.0129 140.331 16.4106C148.54 9.8161 157.07 3.94243 167.145 0.858849C168.084 0.571508 169.039 0.318437 170.001 0.137933C173.68 -0.55182 175.82 1.37585 176.274 5.23625C178.399 23.2986 171.21 37.5301 159.396 49.9427C154.899 54.6673 150.031 58.9246 144.898 62.8768C144.072 63.5123 143.074 64.0124 142.546 65.9462Z"
								fill="white"
							/>
						</svg>
					</span>
				</Link>
				<Link
					className="text-xl flex gap-4 w-full ml-auto items-center justify-end"
					to="/models"
				>
					<span className="w-12 h-12 flex items-center justify-center m-auto rounded-xl border-white/20 border hover:bg-white/10 slow">
						<svg
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="w-7 h-6 text-white"
						>
							<path d="M16 6l4 14" />
							<path d="M12 6v14" />
							<path d="M8 8v12" />
							<path d="M4 4v16" />
						</svg>
					</span>
				</Link>
				<Link
					className="text-xl flex gap-4 w-full ml-auto items-center justify-end"
					to="/convert"
				>
					<span
						className={`h-12 w-12 flex items-center justify-center m-auto rounded-xl border-white/20 border hover:bg-white/10 slow ${isConverting ? "shadow-xl shadow-green-500/40" : ""}`}
					>
						{isConverting && (
							<motion.div
								className="shadow-xl shadow-green-500/40"
								animate={{ opacity: 1 }}
								initial={{ opacity: 0 }}
								transition={{ duration: 6 }}
							/>
						)}
						<svg
							className="w-6 h-6"
							fill="white"
							preserveAspectRatio="xMidYMid meet"
							viewBox="0 0 36 36"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path d="m31.49 27.4-8.49-12.46v-10.94h1a1 1 0 0 0 0-2h-11.92a1 1 0 0 0 0 2h.92v10.94l-8.42 12.37a4.31 4.31 0 0 0 -.78 3 4.23 4.23 0 0 0 4.2 3.69h19.86a4.36 4.36 0 0 0 3.14-1.2 4.23 4.23 0 0 0 .49-5.4zm-16.49-11.91v-11.49h6v11.49l5.15 7.51h-16.3z" />
							<path d="m0 0h36v36h-36z" fill="none" />
						</svg>
					</span>
				</Link>
				<Link
					className="text-xl flex gap-4 w-full ml-auto mt-auto "
					to="/settings"
				>
					<span className="h-12 w-12 flex items-center justify-center m-auto rounded-xl border-white/20 border hover:bg-white/10 slow">
						<svg
							viewBox="0 0 512 512"
							fill="currentColor"
							className="w-6 h-6"
							aria-hidden="true"
						>
							<path
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={32}
								d="M262.29 192.31a64 64 0 1057.4 57.4 64.13 64.13 0 00-57.4-57.4zM416.39 256a154.34 154.34 0 01-1.53 20.79l45.21 35.46a10.81 10.81 0 012.45 13.75l-42.77 74a10.81 10.81 0 01-13.14 4.59l-44.9-18.08a16.11 16.11 0 00-15.17 1.75A164.48 164.48 0 01325 400.8a15.94 15.94 0 00-8.82 12.14l-6.73 47.89a11.08 11.08 0 01-10.68 9.17h-85.54a11.11 11.11 0 01-10.69-8.87l-6.72-47.82a16.07 16.07 0 00-9-12.22 155.3 155.3 0 01-21.46-12.57 16 16 0 00-15.11-1.71l-44.89 18.07a10.81 10.81 0 01-13.14-4.58l-42.77-74a10.8 10.8 0 012.45-13.75l38.21-30a16.05 16.05 0 006-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16 16 0 00-6.07-13.94l-38.19-30A10.81 10.81 0 0149.48 186l42.77-74a10.81 10.81 0 0113.14-4.59l44.9 18.08a16.11 16.11 0 0015.17-1.75A164.48 164.48 0 01187 111.2a15.94 15.94 0 008.82-12.14l6.73-47.89A11.08 11.08 0 01213.23 42h85.54a11.11 11.11 0 0110.69 8.87l6.72 47.82a16.07 16.07 0 009 12.22 155.3 155.3 0 0121.46 12.57 16 16 0 0015.11 1.71l44.89-18.07a10.81 10.81 0 0113.14 4.58l42.77 74a10.8 10.8 0 01-2.45 13.75l-38.21 30a16.05 16.05 0 00-6.05 14.08c.33 4.14.55 8.3.55 12.47z"
							/>
						</svg>
					</span>
				</Link>
				<Link className="text-xl flex gap-4 w-full ml-auto" to="/account">
					<span className="h-12 w-12 flex items-center justify-center m-auto rounded-xl border-white/20 border hover:bg-white/10 slow">
						<svg
							viewBox="0 0 24 24"
							fill="currentColor"
							className="w-6 h-6"
							aria-hidden="true"
						>
							<path d="M12 4a4 4 0 014 4 4 4 0 01-4 4 4 4 0 01-4-4 4 4 0 014-4m0 10c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4z" />
						</svg>
					</span>
				</Link>
			</div>
		</header>
	);
}
