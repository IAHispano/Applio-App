import { useState } from "react";
import { window } from "@tauri-apps/api";

export default function Titlebar() {
	const [isModalOpen, setIsModalOpen] = useState(false);

	const openModal = () => {
		setIsModalOpen(true);
	};

	const closeModal = () => {
		setIsModalOpen(false);
	};

	const confirmClose = async () => {
		setIsModalOpen(false);
		await window.getCurrentWindow().close();
	};

	return (
		<div
			className="absolute top-0 right-0 select-none overflow-hidden p-2 pt-3 w-full z-50 bg-gradient-to-b from-[#1c1c1c]/50 to-transparent"
			data-tauri-drag-region
		>
			<div
				className="flex justify-between items-center m-auto px-2"
				data-tauri-drag-region
			>
				<p className="text-sm text-neutral-400 title font-medium flex mx-auto w-full">
					Applio App Installer
				</p>

				<button onClick={openModal} type="button">
					<svg
						className="text-neutral-400 slow duration-200 hover:text-white"
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

			{isModalOpen && (
				<div className="fixed inset-0 backdrop-blur-md bg-opacity-50 flex justify-center items-center z-50 transition-all duration-500 opacity-100">
					<div className="bg-[#1c1c1c]/70 p-6 border border-white/20 text-neutral-300 text-sm rounded-xl transition-all duration-300">
						<h3 className="text-xl font-semibold">Exit Installer?</h3>
						<p className="my-4 text-sm">
							You are about to close the installer. Any unsaved progress may be
							lost. Do you wish to proceed?
						</p>
						<div className="flex justify-end space-x-3">
							<button
								onClick={closeModal}
								className="px-4 py-1 text-sm flex justify-center items-center bg-[#1c1c1c]/30 border border-white/20 text-neutral-300 rounded-lg hover:bg-[#1c1c1c]/40 transition-all duration-300"
							>
								Cancel
							</button>
							<button
								onClick={confirmClose}
								className="px-4 py-1 text-sm flex justify-center items-center bg-[#f24e1e]/20 border border-[#f24e1e]/20 text-white rounded-lg hover:bg-[#f24e1e]/30 transition-all duration-300"
							>
								Confirm
							</button>
						</div>
					</div>
				</div>
			)}

			{!isModalOpen && (
				<div className="fixed inset-0 backdrop-blur-md bg-opacity-50 flex justify-center items-center z-50 transition-opacity duration-500 opacity-0 pointer-events-none"></div>
			)}
		</div>
	);
}
