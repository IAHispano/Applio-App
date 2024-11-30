import { Store } from "@tauri-apps/plugin-store";
import { useEffect, useState } from "react";

export default function Home() {
	const [backgroundColor, setBackgroundColor] = useState("");

	useEffect(() => {
		const getColor = async () => {
			const store = await Store.load("settings.json");
			const color = await store.get("backgroundColor");

			if (color) {
				function rgbaToHex(rgba: string) {
					const parts = rgba.match(/(\d+), (\d+), (\d+), (\d+(\.\d+)?)/);
					if (!parts) return "#2a2b2a";

					const r = Number.parseInt(parts[1]);
					const g = Number.parseInt(parts[2]);
					const b = Number.parseInt(parts[3]);

					const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
					return hex;
				}

				setBackgroundColor(rgbaToHex(color as string));
			}
		};

		getColor();
	}, []);

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-center justify-start mt-10 mb-4 px-4 w-full overflow-auto">
				<div className="w-full h-full flex flex-col gap-4 overflow-auto">
					<div className="grid grid-cols-3 grid-rows-3 gap-4 w-full h-full">
						<div
							className="w-full h-full rounded-xl noise row-span-3 col-span-3 flex justify-center items-center relative"
							style={{
								background: `radial-gradient(150% 150% at 50% 10%, #111111A3 40%, ${backgroundColor} 100%)`,
							}}
						>
							<h1 className="text-[100px] font-bold title">Applio</h1>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
