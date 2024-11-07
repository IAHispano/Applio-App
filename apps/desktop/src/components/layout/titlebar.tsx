import { useState } from "react";
import { getCurrentWindow as getCurrent } from "@tauri-apps/api/window";

export const TitleBar = () => {
	const [maximized, setMaximized] = useState(false);

	const close = async () => {
		await getCurrent().close();
	};

	const maximize = async () => {
		if (maximized === true) {
			await getCurrent().unmaximize();
			setMaximized(false);
		} else {
			await getCurrent().maximize();
			setMaximized(true);
		}
	};

	const minimized = async () => {
		await getCurrent().minimize();
	};

	return (
		<div
			className="absolute top-0 right-0 select-none overflow-hidden p-2 pt-3 w-full"
			style={{ zIndex: 200 }}
			data-tauri-drag-region
		>
			<div className="justify-end flex gap-4 px-2" data-tauri-drag-region>
				<button
					type="button"
					onClick={minimized}
					className="slow hover:text-white"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width={18}
						height={18}
						fill={"none"}
						aria-hidden="true"
					>
						<path
							d="M20 12L4 12"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<button
					onClick={maximize}
					type="button"
					className="slow hover:text-white"
				>
					{maximized === false ? (
						<svg
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M8 3H5a2 2 0 0 0-2 2v3" />
							<path d="M21 8V5a2 2 0 0 0-2-2h-3" />
							<path d="M3 16v3a2 2 0 0 0 2 2h3" />
							<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
						</svg>
					) : (
						<svg
							aria-hidden="true"
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M8 3v3a2 2 0 0 1-2 2H3" />
							<path d="M21 8h-3a2 2 0 0 1-2-2V3" />
							<path d="M3 16h3a2 2 0 0 1 2 2v3" />
							<path d="M16 21v-3a2 2 0 0 1 2-2h3" />
						</svg>
					)}
				</button>
				<button
					onClick={close}
					type="button"
					className="slow hover:text-white"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						width={18}
						height={18}
						fill={"none"}
						aria-hidden="true"
					>
						<path
							d="M19.0005 4.99988L5.00045 18.9999M5.00045 4.99988L19.0005 18.9999"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			</div>
		</div>
	);
};
