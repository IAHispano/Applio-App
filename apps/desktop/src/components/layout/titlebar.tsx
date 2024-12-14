import { getCurrentWindow as getCurrent } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Minus, RefreshCcw, X } from "lucide-react";
import { useState } from "react";

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
							<button type="button" onClick={() => window.location.reload()}>
								<RefreshCcw className="text-neutral-300 slow duration-200 hover:text-white w-4 h-4" />
							</button>
							<button type="button" onClick={() => history.back()}>
								<ChevronLeft className="text-neutral-300 slow duration-200 hover:text-white w-5 h-5" />
							</button>
							<button type="button" onClick={() => history.forward()}>
								<ChevronRight className="text-neutral-300 slow duration-200 hover:text-white w-5 h-5" />
							</button>
						</div>
					)}
				<p className="text-sm text-neutral-300 title font-medium flex mx-auto w-full" data-tauri-drag-region>
					Applio App
				</p>
				<div className="justify-end flex gap-3" data-tauri-drag-region>
					{/* minimized button */}
					<button type="button" onClick={minimized} className="">
					<Minus className="text-neutral-300 hover:text-neutral-200 slow w-5 h-5" />
					</button>
					{/* maximize button */}
					<button onClick={maximize} type="button">
						{maximized === false ? (
							<Maximize className="text-neutral-300 hover:text-neutral-200 slow w-3.5 h-3.5" />
						) : (
							<Minimize className="text-neutral-300 hover:text-neutral-200 slow w-3.5 h-3.5" />
						)}
					</button>
					{/* close button */}
					<button onClick={close} type="button">
						<X className="text-neutral-300 hover:text-red-400 slow w-5 h-5" />
					</button>
				</div>
			</div>
		</div>
	);
};
