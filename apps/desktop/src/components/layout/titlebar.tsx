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
			<div
				className="flex justify-between items-center px-2"
				data-tauri-drag-region
			>
				{window.location.pathname !== "/first-time" &&
					window.location.pathname !== "/pretraineds" &&
					window.location.pathname !== "/os-not-supported" &&
					window.location.pathname !== "/beta-access" &&
					window.location.pathname !== "/login" && (
						<div
							className="justify-start ml-auto w-full gap-2 flex px-2"
							data-tauri-drag-region
						>
							<button
								type="button"
								onClick={() => window.location.reload()}
								className="slow hover:text-white"
							>
								<svg
									width={14}
									height={14}
									className="opacity-70 hover:opacity-100 slow"
									fill="#ffffff"
									viewBox="0 0 24 24"
									xmlns="http://www.w3.org/2000/svg"
								>
									<g id="SVGRepo_bgCarrier" stroke-width="0"></g>
									<g
										id="SVGRepo_tracerCarrier"
										stroke-linecap="round"
										stroke-linejoin="round"
									></g>
									<g id="SVGRepo_iconCarrier">
										<path d="M1,12A11,11,0,0,1,17.882,2.7l1.411-1.41A1,1,0,0,1,21,2V6a1,1,0,0,1-1,1H16a1,1,0,0,1-.707-1.707l1.128-1.128A8.994,8.994,0,0,0,3,12a1,1,0,0,1-2,0Zm21-1a1,1,0,0,0-1,1,9.01,9.01,0,0,1-9,9,8.9,8.9,0,0,1-4.42-1.166l1.127-1.127A1,1,0,0,0,8,17H4a1,1,0,0,0-1,1v4a1,1,0,0,0,.617.924A.987.987,0,0,0,4,23a1,1,0,0,0,.707-.293L6.118,21.3A10.891,10.891,0,0,0,12,23,11.013,11.013,0,0,0,23,12,1,1,0,0,0,22,11Z"></path>
									</g>
								</svg>
							</button>
							<button
								type="button"
								onClick={() => history.back()}
								className="slow hover:text-white"
							>
								<svg
									className="opacity-70 hover:opacity-100 slow"
									width={18}
									height={18}
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									aria-hidden="true"
								>
									<path
										fillRule="evenodd"
										clipRule="evenodd"
										d="M15.7071 4.29289C16.0976 4.68342 16.0976 5.31658 15.7071 5.70711L9.41421 12L15.7071 18.2929C16.0976 18.6834 16.0976 19.3166 15.7071 19.7071C15.3166 20.0976 14.6834 20.0976 14.2929 19.7071L7.29289 12.7071C7.10536 12.5196 7 12.2652 7 12C7 11.7348 7.10536 11.4804 7.29289 11.2929L14.2929 4.29289C14.6834 3.90237 15.3166 3.90237 15.7071 4.29289Z"
										fill="#ffffff"
									/>
								</svg>
							</button>
							<button
								type="button"
								onClick={() => history.forward()}
								className="slow hover:text-white"
							>
								<svg
									className="opacity-70 hover:opacity-100 slow"
									width={18}
									height={18}
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									aria-hidden="true"
								>
									<path
										fillRule="evenodd"
										clipRule="evenodd"
										d="M8.29289 4.29289C8.68342 3.90237 9.31658 3.90237 9.70711 4.29289L16.7071 11.2929C17.0976 11.6834 17.0976 12.3166 16.7071 12.7071L9.70711 19.7071C9.31658 20.0976 8.68342 20.0976 8.29289 19.7071C7.90237 19.3166 7.90237 18.6834 8.29289 18.2929L14.5858 12L8.29289 5.70711C7.90237 5.31658 7.90237 4.68342 8.29289 4.29289Z"
										fill="#ffffff"
									/>
								</svg>
							</button>
						</div>
					)}
				<p
					className="text-sm title font-semibold text-center text-neutral-300 flex mx-auto w-full"
					data-tauri-drag-region
				>
					Applio
				</p>
				<div className="justify-end flex gap-4" data-tauri-drag-region>
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
		</div>
	);
};
