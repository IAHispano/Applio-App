import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { platform, version } from "@tauri-apps/plugin-os";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";

export default function Settings() {
	const [appVersion, setAppVersion] = useState("");
	const [tauriVersion, setTauriVersion] = useState("");
	const [system, setSystem] = useState("");
	const [systemVersion, setSystemVersion] = useState("");
	const [backgroundColor, setBackgroundColor] = useState("");
	const [effect, setEffect] = useState(false);

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	const handleTestBackend = async () => {
		try {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/`);
			if (response.ok) {
				alert("Backend is running!");
			} else {
				alert("Backend is not running!");
			}
		} catch (error) {
			console.error(error);
		}
	};

	const checkUpdates = async () => {
		const port = await getServerPort();
		const eventSource = new EventSource(
			`http://localhost:${port}/check-update`,
		);
		eventSource.onmessage = (event) => {
			console.log(event.data);
			if (event.data.includes("up to date")) {
				alert("No update available");
				eventSource.close();
			} else {
				alert("Update available");
				eventSource.close();
			}
		};
		return () => {
			eventSource.close();
		};
	};

	const hexToRGBA = (hex: string, alpha: number) => {
		const bigint = Number.parseInt(hex.slice(1), 16);
		const r = (bigint >> 16) & 255;
		const g = (bigint >> 8) & 255;
		const b = bigint & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	};

	function rgbaToHex(rgba: string) {
		const parts = rgba.match(/(\d+), (\d+), (\d+), (\d+(\.\d+)?)/);
		if (!parts) return "#111111";

		const r = Number.parseInt(parts[1]);
		const g = Number.parseInt(parts[2]);
		const b = Number.parseInt(parts[3]);

		const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
		return hex;
	}

	useEffect(() => {
		async function checkVersion() {
			const appversion = await getVersion();
			const tauriversion = await getTauriVersion();
			const platformName = platform();
			const osVersion = await version();

			setAppVersion(appversion);
			setTauriVersion(tauriversion);
			setSystem(platformName);
			setSystemVersion(osVersion);
		}

		checkVersion();
	}, []);

	async function changeBackgroundColor(background: string) {
		const color = hexToRGBA(background, 0.5);
		const store = await Store.load("settings.json");
		await store.set("backgroundColor", color);
		await store.save();
		setBackgroundColor(background as string);
		setWindowEffect();
	}

	const RGBAtoRGB = (rgba: string) => {
		const match = rgba.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\d+(?:\.\d+)?)\)$/);
		if (match) {
			return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
		}
		return rgba;
	};

	async function setWindowEffect() {
		const currentPlatform = await platform();
		const osVersion = await version();
		const store = await Store.load("settings.json");
		const background = await store.get("backgroundColor");
		const effect = await store.get("effect");

		if (!background) {
			await store.set("backgroundColor", `rgba(17, 17, 17, ${effect ? 0.5 : 1})`);
			await store.save();
		}

		if (background) {
			if (currentPlatform === "windows") {
				if (osVersion >= "10.0.22000.0") {
					document.documentElement.style.background = "transparent";
					document.documentElement.style.backgroundColor = background as string;
					if (effect) {
						await getCurrentWindow().setEffects({ effects: [Effect.Acrylic] });
					} else {
						document.documentElement.style.backgroundColor = background ? RGBAtoRGB(background as string) : '';
					}
				}
			} else {
				document.documentElement.style.backgroundColor = background ? RGBAtoRGB(background as string) : '';
			}
		}

		console.log(currentPlatform);
	}

	async function setHaveEffect(haveEffect: boolean) {
		const store = await Store.load("settings.json");
		await store.set("effect", haveEffect);
		await store.save();

		setEffect(haveEffect);
		console.log('effect', haveEffect);

		if (haveEffect) {
			setWindowEffect();
		} else {
			window.location.reload();
		}
	}

	useEffect(() => {
		async function getBackground() {
			const store = await Store.load("settings.json");
			const background = await store.get("backgroundColor");
			if (background) {
				const color = rgbaToHex(background as string);
				setBackgroundColor(color);
			} else {
				setBackgroundColor("#111111");
			}
		}

		async function getEffect() {
			const store = await Store.load("settings.json");
			const effect = await store.get("effect");
			if (effect) {
				setHaveEffect(true);
			} else {
				setEffect(false);
			}
		}

		getEffect();
		getBackground();
	}, []);

	const predefinedColors = [
		"#2a2b2a",
		"#4D4D4D",
		"#004d2f",
		"#3a0057",
		"#04567c",
		"#615600",
	];

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-end mt-6 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-0">
					<div className="col-span-3 row-span-2 rounded-t-xl w-full h-full border border-white/10">
						<div className="flex flex-col w-full h-full rounded-xl justify-start items-start p-4">
							<h1 className="text-xl font-bold title">Settings</h1>
							<h2 className="text-lg font-medium mt-4">Personalization</h2>
							<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
							<div className="items-center w-full justify-between flex">
												<div>
											    <p className="text-neutral-200 font-medium">Window effect</p>
												<p className="text-xs text-neutral-400">This will apply an acrylic effect to the application window when you select a background colour, only available in Windows 11.</p>
												</div>
												<label className="flex items-center cursor-pointer relative">
													<input
														checked={effect}
														onChange={(e) => setHaveEffect(e.target.checked)}
														type="checkbox"
														className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
														id="check"
													/>
													<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															className="h-3.5 w-3.5"
															viewBox="0 0 20 20"
															fill="currentColor"
															stroke="currentColor"
															strokeWidth="1"
															aria-label="Checkmark"
															aria-hidden="true"
														>
															<path
																fill-rule="evenodd"
																d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
																clip-rule="evenodd"
															/>
														</svg>
													</span>
												</label>
										</div>
							<div className="flex justify-between w-full items-center mt-6"> 
								<div>
								<p className="text-sm text-neutral-200 font-medium">Background</p>
								<p className="text-xs text-neutral-400">This will apply a background colour to the application window.</p>
								</div>
								<div className="flex items-center gap-3 mt-4">
									{predefinedColors.map((color) => (
										<button
											type="button"
											key={color}
											style={{ backgroundColor: color }}
											className="w-10 h-10 rounded-full border-2 border-white/20 focus:outline-none transition transform hover:scale-105 shadow-md"
											onClick={() => changeBackgroundColor(color)}
										/>
									))}

									<div className="relative flex items-center">
										<input
											type="color"
											value={backgroundColor}
											onChange={(e) => changeBackgroundColor(e.target.value)}
											className={`w-10 h-10 cursor-pointer rounded-full border-2 border-white/20 focus:outline-none bg-[${backgroundColor}] appearance-none`}
										/>
										<span className="text-xs text-neutral-300 absolute inset-0 flex items-center justify-center pointer-events-none">
											<svg
                                                aria-hidden="true"
												className="w-4 h-4"
												viewBox="0 0 24 24"
												fill="none"
												xmlns="http://www.w3.org/2000/svg"
												stroke="#ffffff"
											>
												<g id="SVGRepo_bgCarrier" stroke-width="0" /> 
												<g
													id="SVGRepo_tracerCarrier"
													stroke-linecap="round"
													stroke-linejoin="round"
												/>
												<g id="SVGRepo_iconCarrier">
													{" "}
													<path
														d="M4 12H20M12 4V20"
														stroke="#ffffff"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>{" "}
												</g>
											</svg>
										</span>
									</div>
								</div>
							</div>
							<h2 className="text-lg font-medium mt-4">Developer</h2>
							<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
							<div className="flex gap-2">
								<a
									href="/first-time"
									type="button"
									className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
								>
									Install RVC
								</a>
								<a
									href="/pretraineds"
									type="button"
									className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
								>
									Download pretraineds
								</a>
								<button
									onClick={handleTestBackend}
									type="button"
									className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
								>
									Test backend
								</button>
								<button
									onClick={checkUpdates}
									type="button"
									className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
								>
									Check updates
								</button>
							</div>
							<div className="flex justify-end items-end mt-auto ml-auto flex-col">
								<p className="text-neutral-400 text-xs">v{appVersion}</p>
								<p className="text-neutral-400 text-xs">tauri-{tauriVersion}</p>
								<p className="text-neutral-400 text-xs">
									{system}-{systemVersion}
								</p>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}