import "./App.css";
import { useEffect, useRef, useState } from "react";
import { platform, type, version } from "@tauri-apps/plugin-os";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { isFirstRun, setNotFirstRun } from "./scripts/isFirstTime";
import { BrowserRouter as Router, Route, Routes, Link } from "react-router-dom";
import Header from "./components/layout/header";
import { TitleBar } from "./components/layout/titlebar";
import Welcome from "./components/first-time/welcome";
import PreInstall from "./components/first-time/pre-install";
import { supabase } from "./utils/database";
import { invoke } from "@tauri-apps/api/core";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import Background1 from "./components/svg/background1";
import { Store } from "@tauri-apps/plugin-store";
import {
	ConvertProvider,
	useConvertContext,
} from "./components/convert/conversion-context";

function App() {
	const [updateAvailable, setUpdateAvailable] = useState(false);

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	// check if dev mode
	async function checkIfDev() {
		const isDev = await invoke("is_dev");
		console.log(isDev);
		if (!isDev) {
			checkOS();
		}
	}

	// check os type
	async function checkOS() {
		const os = await type();
		if (os === "macos" || os === "linux") {
			window.location.href = "/os-not-supported";
		}
	}

	// set window acrylic effect
	async function setWindowEffect() {
		const currentPlatform = await platform();
		const osVersion = await version();
		const store = await Store.load("settings.json");
		const background = await store.get("backgroundColor");

		if (!background) {
			await store.set("backgroundColor", "rgba(17, 17, 17, 0.7)");
			await store.save();
		}

		if (background) {
			if (currentPlatform === "windows") {
				if (osVersion >= "10.0.22000.0") {
					document.documentElement.style.background = "transparent";
					document.documentElement.style.backgroundColor =
						background as unknown as string;
					await getCurrentWindow().setEffects({ effects: [Effect.Acrylic] });
				}
			} else {
				document.documentElement.style.background = "#111111";
			}
		}

		console.log(currentPlatform);
	}

	// initialize discord rpc
	const initializeDiscordRpc = async () => {
		try {
			await invoke("set_discord_presence", {
				state: "Creating awesome AI Audios.",
				details: "Using the easiest voice cloning tool, now in app.",
			});
		} catch (error) {
			console.error("Error starting discord presence:", error);
		}
	};

	// check if first run
	const checkFirstRun = async () => {
		const isFirstTime = await isFirstRun();
		console.log(isFirstTime);
		if (isFirstTime) {
			console.log("First time run, continuing...");
			window.location.href = "/first-time";
			setNotFirstRun();
		} else {
			console.log("Not first time...");
		}
	};

	// check rvc updates
	const checkUpdates = async () => {
		if (window.location.pathname === "/") {
			const port = await getServerPort();
			const eventSource = new EventSource(
				`http://localhost:${port}/check-update`,
			);
			eventSource.onmessage = (event) => {
				console.log(event.data);
				if (event.data.includes("up to date")) {
					setUpdateAvailable(false);
					eventSource.close();
				} else {
					setUpdateAvailable(true);
					eventSource.close();
				}
			};
			return () => {
				eventSource.close();
			};
		}
	};

	const checkRVC = async () => {
		const port = await getServerPort();
		const response = await fetch(`http://localhost:${port}/check-rvc`);
		const data = await response.json();
		console.log(data);
		if (!data.exists) {
			setUpdateAvailable(true);
		}
	};

	// remove contextmenu
	useEffect(() => {
		const handleContextMenu = (event: MouseEvent) => {
			event.preventDefault();
		};

		document.addEventListener("contextmenu", handleContextMenu);

		return () => {
			document.removeEventListener("contextmenu", handleContextMenu);
		};
	}, []);

	// stop server on close request
	useEffect(() => {
		const handleCloseRequested = async (event: any) => {
			event.preventDefault();
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/stop`);
			localStorage.removeItem("appInitialized");

			if (!response.ok) {
				alert("Error, please report on GitHub");
			} else {
				console.log("Server shutting down...");
				getCurrentWindow().destroy();
			}
		};

		const currentWindow = getCurrentWindow();

		const unlisten = currentWindow.onCloseRequested((event) => {
			handleCloseRequested(event);
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// check if app is initialized
	useEffect(() => {
		const initialized = localStorage.getItem("appInitialized");
		if (!initialized) {
			localStorage.setItem("appInitialized", "true");
			checkIfDev();
			initializeDiscordRpc();
			checkFirstRun();
		}
	}, []);

	useEffect(() => {
		setWindowEffect();
		checkRVC();
		checkUpdates();
	}, []);

	return (
		<ConvertProvider>
			<Router>
				{updateAvailable && window.location.pathname !== "/first-time" && (
					<a
						href="/first-time"
						className="hover:bg-black/20 slow absolute right-32 top-2 w-fit p-2 px-4 shadow-lg shadow-green-500/10 h-fit border border-white/20 rounded-xl"
						style={{ zIndex: 300 }}
					>
						<p className="text-xs">Update available!</p>
					</a>
				)}
				<TitleBar />
				<div className="flex w-screen h-screen gap-0">
					{window.location.pathname !== "/first-time" &&
						window.location.pathname !== "/pretraineds" &&
						window.location.pathname !== "/os-not-supported" && <Header />}
					<Routes>
						<Route index path="/" element={<Home />} />
						<Route path="*" element={<NotFound />} />
						<Route path="/first-time" element={<FirstTime />} />
						<Route path="/models" element={<Models />} />
						<Route path="/settings" element={<Settings />} />
						<Route path="/convert" element={<Convert />} />
						<Route path="/pretraineds" element={<DownloadPretraineds />} />
						<Route path="/os-not-supported" element={<OSNotSupported />} />
					</Routes>
				</div>
			</Router>
		</ConvertProvider>
	);
}

function Home() {
	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-center justify-start mt-8 w-full overflow-visible">
				<div className="grid grid-cols-3 md:grid-cols-3 gap-4 w-full h-full p-4 ">
					<div className="col-span-3 row-span-2 rounded-xl bg-[#111111]/50 w-full h-full border border-white/20 shadow-2xl shadow-[#00AA68]/20">
						<div
							className="pt-6 flex flex-col w-full h-full rounded-xl justify-center items-center noise relative overflow-visible"
							style={{
								background:
									"radial-gradient(150% 150% at 50% 10%, #111111A3 40%, #00AA68 100%)",
							}}
						>
							<h1 className="text-[100px] font-bold title">Applio</h1>
						</div>
					</div>
					<div className="col-span-1 rounded-xl bg-[#111111]/50 w-full h-full border border-white/20">
						<div className="pt-6 flex flex-col w-full h-full rounded-xl justify-end items-start noise relative p-4">
							<p className="text-xl">
								Now with{" "}
								<span className="title font-semibold text-green-400">
									Applio AI
								</span>
							</p>
							<p className="text-sm text-neutral-300">
								All models will have a description generated with artificial
								intelligence based on the character's name, language and
								profession.
							</p>
						</div>
					</div>
					<div className="col-span-1 rounded-xl bg-[#111111]/50 w-full h-full border border-white/20">
						<div className="pt-6 flex flex-col w-full h-full rounded-xl justify-end items-start noise relative p-4">
							<p className="text-xl">
								Cloud <span className="text-blue-400">sync</span>
							</p>
							<p className="text-sm text-neutral-300">
								You will be able to see the inferences you have made, the
								trained models or any data from this application elsewhere in
								our ecosystem.
							</p>
						</div>
					</div>
					<div className="col-span-1 rounded-xl bg-[#111111]/50 w-full h-full border border-white/20">
						<div className="pt-6 flex flex-col w-full h-full rounded-xl justify-end items-start noise relative p-4">
							<p className="text-xl">
								Customize to your
								<span className="text-red-400 ml-1">l</span>
								<span className="text-yellow-400">i</span>
								<span className="text-green-400">k</span>
								<span className="text-blue-400">i</span>
								<span className="text-purple-400">n</span>
								<span className="text-pink-400">g</span>
							</p>
							<p className="text-sm text-neutral-300">
								In your settings you can change the theme of the application to
								your liking, or import a pre-made one from the community.
							</p>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}

function NotFound() {
	return (
		<div className="w-screen h-screen flex justify-center items-center">
			<h1 className="text-center text-xl font-bold title">Not Found :(</h1>
		</div>
	);
}

function FirstTime() {
	const [page, setPage] = useState(0);

	const handleNextPage = () => {
		setPage(page + 1);
	};

	return (
		<main className="absolute inset-0 bg-[#0a0a0a] w-full h-full p-4 flex flex-col justify-center items-center">
			{page === 0 && <Welcome next={handleNextPage} />}
			{page === 1 && <PreInstall />}
		</main>
	);
}

function Models() {
	const [value, setValue] = useState("");
	const [data, setData] = useState<any>();
	const [loading, setLoading] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [status, setStatus] = useState("");
	const [info, setInfo] = useState("");
	const [error, setError] = useState(false);
	const [mode, setMode] = useState("explore");
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");

	useEffect(() => {
		async function getModels() {
			setLoading(true);
			if (!value) {
				setData([]);
				setLoading(false);
				return;
			}
			if (!supabase) return;
			const { data, error } = await supabase
				.from("models")
				.select("*")
				.ilike("name", `%${value}%`)
				.order("created_at", { ascending: false })
				.limit(12);
			if (error) {
				console.log(error);
				setData(null);
			}
			if (data && data.length > 0) {
				console.log("models", data);
				setData(data);
				setLoading(false);
			} else {
				setData(null);
				setLoading(false);
			}
		}

		getModels();
	}, [value]);

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	const downloadModel = async (
		link: string,
		id?: string,
		epochs?: string,
		algorithm?: string,
		name?: string,
		author?: string,
		from?: string,
	) => {
		const port = await getServerPort();
		setDropdownOpen(true);
		setInfo("Starting...");
		setStatus("Sending request...");
		setError(false);
		try {
			const queryParams = new URLSearchParams();
			queryParams.append("link", encodeURIComponent(link));
			if (id) {
				queryParams.append("id", encodeURIComponent(id));
			} else {
				const newId = crypto.randomUUID();
				queryParams.append("id", encodeURIComponent(newId));
			}
			if (epochs) queryParams.append("epochs", encodeURIComponent(epochs));
			if (algorithm) queryParams.append("algorithm", encodeURIComponent(algorithm));
			if (name) queryParams.append("name", encodeURIComponent(name));
			if (author) queryParams.append("author", encodeURIComponent(author));
			if (from) queryParams.append("from", encodeURIComponent(from));
			
			console.log(queryParams.toString());

			const eventSource = new EventSource(`http://localhost:${port}/download?${queryParams.toString()}`);

			eventSource.onmessage = (event) => {
				console.log(event.data);
				setStatus(event.data);
				if (event.data.includes("Downloading model")) {
					setInfo("Downloading");
					setStatus("Downloading model...");
				}
				if (event.data.includes("downloaded")) {
					setInfo("Downloaded");
					setStatus("Downloaded successfully");
					eventSource.close();
				}
				if (event.data.includes("error")) {
					setInfo("Error");
					setStatus("Error downloading model, please try again.");
					setError(true);
					eventSource.close();
				}
				if (event.data.includes("WinError") && event.data.includes("183")) {
					setInfo("Error");
					setStatus("You already have this model!");
					setError(true);
					eventSource.close();
				}
			};

			eventSource.onerror = (err) => {
				console.log(info);
				console.error("Error with event source:", err);
				eventSource.close();
				setError(true);
				setStatus("We detected an error, please try again.");
			};

			return () => {
				eventSource.close();
			};
		} catch (error) {
			console.error("Error:", error);
			setStatus("We detected an error. Please try again later.");
		}
	};

	return (
		<div className="w-screen h-screen flex flex-col pt-12 pr-4 relative p-4 overflow-hidden">
			{dropdownOpen && (
				<div className="absolute inset-0 ml-3 backdrop-blur-2xl backdrop-filter w-full h-full overflow-hidden">
					<div className="w-full h-full flex justify-center items-center">
						<div className="w-full max-w-2xl h-fit min-h-[16svh] border border-white/10 bg-[#111111] shadow rounded-xl p-4 flex flex-col">
							<div className="flex mb-auto justify-start items-start">
							<h1 className="font-medium text-2xl">Download model</h1>
							</div>
							<div className="mt-auto flex justify-end items-start flex-col gap-4 w-full"> 
							<div className="w-full flex rounded-full h-2.5 border border-white/10 mt-6 shadow-lg shadow-white/10">
								<div
									className={`h-2.5 rounded-full ${error ? "bg-red-500/30" : "bg-green-500"}`}
									style={{
										width:
											info === "Starting..."
												? "20%"
												: info === "Downloading"
													? "50%"
													: info === "Downloaded" || info === "Error"
														? "100%"
														: "0%",
									}}
								/>
							</div>
							{!error && (
								<p className="text-xs text-neutral-400 flex">
									Status: {status}
								</p>
							)}
							{error && (
								<div className="px-4 py-2 text-sm rounded-xl bg-red-500/30 text-neutral-300 w-full">
									{status}
								</div>
							)}
							{(info === "Downloaded" || error) && (
								<button
									type="button"
									className="flex justify-end ml-auto px-6 py-1.5 bg-white text-black rounded-xl text-sm"
									onClick={() => setDropdownOpen(false)}
								>
									Close
								</button>
							)}
							</div>
						</div>
					</div>
				</div>
			)}
			<div className="p-4 bg-[#111111]/30 border border-white/20 h-full rounded-xl flex flex-col gap-4 overflow-auto">
			<div className="border border-white/10 rounded-xl w-full p-4 flex gap-4 shadow-2xl shadow-white/10">
			<button type="button" onClick={() => setMode("explore")} className={`px-4 py-1 rounded-xl ${mode === "explore" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}>Explore</button>
			<button type="button" onClick={() => setMode("import")} className={`px-4 py-1 rounded-xl ${mode === "import" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}>Import</button>
			<button type="button" onClick={() => setMode("downloaded")} className={`justify-end ml-auto px-4 py-1 rounded-xl ${mode === "downloaded" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}>My models</button>
			</div>
			{mode === "explore" && (
			<div className="mt-6">
			<input
				type="text"
				className="w-full h-12 rounded-xl border-white/20 border focus:outline-none bg-[#111111]/50 p-4"
				placeholder="Search..."
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
			<div className="w-full mt-6">
				{!loading && data === null && (
					<div className="flex flex-col items-center justify-center w-full h-full">
						<h1 className="text-center text-neutral-300">No results found</h1>
					</div>
				)}
				{loading && (
					<div className="flex flex-col items-center justify-center w-full h-full">
						<h1 className="text-center text-neutral-300">Loading...</h1>
					</div>
				)}
				{!value && (
					<div className="flex flex-col items-center justify-center w-full h-full">
						<h1 className="text-center text-neutral-300">
							Start searching for your favorite model
						</h1>
					</div>
				)}
				{!loading && data && (
					<div className="grid grid-cols-3 gap-2 w-full">
						{data.map((item: any) => (
							<button
								onClick={() =>
									downloadModel(
										item.link,
										item.id,
										item.epochs,
										item.algorithm,
										item.name,
										item.author_username,
										item.server_name,
									)
								}
								type="button"
								className="w-full h-full min-h-[20svh] text-left rounded-xl border-white/20 border focus:outline-none bg-[#111111]/50 p-4 hover:shadow-xl hover:shadow-white/20 slow flex flex-col items-start justify-start"
								key={item.id}
							>
								<h1 className="font-semibold title text-neutral-200 text-lg">
									{item.name}
								</h1>
								<p className="text-xs">
									created by {item.author_username} at
									<span className="pl-1">
										{new Date(item.created_at).toLocaleDateString("en-US", {
											year: "numeric",
											month: "long",
											day: "numeric",
										})}
									</span>
								</p>
								<div className="justify-end flex mt-auto gap-2">
									<p className="bg-[#111111] px-2 rounded-md text-sm">
										{item.epochs} epochs
									</p>
									<p className="bg-[#111111] px-2 rounded-md text-sm">
										{item.algorithm}
									</p>
									<p className="bg-[#111111] px-2 rounded-md text-sm">
										{item.likes} likes
									</p>
								</div>
							</button>
						))}
					</div>
				)}
			</div>
			</div>
			)}
			{mode === "import" && (
				<div className="w-full h-full flex flex-col items-center mt-6 gap-2">
					<div className="flex flex-col w-full">
					<p className="font-medium justify-start mr-auto px-0.5 mb-2">URL</p>
					<input required onChange={(e) => setUrl(e.target.value)} className="w-full h-12 rounded-xl border-white/20 border focus:outline-none bg-[#111111]/50 p-4 text-sm text-neutral-300" type="text" placeholder="https://drive.google.com/file/d/1231207i231/view?usp=sharing" />
					</div>
					{/* <div className="flex flex-col w-full">	
					<p className="font-medium justify-start mr-auto px-0.5 mb-2">Name</p>
					<input onChange={(e) => setName(e.target.value)} className="w-full h-12 rounded-xl border-white/20 border focus:outline-none bg-[#111111]/50 p-4 text-sm text-neutral-300" type="text" placeholder="Quevedo --- 3000 epochs" />
					</div> */}
					{url && <button onClick={() => downloadModel(url)} className="w-fit justify-end ml-auto mt-12 px-4 py-2 bg-white text-black rounded-xl text-sm hover:bg-opacity-80 slow" type="button">Import</button>}
				</div>
				)}
			{mode === "downloaded" && (
				<div className="w-full h-full flex flex-col items-center justify-center">
					<h1 className="text-center text-neutral-300">My models</h1>
					<p className="text-sm text-neutral-300 mt-2">
						Here you gonna see your downloaded models.
					</p>
				</div>
				)}
			</div>
		</div>
	);
}

function Settings() {
	const [appVersion, setAppVersion] = useState("");
	const [tauriVersion, setTauriVersion] = useState("");
	const [system, setSystem] = useState("");
	const [systemVersion, setSystemVersion] = useState("");
	const [backgroundColor, setBackgroundColor] = useState("");

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
		const bigint = parseInt(hex.slice(1), 16);
		const r = (bigint >> 16) & 255;
		const g = (bigint >> 8) & 255;
		const b = bigint & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	};

	function rgbaToHex(rgba: string) {
		const parts = rgba.match(/(\d+), (\d+), (\d+), (\d+(\.\d+)?)/);
		if (!parts) return "#111111";

		const r = parseInt(parts[1]);
		const g = parseInt(parts[2]);
		const b = parseInt(parts[3]);

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
		const color = hexToRGBA(background, 0.7);
		const store = await Store.load("settings.json");
		await store.set("backgroundColor", color);
		await store.save();
		setBackgroundColor(background as string);
		setWindowEffect();
	}

	async function setWindowEffect() {
		const currentPlatform = await platform();
		const osVersion = await version();
		const store = await Store.load("settings.json");
		const background = await store.get("backgroundColor");

		if (!background) {
			await store.set("backgroundColor", "rgba(17, 17, 17, 0.7)");
			await store.save();
		}

		if (background) {
			if (currentPlatform === "windows") {
				if (osVersion >= "10.0.22000.0") {
					document.documentElement.style.background = "transparent";
					document.documentElement.style.backgroundColor = background as string;
					await getCurrentWindow().setEffects({ effects: [Effect.Acrylic] });
				}
			} else {
				document.documentElement.style.background = "#111111";
			}
		}

		console.log(currentPlatform);
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

		getBackground();
	}, []);

	const predefinedColors = [
		"#111111",
		"#4D4D4D",
		"#004d2f",
		"#3a0057",
		"#04567c",
		"#615600",
	];

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-end mt-8 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-0">
					<div className="col-span-3 row-span-2 rounded-t-xl bg-[#111111]/20 w-full h-full border border-white/20 ">
						<div className="flex flex-col w-full h-full rounded-xl justify-start items-start p-4">
							<h1 className="text-xl font-bold title">Settings</h1>
							<h2 className="text-lg font-medium mt-4">Personalization</h2>
							<div className="w-full h-0.5 rounded-xl bg-white/20 mt-2 mb-4" />
							<div className="flex flex-col gap-2">
								<p className="text-xs text-neutral-300">Background</p>
								<div className="flex items-center gap-3 mb-4 mt-2">
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
												className="w-4 h-4"
												viewBox="0 0 24 24"
												fill="none"
												xmlns="http://www.w3.org/2000/svg"
												stroke="#ffffff"
											>
												<g id="SVGRepo_bgCarrier" stroke-width="0"></g>
												<g
													id="SVGRepo_tracerCarrier"
													stroke-linecap="round"
													stroke-linejoin="round"
												></g>
												<g id="SVGRepo_iconCarrier">
													{" "}
													<path
														d="M4 12H20M12 4V20"
														stroke="#ffffff"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													></path>{" "}
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

function DownloadPretraineds() {
	const [status, setStatus] = useState("Starting...");
	const [info, setInfo] = useState("Downloading...");

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}
	useEffect(() => {
		const installPretraineds = async () => {
			try {
				const port = await getServerPort();
				const eventSource = new EventSource(
					`http://localhost:${port}/pretraineds`,
				);

				eventSource.onmessage = (event) => {
					console.log(event.data);
					setStatus(event.data);

					if (event.data.includes("installed successfully")) {
						eventSource.close();
						setInfo("Finishing....");
						setStatus("Installing... please wait...");
						window.location.href = "/";
					}
				};

				eventSource.onerror = (err) => {
					console.log(info);
					console.error("Error with event source:", err);
					eventSource.close();
					setStatus("");
					setInfo("We detected an error. Please try again later.");
				};

				return () => {
					eventSource.close();
				};
			} catch (error) {
				console.error("Error fetching port or setting up event source:", error);
				setInfo("We detected an error. Please try again later.");
			}
		};

		installPretraineds();
	}, [info]);

	return (
		<section className="absolute inset-0 z-50">
			<div className="w-screen h-screen absolute inset-0 bg-[#111111] pointer-events-none">
				<Background1 />
			</div>
			<div className="absolute inset-0 mt-auto flex z-50">
				<div className="z-50 flex flex-col w-full justify-center items-center mx-auto">
					<h1 className="font-bold text-4xl lg:text-5xl xl:text-6xl title">
						Downloading pretraineds
					</h1>
					<p className="text-white/80 text-sm mt-1">
						We need to install some more data to complete the installation.
					</p>
					<div className="flex flex-col justify-center items-center mx-auto w-full gap-2 my-4">
						{status && (
							<span className="px-4 py-2 text-center w-full h-fit max-w-sm bg-[#111111]/20 backdrop-filter backdrop-blur-xl rounded-full border border-white/10 text-xs truncate shadow-2xl shadow-white/20">
								{status}
							</span>
						)}
						{!info.includes("error") && (
							<span className="text-[10px] text-center text-neutral-300">
								{info}
							</span>
						)}
						{info.includes("error") && (
							<span className="text-xs text-center px-4 py-1 rounded-xl bg-red-500/20 border border-white/10 text-white">
								{info}
							</span>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

function OSNotSupported() {
	return (
		<main className="absolute inset-0 bg-black">
			<div className="w-screen h-screen flex flex-col justify-center items-center mx-auto pb-4">
				<h1 className="text-center text-4xl font-bold title">
					OS not supported
				</h1>
				<p className="max-w-[350px] text-sm text-center text-neutral-300 mt-2">
					We are working on supporting more operating systems.
				</p>
				<p className="max-w-[350px] text-sm text-center text-neutral-300">
					Sorry for the inconvenience.
				</p>
			</div>
		</main>
	);
}

function Convert() {
	const {
		models,
		setModels,
		currentIndex,
		setCurrentIndex,
		file,
		setFile,
		uploaded,
		setUploaded,
		info,
		setInfo,
		status,
		setStatus,
		error,
		setError,
		input,
		setInput,
		pth,
		setPth,
		index,
		setIndex,
		output,
		setOutput,
		pitch,
		setPitch,
		indexRate,
		setIndexRate,
		filterRadius,
		setFilterRadius,
		autotune,
		setAutotune,
		isPlaying,
		setIsPlaying,
		progress,
		setProgress,
		convertedAudio,
		setConvertedAudio,
		convertTime,
		setConvertTime,
		cleanAudio,
		setCleanAudio,
		exportFormat,
		setExportFormat,
	} = useConvertContext();
	const audioRef = useRef<HTMLAudioElement>(null);

	const togglePlayPause = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause();
			} else {
				audioRef.current.play();
			}
			setIsPlaying((prevState) => !prevState);
		}
	};

	const handleTimeUpdate = () => {
		if (audioRef.current) {
			const progress =
				(audioRef.current.currentTime / audioRef.current.duration) * 100;
			setProgress(progress as unknown as string);
		}
	};

	useEffect(() => {
		const audioElement = audioRef.current;
		if (audioElement) {
			audioElement.addEventListener("timeupdate", handleTimeUpdate);
			return () => {
				audioElement.removeEventListener("timeupdate", handleTimeUpdate);
			};
		}
	}, [isPlaying]);

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	useEffect(() => {
		async function getLocalModels() {
			try {
				const port = await getServerPort();
				const response = await fetch(`http://localhost:${port}/get-models`);
				if (response.ok) {
					const models = await response.json();
					setModels(models);
				} else {
					console.error("Error fetching models:", response.statusText);
				}
			} catch (error) {
				console.error("Fetch error:", error);
			}
		}

		getLocalModels();
	}, []);

	useEffect(() => {
		if (models[currentIndex] && models[currentIndex].model_index_file) {
			console.log("model_index_file:", models[currentIndex].model_index_file);
			console.log("model_pth_file:", models[currentIndex].model_pth_file);
			setIndex(models[currentIndex].model_index_file);
			setPth(models[currentIndex].model_pth_file);
		}
	}, [models, currentIndex]);

	const nextModel = () => {
		if (currentIndex < models.length - 1) {
			setCurrentIndex(currentIndex + 1);
		}
	};

	const prevModel = () => {
		if (currentIndex > 0) {
			setCurrentIndex(currentIndex - 1);
		}
	};

	const currentModel = models[currentIndex];

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFile = e.target.files?.[0];
		if (selectedFile) {
			setFile(selectedFile);
		}
	};

	const handleUpload = async () => {
		if (!file) return;

		const formData = new FormData();
		formData.append("audio", file);

		try {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/upload`, {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				throw new Error("Error uploading file");
			}

			const data = await response.json();
			console.log(data);
			setUploaded(true);
			setInput(data[0].file_path);
		} catch (error) {
			console.error(error);
		}
	};

	const convert = async () => {
		const startingTime = performance.now();
		setInfo("Starting...");
		setStatus("Sending request...");
		setError(false);

		const time = setInterval(() => {
			const actualTime = performance.now();
			const duration = (actualTime - startingTime) / 1000;
			setConvertTime(duration.toFixed(2));
		}, 100);

		const port = await getServerPort();
		try {
			const url = `http://localhost:${port}/convert?input=${encodeURIComponent(input)}&pth=${encodeURIComponent(pth)}&index=${encodeURIComponent(index)}&pitch=${encodeURIComponent(pitch)}&indexRate=${encodeURIComponent(indexRate)}&filterRadius=${encodeURIComponent(filterRadius)}&autotune=${encodeURIComponent(autotune)}&cleanaudio=${encodeURIComponent(cleanAudio)}&exportformat=${encodeURIComponent(exportFormat)}`;
			const eventSource = new EventSource(url);
			console.log(url);
			eventSource.onmessage = (event) => {
				console.log(event.data);
				setStatus(event.data);
				if (event.data.includes("error")) {
					setInfo("Error");
					setStatus("An error has occurred, please try again.");
					setError(true);
					clearInterval(time);
					eventSource.close();
				}
				if (event.data.includes("finished")) {
					const audioPath = event.data.split("Audio path: ")[1];
					console.log(audioPath);
					setConvertedAudio(audioPath);
					getAudio(audioPath);
					setInfo("Conversion completed!");
					setStatus("Your audio has been converted successfully.");
					clearInterval(time);
					eventSource.close();
				}

				if (event.data.includes("completed")) {
					setInfo("Finishing...");
					setStatus("Receiving audio...");
					clearInterval(time);
				}
			};

			eventSource.onerror = (err) => {
				console.log(info);
				console.error("Error with event source:", err);
				eventSource.close();
				setError(true);
				clearInterval(time);
				setStatus("We detected an error, please try again.");
			};

			return () => {
				eventSource.close();
				clearInterval(time);
			};
		} catch (error) {
			console.error("Error:", error);
			clearInterval(time);
			setStatus("We detected an error. Please try again later.");
		}
	};

	const openDocs = async () => {
		open("https://docs.applio.org");
	};

	const downloadAudio = async (path: string) => {
		const lastSlashIndex = path.lastIndexOf("\\");
		const pathWithoutFile = path.substring(0, lastSlashIndex);

		open(pathWithoutFile);
	};

	function transformPath(path: string) {
		return path.replace(/\\/g, "/");
	}

	async function getAudio(path: string) {
		const transformedPath = transformPath(path);
		const port = await getServerPort();
		try {
			const response = await fetch(
				`http://localhost:${port}/audio?path=${encodeURIComponent(transformedPath)}`,
			);
			if (!response.ok) {
				throw new Error("Error getting audio");
			}
			const audioBlob = await response.blob();
			setOutput(URL.createObjectURL(audioBlob));
		} catch (error) {
			console.error("Error:", error);
		}
	}

	const handleReset = () => {
		setInput("");
		setPth("");
		setIndex("");
		setPitch(0);
		setIndexRate(0.3);
		setFilterRadius(3);
		setAutotune(false);
		setOutput("");
		setUploaded(false);
		setFile(null);
	};

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-center mt-8 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-4">
					<div className="col-span-3 row-span-2 rounded-xl w-full h-full">
						<div className="flex gap-2 w-full h-full rounded-xl">
							<div className="grid grid-cols-1 grid-rows-3 gap-2 w-full max-w-[40svh] h-full">
								<div className="relative border border-white/20 rounded-xl row-span-2 w-full h-full">
									<div
										className="absolute w-full h-full rounded-xl backdrop-blur-3xl backdrop-filter noise opacity-40"
										style={{
											background: "linear-gradient(#111111A3 10%, #00AA68)",
											zIndex: -1,
										}}
									/>
									<div className="w-full h-full flex flex-col py-2">
										<p className="text-center text-neutral-200 mt-2 text-xl max-w-xl mx-4 truncate">
											{currentModel ? currentModel.name : "No model selected"}
										</p>
										<div className="w-full h-full gap-2">
											<div className="flex justify-between items-center my-auto h-full gap-2 p-4">
												<button
													type="button"
													className="bg-white/10 hover:bg-white/20 disabled:hover:bg-white/10 slow disabled:opacity-60 border border-white/10 p-2 rounded-full z-50"
													onClick={prevModel}
													disabled={currentIndex === 0}
												>
													<svg
														className="w-6 h-6 max-md:w-3 max-md:h-3 opacity-60"
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
												{currentModel && (
													<ul className="noise rounded-xl gap-1 flex flex-col w-full text-center mx-4">
														<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/20 px-4 py-1 rounded-xl">
															{currentModel ? currentModel.epochs : "Undefined"}{" "}
															epochs
														</li>
														<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/20 px-4 py-1 rounded-xl">
															{currentModel
																? currentModel.algorithm
																: "Undefined algorithm"}
														</li>
														<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/20 px-4 py-1 rounded-xl">
															{currentModel
																? currentModel.author
																: "Undefined author"}
														</li>
														<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/20 px-4 py-1 rounded-xl">
															{currentModel
																? currentModel.from
																: "Undefined server"}
														</li>
													</ul>
												)}
												<button
													type="button"
													className="bg-white/10 hover:bg-white/20 disabled:hover:bg-white/10 disabled:opacity-60 slow border border-white/10 p-2 rounded-full z-50"
													onClick={nextModel}
													disabled={currentIndex === models.length - 1}
												>
													<svg
														className="w-6 h-6 max-md:w-3 max-md:h-3 opacity-60"
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
										</div>
										<p className="text-center text-neutral-300 text-xs z-50">
											Download more models{" "}
											<Link to="/models" className="text-white hover:underline">
												here
											</Link>
											.
										</p>
									</div>
								</div>
								<div className="relative border border-white/20 h-full w-full rounded-xl p-4 bg-[#111111]/10 enabled:hover:bg-[#111111]/50 disabled:hover:bg-[#111111]/10 slow flex flex-col gap-2 justify-center items-center">
									<div
										className="absolute w-full h-full rounded-xl backdrop-blur-3xl backdrop-filter noise opacity-40"
										style={{
											background: "linear-gradient(#111111A3 100%, #00AA68)",
										}}
									/>
									{uploaded ? (
										<svg
											className="w-16 h-16 opacity-60"
											viewBox="0 0 24 24"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
										>
											<g id="SVGRepo_bgCarrier" strokeWidth="0" />
											<g
												id="SVGRepo_tracerCarrier"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
											<g id="SVGRepo_iconCarrier">
												<g id="Interface / Check">
													<path
														id="Vector"
														d="M6 12L10.2426 16.2426L18.727 7.75732"
														stroke="#ffffff"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</g>
											</g>
										</svg>
									) : (
										<svg
											className="w-16 h-16 opacity-80 z-50"
											viewBox="0 0 24 24"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											aria-hidden="true"
										>
											<g id="SVGRepo_bgCarrier" strokeWidth="0" />
											<g
												id="SVGRepo_tracerCarrier"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
											<g id="SVGRepo_iconCarrier">
												<path
													d="M22 20.8201C15.426 22.392 8.574 22.392 2 20.8201"
													stroke="#ffffff"
													strokeWidth="1.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
												<path
													d="M12.0508 16V2"
													stroke="#ffffff"
													strokeWidth="1.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
												<path
													d="M7.09961 6.21997L10.6096 2.60986C10.7895 2.42449 11.0048 2.27715 11.2427 2.17651C11.4806 2.07588 11.7363 2.02417 11.9946 2.02417C12.2529 2.02417 12.5086 2.07588 12.7465 2.17651C12.9844 2.27715 13.1997 2.42449 13.3796 2.60986L16.8996 6.21997"
													stroke="#ffffff"
													strokeWidth="1.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											</g>
										</svg>
									)}
									<p className="text-sm text-neutral-300 z-50 truncate max-w-3xl">
										{file ? file.name : "Select your audio."}
									</p>
									<input
										disabled={uploaded}
										type="file"
										accept="audio/*"
										className="absolute inset-0 opacity-0 z-40 enabled:cursor-pointer"
										onChange={handleFileChange}
									/>
								</div>
								{file && !uploaded && (
									<button
										type="button"
										onClick={handleUpload}
										disabled={uploaded}
										className="w-full border border-white/20 rounded-xl py-2 h-full enabled:hover:bg-[#111111]/20 slow disabled:opacity-50"
									>
										Upload
									</button>
								)}
								{uploaded || status.includes("successfully") ? (
									<button
										type="button"
										onClick={handleReset}
										className="w-full border border-white/20 rounded-xl py-2 h-full enabled:hover:bg-[#111111]/20 slow disabled:opacity-50"
									>
										Reset
									</button>
								) : null}
							</div>
							<div className="w-full h-full grid grid-cols-1 grid-rows-12 gap-2">
								<div className="row-span-full w-full h-full border border-white/20 rounded-xl p-4 flex flex-col gap-6 max-h-full overflow-auto">
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Pitch
										</h2>
										<div className="flex gap-2 justify-center items-center">
											<p className="text-sm text-neutral-200">{pitch}</p>
											<input
												value={pitch}
												onChange={(e) => setPitch(Number(e.target.value))}
												type="range"
												defaultValue="0"
												min="0"
												max="10"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Set the pitch of the audio. Higher values result in a
											higher pitch.
										</p>
									</div>
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Index Rate
										</h2>
										<div className="flex gap-2 justify-center items-center">
											<p className="text-sm text-neutral-200">{indexRate}</p>
											<input
												value={indexRate}
												onChange={(e) => setIndexRate(Number(e.target.value))}
												type="range"
												defaultValue="0.3"
												min="0"
												max="1"
												step="0.1"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Control the influence of the index file on the output.
											Higher values mean stronger influence. Lower values can
											help reduce artifacts but may result in less accurate
											voice cloning.
										</p>
									</div>
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Filter Radius
										</h2>
										<div className="flex gap-2 justify-center items-center">
											<p className="text-sm text-neutral-200">{filterRadius}</p>
											<input
												value={filterRadius}
												onChange={(e) =>
													setFilterRadius(Number(e.target.value))
												}
												type="range"
												defaultValue="3"
												min="0"
												max="6"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Apply median filtering to the extracted pitch values if
											this value is greater than or equal to three. This can
											help reduce breathiness in the output audio.
										</p>
									</div>
									<div className="flex flex-col mt-8">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Autotune
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<input
														checked={autotune}
														onChange={(e) => setAutotune(e.target.checked)}
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
										</div>
										<p className="text-xs text-neutral-300">
											Apply a light autotune to the inferred audio. Particularly
											useful for singing voice conversions.
										</p>
									</div>
									<div className="flex flex-col">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Clean audio
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<input
														checked={cleanAudio}
														onChange={(e) => setCleanAudio(e.target.checked)}
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
										</div>
										<p className="text-xs text-neutral-300">
											Clean the output audio using noise reduction algorithms.
											Recommended for speech conversions.
										</p>
									</div>
									<div className="flex flex-col">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Export format
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<select
														defaultValue={exportFormat}
														onChange={(e) => setExportFormat(e.target.value)}
														className="h-8 w-fit flex items-center justify-center text-end px-4 cursor-pointer transition-all appearance-none rounded-lg shadow-sm hover:shadow-md border border-slate-300 bg-white text-slate-700 focus:outline-none focus:border-slate-400"
													>
														<option value="WAV">WAV</option>
														<option value="MP3">MP3</option>
													</select>
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
										</div>
										<p className="text-xs text-neutral-300">
											Select the desired output audio format.
										</p>
									</div>
								</div>
								{(status || info) && (
									<div
										className={`min-h-fit w-full h-full border border-white/20 rounded-xl p-4 flex justify-between items-center ${error ? "bg-red-500/10" : ""}`}
									>
										<div>
											<p className="font-medium">{info}</p>
											{!status.includes("completed") && (
												<p className="text-sm text-neutral-300 max-w-3xl truncate">
													{status}
												</p>
											)}
											{error && (
												<p className="text-neutral-400 text-xs mt-1">
													Maybe you have done something wrong?{" "}
													<button
														className="text-neutral-300 hover:underline"
														type="button"
														onClick={openDocs}
													>
														Check the docs
													</button>
													.
												</p>
											)}
										</div>
										<div className="justify-start mb-auto flex">
											<p className="text-sm text-neutral-400">
												{convertTime || 0}s
											</p>
										</div>
									</div>
								)}
								{info.includes("completed!") && output && (
									<div className="w-full h-[10svh] flex gap-2">
										<div className="w-full border border-white/20 rounded-xl pl-4 h-18 flex justify-between items-center gap-4">
											<div className="flex justify-start items-center">
												<button
													type="button"
													className="w-full h-full"
													onClick={togglePlayPause}
												>
													{isPlaying ? (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z"
																clipRule="evenodd"
															/>
														</svg>
													) : (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
																clipRule="evenodd"
															/>
														</svg>
													)}
												</button>
											</div>
											<div className="w-full flex items-center gap-4">
												<div className="relative w-full h-[10svh] rounded-r-xl bg-white/10 overflow-hidden">
													<div
														className="absolute top-0 left-0 h-full bg-white transition-all duration-300 ease-in-out"
														style={{ width: `${progress}%` }}
													/>
												</div>
											</div>
											<audio
												ref={audioRef}
												className="hidden"
												onPlay={() => setIsPlaying(true)}
												onPause={() => setIsPlaying(false)}
											>
												<source src={output} type="audio/wav" />
											</audio>
										</div>
										{convertedAudio && (
											<div className="flex flex-col gap-2 h-full">
												<button
													className="border border-white/20 px-5 rounded-lg w-fit h-full flex items-center justify-center"
													type="button"
													onClick={() => downloadAudio(convertedAudio)}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														viewBox="0 0 24 24"
														fill="none"
														stroke="#ffffff"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
														className="w-6 h-6" 
														aria-hidden="true"
													>
														<path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
													</svg>
												</button>
											</div>
										)}
									</div>
								)}
								<div className="relative group">
									{!uploaded && (
										<p className="absolute left-0 right-0 bottom-full mb-4 text-xs text-red-400 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
											First upload your audio!
										</p>
									)}
									<button
										className="min-h-12 w-full bg-white disabled:opacity-60 text-black rounded-xl h-full enabled:hover:bg-white/80 slow"
										type="button"
										disabled={!!status || !uploaded}
										onClick={convert}
									>
										Convert
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}

export default App;
