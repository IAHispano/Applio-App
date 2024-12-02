import type { Provider } from "@supabase/supabase-js";
import {
	DiscordIcon,
	GitHubIcon,
	GoogleIcon,
} from "../../components/layout/header";
import { supabase } from "../../utils/database";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { cancel, onUrl, start } from "@fabianlars/tauri-plugin-oauth";
import { useNavigate } from "react-router-dom";

export default function Login() {
	const [authPort, setAuthPort] = useState<number | undefined>();
	const navigate = useNavigate();

	useEffect(() => {
		startOAuthServer();
	}, []);

	async function stopOAuthServer(port: number) {
		try {
			await cancel(port);
			console.log("OAuth server stopped");
		} catch (error) {
			console.error("Error stopping OAuth server:", error);
		}
	}

	async function startOAuthServer() {
		if (authPort) return;

		try {
			const port = await start({
				response:
					"You can now close this window and return to the application.",
			});
			console.log(`OAuth server started on port ${port}`);
			if (port) {
				setAuthPort(port);
			}

			await onUrl((url) => {
				console.log("Received OAuth URL:", url);
				setSessionData(url);
			});

			return port;
		} catch (error) {
			console.error("Error starting OAuth server:", error);
		}
	}

	async function setSessionData(url: string) {
		stopOAuthServer(authPort as number);
		supabase?.auth
			.setSession({
				access_token: url.split("access_token=")[1].split("&")[0],
				refresh_token: url.split("refresh_token=")[1].split("&")[0],
			})
			.then(({ data, error }) => {
				if (error) {
					console.error("Error setting session:", error);
					return;
				}
				if (data) {
					window.location.reload();
				}
			});
	}

	const handleLogin = async (provider: string) => {
		if (provider && authPort) {
			const response = await supabase?.auth.signInWithOAuth({
				provider: provider as Provider,
				options: {
					skipBrowserRedirect: true,
					redirectTo: `http://localhost:${authPort}`,
				},
			});
			if (response?.data?.url) {
				open(response.data.url);
			} else if (response?.error) {
				alert(response.error.message);
			} else {
				console.error("Unexpected response:", response);
				alert(`An unexpected error occurred: ${response}`);
			}
		} else {
			alert("Error: Login not found, please try again.");
		}
	};

	useEffect(() => {
		async function getUser() {
			const user = await supabase?.auth.getSession();
			if (user?.data.session) {
				navigate("/");
			}
		}

		getUser();
	}, []);

	return (
		<div className="w-screen h-screen flex flex-col justify-center items-center bg-gradient-to-br from-neutral-800 to-neutral-900 text-white">
			<div className="flex flex-col p-4 sm:p-16 md:p-24 max-w-4xl text-center">
				<h1 className="text-5xl font-bold mb-6 title">Welcome to Applio App</h1>
				<h2 className="text-neutral-300 max-w-xl mx-auto mb-12">
					Applio App is currently in beta testing. Please log in to check your
					invitation status and access the platform.
				</h2>
				<div className="max-w-3xl mx-auto flex flex-col gap-6">
					<p className="text-sm text-neutral-400">Sign in with:</p>
					<div className="w-full grid grid-cols-3 gap-4">
						<button
							aria-label="Login with GitHub"
							type="button"
							className="flex flex-row items-center justify-center gap-2 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg shadow-xs transition duration-200"
							onClick={() => handleLogin("github")}
						>
							<GitHubIcon />
							<span className="text-sm">GitHub</span>
						</button>
						<button
							aria-label="Login with Discord"
							type="button"
							className="min-w-[150px] flex flex-row items-center justify-center gap-2 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg shadow-xs transition duration-200"
							onClick={() => handleLogin("discord")}
						>
							<DiscordIcon />
							<span className="text-sm">Discord</span>
						</button>
						<button
							aria-label="Login with Google"
							type="button"
							className="flex flex-row items-center justify-center gap-2 p-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg shadow-xs transition duration-200"
							onClick={() => handleLogin("google")}
						>
							<GoogleIcon />
							<span className="text-sm">Google</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
