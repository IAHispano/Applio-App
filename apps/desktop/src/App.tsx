import "./App.css";
import { useEffect, useState } from "react";
import { platform, type, version } from "@tauri-apps/plugin-os";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { isFirstRun, setNotFirstRun } from "./scripts/isFirstTime";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./components/layout/header";
import { TitleBar } from "./components/layout/titlebar";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { ConvertProvider } from "./components/convert/conversion-context";

// Pages
import Home from "./pages/home";
import FirstTime from "./pages/install/first-time";
import DownloadPretraineds from "./pages/install/pretraineds";
import Models from "./pages/models/models";
import Settings from "./pages/settings/settings";
import Convert from "./pages/inference/convert";

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

	// convert rgba to rgb
	const RGBAtoRGB = (rgba: string) => {
		const match = rgba.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\d+(?:\.\d+)?)\)$/);
		if (match) {
			return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
		}
		return rgba;
	};

	// set window acrylic effect
	async function setWindowEffect() {
		const currentPlatform = await platform();
		const osVersion = await version();
		const store = await Store.load("settings.json");
		const background = await store.get("backgroundColor");
		const effect = await store.get("effect");

		if (!background) {
			await store.set("backgroundColor", `rgba(42, 43, 42, ${effect ? 0.5 : 1})`);
			await store.save();
		}

		if (background) {
			if (currentPlatform === "windows") {
				if (osVersion >= "10.0.22000.0") {
					document.documentElement.style.background = "transparent";
					document.documentElement.style.backgroundColor =
						background as unknown as string;
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

	// check if rvc is installed
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

	// set window effect, check if rvc exists and check for rvc updates
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
						className="hover:bg-black/20 slow absolute left-4 top-2 w-fit p-2 px-4 shadow-lg shadow-green-500/10 h-fit border border-white/20 rounded-xl"
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

function NotFound() {
	return (
		<div className="w-screen h-screen flex justify-center items-center">
			<h1 className="text-center text-xl font-bold title">Not Found :(</h1>
		</div>
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

export default App;
