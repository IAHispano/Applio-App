import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { platform, version } from "@tauri-apps/plugin-os";
import { Store } from "@tauri-apps/plugin-store";
import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { getServerPort } from "../../utils/getBackendPort";
import Contributors from "../../components/settings/contributors";
import {
	isPermissionGranted,
	requestPermission,
} from "@tauri-apps/plugin-notification";
import { sendNotificationUtil } from "../../utils/sendNotification";

export default function Settings() {
	const [appVersion, setAppVersion] = useState("");
	const [tauriVersion, setTauriVersion] = useState("");
	const [system, setSystem] = useState("");
	const [systemVersion, setSystemVersion] = useState("");
	const [backgroundColor, setBackgroundColor] = useState("");
	const [effect, setEffect] = useState(false);
	const [sendData, setSendData] = useState(false);
	const [deviceId, setDeviceId] = useState("");
	const [deleteRVC, setDeleteRVC] = useState(false);
	const [discordPresence, setDiscordPresence] = useState(false);
	const [notifications, setNotifications] = useState(false);
	const [tours, setTours] = useState(true);
	const [animateTours, setAnimateTours] = useState(true);

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

		const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b)
			.toString(16)
			.slice(1)}`;
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
		const match = rgba.match(
			/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\d+(?:\.\d+)?)\)$/,
		);
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
			await store.set(
				"backgroundColor",
				`rgba(17, 17, 17, ${effect ? 0.5 : 1})`,
			);
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
						document.documentElement.style.backgroundColor = background
							? RGBAtoRGB(background as string)
							: "";
					}
				}
			} else {
				document.documentElement.style.backgroundColor = background
					? RGBAtoRGB(background as string)
					: "";
			}
		}

		console.log(currentPlatform);
	}

	async function setHaveEffect(haveEffect: boolean) {
		const store = await Store.load("settings.json");
		await store.set("effect", haveEffect);
		await store.save();

		setEffect(haveEffect);
		console.log("effect", haveEffect);

		if (haveEffect) {
			setWindowEffect();
		} else {
			window.location.reload();
		}
	}

	async function setDiscordPresenceOption(value: boolean) {
		const store = await Store.load("settings.json");
		await store.set("discordPresence", value);
		await store.save();

		setDiscordPresence(value);
	}

	async function setNotificationsOption(value: boolean) {
		const permission = await isPermissionGranted();
		if (!permission) {
			await requestPermission();
		}
		console.log("can send notifications?", permission);
		const store = await Store.load("settings.json");
		await store.set("notifications", value);
		await store.save();
		setNotifications(value);
		sendNotificationUtil(
			"Notifications enabled!",
			"Now you will receive notifications when a process is finished.",
		);
	}

	async function setToursOption(value: boolean) {
		const store = await Store.load("settings.json");
		await store.set("tours", value);
		await store.save();
		setTours(value);
	}

	async function setAnimateToursOption(value: boolean) {
		const store = await Store.load("settings.json");
		await store.set("animateTours", value);
		await store.save();
		setAnimateTours(value);
	}

	async function getSendData() {
		try {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/send-data`);
			if (response.ok) {
				const data = await response.json();
				console.log("data", data);
				if (data.error) {
					console.error("Error from server:", data.error);
					setSendData(false);
				} else {
					setSendData(data.send_data);
				}
			} else {
				console.error("Failed to fetch data from server");
				setSendData(false);
			}
		} catch (error) {
			console.error("Error fetching send data:", error);
			setSendData(false);
		}
	}

	async function handleSendData(value: boolean) {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/send-data?send=${value}`,
			);
			if (response.ok) {
				const data = await response.json();
				console.log("response from handleSendData", data);
				if (data.success === false) {
					console.error("Error setting send data:", data.error);
				} else {
					setSendData(value);
				}
			} else {
				console.error("Failed to set send data on server");
			}
		} catch (error) {
			console.error("Error in handleSendData:", error);
		}
	}

	async function getDeviceId() {
		try {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/device-id`);
			if (response.ok) {
				const data = await response.json();
				if (data.error) {
					console.error("Error from server:", data.error);
				} else {
					setDeviceId(data.device_id);
				}
			} else {
				console.error("Failed to fetch data from server");
			}
		} catch (error) {
			console.error("Error fetching device id:", error);
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

		async function getDiscordPresence() {
			const store = await Store.load("settings.json");
			const discordPresence = await store.get("discordPresence");
			if (discordPresence) {
				setDiscordPresence(true);
			} else {
				setDiscordPresence(false);
			}
		}

		async function getNotifications() {
			const store = await Store.load("settings.json");
			const notifications = await store.get("notifications");
			if (notifications) {
				setNotifications(true);
			} else {
				setNotifications(false);
			}
		}

		async function getTours() {
			const store = await Store.load("settings.json");
			const tours = await store.get("tours");
			if (tours === undefined) {
				setTours(true);
				setToursOption(true);
			} else {
				if (tours === true) {
					setTours(true);
				} else {
					setTours(false);
				}
			}
		}

		async function getAnimateTours() {
			const store = await Store.load("settings.json");
			const animateTours = await store.get("animateTours");
			if (animateTours === undefined) {
				setAnimateTours(true);
				setAnimateToursOption(true);
			} else {
				if (animateTours === true) {
					setAnimateTours(true);
				} else {
					setAnimateTours(false);
				}
			}
		}

		getAnimateTours();
		getTours();
		getNotifications();
		getDiscordPresence();
		getEffect();
		getBackground();
		getSendData();
		getDeviceId();
	}, []);

	const predefinedColors = [
		"#2a2b2a",
		"#4D4D4D",
		"#004d2f",
		"#3a0057",
		"#04567c",
		"#615600",
	];

	const handleDeleteRVC = async () => {
		try {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/delete-rvc`);
			if (response.status === 204) {
				setDeleteRVC(true);
			}
			console.log(response.status);
		} catch (error) {
			console.error("Error deleting RVC:", error);
		}
	};

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-end mt-6 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-0">
					<div className="col-span-3 row-span-2 rounded-t-xl w-full h-full border border-white/10 overflow-auto mb-24">
						<div className="flex flex-col w-full h-full rounded-xl justify-start items-start p-4 ">
							<div className="flex flex-col gap-4 w-full h-full">
								{/* Tours */}
								<div>
									<h2 className="text-lg font-medium">Tours</h2>
									<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
									<div className="flex flex-col gap-4">
										<div className="items-center w-full justify-between flex gap-4">
											<div>
												<p className="text-neutral-200 font-medium">
													Enable tours
												</p>
												<p className="text-xs text-neutral-400 max-w-3xl">
													This will show a tour when you use a new feature for
													the first time. Enabled by default.
												</p>
											</div>
											<label className="flex items-center cursor-pointer relative">
												<input
													checked={tours}
													onChange={(e) => setToursOption(e.target.checked)}
													type="checkbox"
													className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
													id="check"
													aria-label="Check for activate option to send data anonymously"
												/>
												<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
													<Check className="h-3.5 w-3.5" />
												</span>
											</label>
										</div>
										<div className="items-center w-full justify-between flex">
											<div>
												<p className="text-neutral-200 font-medium">
													Animate tours
												</p>
												<p className="text-xs text-neutral-400 max-w-3xl">
													This will animate the tour. Enabled by default.
												</p>
											</div>
											<label className="flex items-center cursor-pointer relative">
												<input
													checked={animateTours}
													onChange={(e) =>
														setAnimateToursOption(e.target.checked)
													}
													type="checkbox"
													className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
													id="check"
													aria-label="Check for activate option to send data anonymously"
												/>
												<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
													<Check className="h-3.5 w-3.5" />
												</span>
											</label>
										</div>
									</div>
								</div>
								{/* Privacy */}
								<div>
									<h2 className="text-lg font-medium">Privacy</h2>
									<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
									<div className="items-center w-full justify-between flex">
										<div>
											<p className="text-neutral-200 font-medium">
												Send data anonymously
											</p>
											<p className="text-xs text-neutral-400 max-w-3xl">
												This sends anonymous system data to the server to
												improve the app's performance. Personal information is
												never included, and only technical details are shared.
												Sensitive information is neither collected nor
												transmitted.
											</p>
										</div>
										<label className="flex items-center cursor-pointer relative">
											<input
												checked={sendData}
												onChange={(e) => handleSendData(e.target.checked)}
												type="checkbox"
												className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
												id="check"
												aria-label="Check for activate option to send data anonymously"
											/>
											<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
												<Check className="h-3.5 w-3.5" />
											</span>
										</label>
									</div>
								</div>
								{/* Personalization */}
								<div>
									<h2 className="text-lg font-medium mt-4">Personalization</h2>
									<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
									<div className="flex flex-col gap-4">
										<div className="items-center w-full justify-between flex">
											<div>
												<p className="text-neutral-200 font-medium">
													Enable notifications
												</p>
												<p className="text-xs text-neutral-400">
													Enable application notifications. This will show a
													notification when a conversion is finished or when UVR
													finish separation process.
												</p>
											</div>
											<label className="flex items-center cursor-pointer relative">
												<input
													checked={notifications}
													onChange={(e) =>
														setNotificationsOption(e.target.checked)
													}
													type="checkbox"
													className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
													id="check"
													aria-label="Check for activate notifications"
												/>
												<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
													<Check className="h-3.5 w-3.5" />
												</span>
											</label>
										</div>
										<div className="items-center w-full justify-between flex">
											<div>
												<p className="text-neutral-200 font-medium">
													Enable Discord Rich Presence
												</p>
												<p className="text-xs text-neutral-400">
													This enables the Discord Rich Presence feature,
													displaying your current status on your Discord
													profile. A restart is required for this option to take
													effect.
												</p>
											</div>
											<label className="flex items-center cursor-pointer relative">
												<input
													checked={discordPresence}
													onChange={(e) =>
														setDiscordPresenceOption(e.target.checked)
													}
													type="checkbox"
													className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
													id="check"
													aria-label="Check for activate Discord Rich Presence feature"
												/>
												<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
													<Check className="h-3.5 w-3.5" />
												</span>
											</label>
										</div>
										<div className="items-center w-full justify-between flex">
											<div>
												<p className="text-neutral-200 font-medium">
													Add window effect
												</p>
												<p className="text-xs text-neutral-400">
													This will apply an acrylic effect to the application
													window when you select a background colour, only
													available in Windows 11.
												</p>
											</div>
											<label className="flex items-center cursor-pointer relative">
												<input
													checked={effect}
													onChange={(e) => setHaveEffect(e.target.checked)}
													type="checkbox"
													className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
													id="check"
													aria-label="Check for activate option to apply acrylic effect to the application window"
												/>
												<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
													<Check className="h-3.5 w-3.5" />
												</span>
											</label>
										</div>
									</div>
									<div className="flex justify-between w-full items-center mt-6">
										<div>
											<p className="text-neutral-200 font-medium">
												Change background color
											</p>
											<p className="text-xs text-neutral-400">
												This will apply a background colour to the application
												window.
											</p>
										</div>
										<div className="flex items-center gap-3 mt-4">
											{predefinedColors.map((color) => (
												<button
													type="button"
													key={color}
													style={{ backgroundColor: color }}
													className="w-10 h-10 rounded-full border-2 border-white/20 focus:outline-none transition transform hover:scale-105 shadow-md"
													onClick={() => changeBackgroundColor(color)}
													aria-label="Change background color to predefined color"
												/>
											))}

											<div className="relative flex items-center">
												<input
													type="color"
													value={backgroundColor}
													onChange={(e) =>
														changeBackgroundColor(e.target.value)
													}
													className={`w-10 h-10 cursor-pointer rounded-full border-2 border-white/20 focus:outline-none bg-[${backgroundColor}] appearance-none`}
													aria-label="Change background color to custom color"
												/>
												<span className="text-xs text-neutral-300 absolute inset-0 flex items-center justify-center pointer-events-none">
													<Plus className="w-4 h-4" />
												</span>
											</div>
										</div>
									</div>
								</div>
								{/* Other */}
								<div>
									<h2 className="text-lg font-medium mt-4">Other</h2>
									<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
									<div className="flex gap-2">
										<button
											onClick={handleDeleteRVC}
											disabled={deleteRVC}
											type="button"
											className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
											aria-label="Delete RVC"
										>
											{deleteRVC ? "Delete RVC Successfully" : "Delete RVC"}
										</button>
										<a
											href="/first-time"
											type="button"
											className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
											aria-label="Re-Install RVC"
										>
											Install RVC
										</a>
										<a
											href="/pretraineds"
											type="button"
											className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
											aria-label="Re-install pretraineds"
										>
											Download pretraineds
										</a>
										<button
											onClick={handleTestBackend}
											type="button"
											className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
											aria-label="Test backend"
										>
											Test backend
										</button>
										<button
											onClick={checkUpdates}
											type="button"
											className="px-3 hover:bg-white/20 slow rounded-lg border border-white/10 bg-white/10 py-1 text-sm"
											aria-label="Check for updates"
										>
											Check updates
										</button>
									</div>
									<Contributors />
								</div>
								<div className="flex justify-end items-end mt-auto ml-auto flex-col pb-4">
									<p className="text-neutral-400 text-xs">v{appVersion}</p>
									<p className="text-neutral-400 text-xs">
										tauri-{tauriVersion}
									</p>
									<p className="text-neutral-400 text-xs">
										{deviceId || "Undefined device ID"}
									</p>
									<p className="text-neutral-400 text-xs">
										{system}-{systemVersion}
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
