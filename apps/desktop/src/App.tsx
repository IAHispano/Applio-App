import "./App.css";
import { useEffect } from "react";
import { platform, type, version } from "@tauri-apps/plugin-os";
import {
	CloseRequestedEvent,
	Effect,
	getCurrentWindow,
} from "@tauri-apps/api/window";
import { isFirstRun, setNotFirstRun } from "./scripts/isFirstTime";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Header from "./components/layout/header";
import { TitleBar } from "./components/layout/titlebar";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { ConvertProvider } from "./components/convert/conversion-context";
import { supabase } from "./utils/database";

// Pages
import Home from "./pages/home";
import FirstTime from "./pages/install/first-time";
import DownloadPretraineds from "./pages/install/pretraineds";
import Models from "./pages/models/models";
import Settings from "./pages/settings/settings";
import Convert from "./pages/inference/convert";
import Login from "./pages/login/login";
import InferencesLibrary from "./pages/inference/library";
import { open } from "@tauri-apps/plugin-shell";

function App() {
	const navigate = useNavigate();
	const location = useLocation();
	const { pathname } = location;

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
		const match = rgba.match(
			/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\d+(?:\.\d+)?)\)$/,
		);
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
			await store.set(
				"backgroundColor",
				`rgba(42, 43, 42, ${effect ? 0.5 : 1})`,
			);
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
		const port = await getServerPort();
		const eventSource = new EventSource(
			`http://localhost:${port}/check-update`,
		);
		eventSource.onmessage = (event) => {
			console.log(event.data);
			if (event.data.includes("up to date")) {
				localStorage.removeItem("update");
				eventSource.close();
			} else {
				localStorage.setItem("update", "true");
				eventSource.close();
			}

			if (event.data.includes("rate limit")) {
				localStorage.setItem("update", "false");
				eventSource.close();
			}
		};
		return () => {
			eventSource.close();
		};
	};

	// check if rvc is installed
	const checkRVC = async () => {
		localStorage.removeItem("update");
		const port = await getServerPort();
		const response = await fetch(`http://localhost:${port}/check-rvc`);
		const data = await response.json();
		console.log(data);
		if (data.exists === "False") {
			localStorage.setItem("update", "true");
		} else {
			localStorage.removeItem("update");
		}
	};

	// check if user has access to beta
	const checkBetaAccess = async () => {
		if (window.location.pathname !== "/beta-access") {
			const session = await supabase?.auth.getSession();
			if (session && session.data.session) {
				const { data } = (await supabase
					?.from("profiles")
					.select("*")
					.eq("auth_id", session.data.session.user.id)
					.single()) || { data: null, error: null };
				if (data && data.tester === true) {
					console.log("Beta access granted");
				} else {
					console.log("Beta access not granted");
					window.location.href = "/beta-access";
				}
			} else {
				if (
					window.location.pathname !== "/login" &&
					window.location.pathname !== "/first-time" &&
					window.location.pathname !== "/pretraineds"
				) {
					navigate("/login");
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
		const handleCloseRequested = async (event: React.MouseEvent) => {
			event.preventDefault();
			const port = await getServerPort();
			try {
				const response = await fetch(`http://localhost:${port}/stop`);
				localStorage.removeItem("appInitialized");

				if (!response.ok) {
					console.error("Failed to stop server, please report on GitHub");
					alert("Error, please report on GitHub");
					getCurrentWindow().destroy();
				} else {
					console.log("Server shutting down...");
					getCurrentWindow().destroy();
				}
			} catch (error) {
				getCurrentWindow().destroy();
			}
		};

		const currentWindow = getCurrentWindow();

		const unlisten = currentWindow.onCloseRequested(
			(event: CloseRequestedEvent) => {
				handleCloseRequested(event as unknown as React.MouseEvent);
			},
		);

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
	}, [pathname]);

	const shouldShowHeader = !(
		location.pathname === "/first-time" ||
		location.pathname === "/pretraineds" ||
		location.pathname === "/os-not-supported" ||
		location.pathname === "/beta-access" ||
		location.pathname === "/login"
	);

	return (
		<ConvertProvider>
			<TitleBar />
			<div className="flex w-screen h-screen gap-0">
				{shouldShowHeader && <Header />}
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
					<Route path="/inferences" element={<InferencesLibrary />} />
				</Routes>
			</div>
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

	const handleLogout = async () => {
		await supabase?.auth.signOut();
		window.location.href = "/";
	};

	return (
		<section className="absolute inset-0 bg-black flex flex-col gap-4 justify-center items-center w-screen h-screen">
			<h1 className="text-3xl font-semibold title text-center text-white">
				Applio is still in development
			</h1>
			<p className="text-sm max-w-sm text-pretty text-center text-neutral-300">
				Interested in trying it out? Join our{" "}
				<a
					aria-label="Open our waitlist for request access"
					onClick={() => open("https://applio.org/products/app")}
					rel="noopener noreferrer"
					className="cursor-pointer underline text-neutral-200 hover:text-white transition-all"
				>
					waitlist
				</a>{" "}
				to receive an invitation or join at{" "}
				<a
					aria-label="Open our Supporters page for instant access"
					onClick={() => open("https://ko-fi.com/iahispano/tiers")}
					rel="noopener noreferrer"
					className="underline text-neutral-200 cursor-pointer hover:text-white transition-all"
				>
					our Supporters
				</a>{" "}
				for instant access.
			</p>
			<p className="text-sm max-w-sm text-balance text-center text-neutral-300">
				If you're already a beta tester, please contact us at{" "}
				<a
					aria-label="Open our Discord for request access"
					onClick={() => open("https://applio.org/discord")}
					rel="noopener noreferrer"
					className="cursor-pointer underline text-neutral-200 hover:text-white transition-all"
				>
					our Discord
				</a>{" "}
				for access.
			</p>

			<button type="button" aria-label="Logout from your Applio Account" className="mt-4 text-xs text-neutral-400 px-4 py-2 rounded-xl border border-white/10 hover:text-neutral-300 slow" onClick={handleLogout}>Logout</button>
		</section>
	);
}

export default App;
