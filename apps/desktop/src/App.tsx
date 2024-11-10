import "./App.css";
import { useEffect, useState } from "react";
import { platform, type, version } from "@tauri-apps/plugin-os";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { isFirstRun, setNotFirstRun } from "./scripts/isFirstTime";
import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Header from "./components/layout/header";
import { TitleBar } from "./components/layout/titlebar";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { ConvertProvider } from "./components/convert/conversion-context";
import { open } from "@tauri-apps/plugin-shell";
import { supabase } from "./utils/database";
import { cancel, onUrl, start } from "@fabianlars/tauri-plugin-oauth";


// Pages
import Home from "./pages/home";
import FirstTime from "./pages/install/first-time";
import DownloadPretraineds from "./pages/install/pretraineds";
import Models from "./pages/models/models";
import Settings from "./pages/settings/settings";
import Convert from "./pages/inference/convert";
import Login from "./pages/login/login";
import React from "react";

function App() {
	const [updateAvailable, setUpdateAvailable] = useState(false);

	const navigate = useNavigate();
	const location = useLocation();

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		return port;
	}

	// check if dev mode
	async function checkIfDev() {
		const isDev = await invoke("is_dev");
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
	
	// check if user has access to beta
	const checkBetaAccess = async () => {
		if (window.location.pathname !== "/beta-access") {
		const session = await supabase?.auth.getSession();
		if (session && session.data.session) {
			const { data, error } = await supabase?.from("profiles").select("*").eq("auth_id", session.data.session.user.id).single() || { data: null, error: null };
			if (data || data.tester) {
				console.log("Beta access granted");
			} else {
				console.log("Beta access not granted");
				window.location.href = "/beta-access";
			}
		} else {
			if (window.location.pathname !== '/login') {
				navigate('/login')
			}
		}
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
			checkRVC();
			checkUpdates();
		}
	}, []);

	// set window effect, check if rvc exists and check for rvc updates
	useEffect(() => {
		setWindowEffect();
		checkBetaAccess();
	}, []);

	const shouldShowHeader = !(
		location.pathname === "/first-time" ||
		location.pathname === "/pretraineds" ||
		location.pathname === "/os-not-supported" ||
		location.pathname === "/beta-access" ||
		location.pathname === "/login"
	  );

	return (
		<ConvertProvider>
			<React.StrictMode>
				{updateAvailable && location.pathname !== "/first-time" && (
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
					{shouldShowHeader && <Header  />}
					<Routes>
						<Route index path="/" element={<Home />} />
						<Route path="*" element={<NotFound />} />
						<Route path="/first-time" element={<FirstTime />} />
						<Route path="/models" element={<Models />} />
						<Route path="/settings" element={<Settings />} />
						<Route path="/convert" element={<Convert />} />
						<Route path="/pretraineds" element={<DownloadPretraineds />} />
						<Route path="/os-not-supported" element={<OSNotSupported />} />
						<Route path="/beta-access" element={<BetaAccess />} />
						<Route path="/login" element={<Login />} />
					</Routes>
				</div>
				</React.StrictMode>
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

function BetaAccess() {
	return (
		<div className="absolute inset-0 bg-black">
		<div className="flex flex-col gap-2 justify-center items-center w-screen h-screen"> 
		<p className="text-3xl font-semibold title">Applio is still in development</p>
		<p className="text-sm max-w-sm text-center text-neutral-300">Interested in trying it out? Join our <a onClick={() => open('https://applio.org/products/app')} className="cursor-pointer underline text-neutral-200 hover:text-white slow">waitlist</a> to receive an invitation and be among the first to explore Applio.</p>
		<p className="text-sm max-w-sm text-center text-neutral-300">If you're already a beta tester, please contact us at <a href="mailto:contact@applio.app" className="cursor-pointer underline text-neutral-200 hover:text-white slow">contact@applio.app</a> for access.</p>
		</div>
		</div>
	)
}

export default App;
