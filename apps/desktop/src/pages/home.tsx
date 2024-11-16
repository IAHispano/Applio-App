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
				<div className="w-full h-full rounded-xl noise row-span-2 col-span-3 flex justify-center items-center relative" style={{background: `radial-gradient(150% 150% at 50% 10%, #111111A3 40%, ${backgroundColor} 100%)`,}}>
				 <h1 className="text-[100px] font-bold title">Applio</h1>
				</div>
				<div className="w-full h-full rounded-xl bg-[#111111]/20 col-span-2 p-6 overflow-auto flex flex-col gap-4">
					<div className="border border-white/10 rounded-xl p-4 flex flex-col gap-1">
						<h2 className="text-lg font-medium">Applio App is now in early access for Windows!</h2>
						<p className="text-neutral-300 text-sm">We are working hard to bring you the best experience possible. Stay tuned for more updates!</p>
					</div>
					<div className="border border-white/10 rounded-xl p-4 flex flex-col gap-1">
						<h2 className="text-lg font-medium">v0.0.6 is the latest pre-alpha release!</h2>
						<p className="text-neutral-300 text-sm">In november we will be releasing the first public alpha of Applio App.</p>
					</div>
					<div className="border border-white/10 rounded-xl p-4 flex flex-col gap-1">
						<h2 className="text-lg font-medium">Now you can login with your Applio account!</h2>
						<p className="text-neutral-300 text-sm">We integrated Applio login into the app, so you can easily login with your Applio account and save your inference results on cloud.</p>
					</div>
				</div>
				<div className="w-full h-full rounded-xl bg-[#111111]/20 col-span-1 overflow-auto p-4">
				<div>
					<h2 className="text-lg font-medium">Pre-Alpha 1.6</h2>
					<ul className="text-neutral-300 text-xs list-disc px-4 flex flex-col gap-2 mt-4">
					<li>Added a "My Models" section for better model management and navigation</li>
					<li>Introduced model deletion functionality for easier model removal</li>
					<li>Added a route to delete models and get a list of inferences for better backend management</li>
					<li>Added a login screen and navigation buttons for improved user flow and accessibility</li>
					<li>Created a page for users with no beta access to manage permissions more clearly</li>
					<li>Added click-to-search functionality for model previews to quickly locate models</li>
					<li>Introduced a new update button in the header for streamlined updates</li>
					<li>Implemented an inferences library for enhanced functionality and access to inference data</li>
					<li>Added functionality to delete all models or inferences for improved cleanup</li>
					<li>Fixed sidebar resize issues to prevent layout disruptions</li>
					<li>Resolved navigation button glitches for smoother interaction</li>
					<li>Fixed login visibility issues and improved login flow</li>
					<li>Fixed model section height to prevent display issues</li>
					<li>Fixed change model buttons for more accurate model switching</li>
					<li>Fixed icon visibility after conversion to improve post-conversion UI</li>
					<li>Addressed various inference-related bugs for improved processing accuracy</li>
					<li>Enhanced the sidebar and pagination for a more streamlined navigation experience</li>
					<li>Improved the "not found model" section for clearer error handling</li>
					<li>Reduced unnecessary effect logs for a cleaner and faster UI performance</li>
					<li>Updated buttons with a new design for a sharper look</li>
					<li>Optimized the login page with better visual design and improved user interaction</li>
					<li>Optimized the build process for smoother setup and faster deployments</li>
					<li>Updated README.md with new features, installation instructions, and general improvements</li>
					<li>Added additional details on inferences library and new model management functionalities</li>
					<li>Refined internal code for better inference library integration and session management</li>
					<li>Improved auth session management to prevent potential authentication errors</li>
					<li>Performed code cleanup and removed outdated scripts to maintain a leaner codebase</li>
					</ul>
				</div>
				</div>
			</div>
			</div>
			</main>
		</div>
	);
}
