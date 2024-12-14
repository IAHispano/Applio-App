import type { Provider } from "@supabase/supabase-js";
import { supabase } from "../../utils/database";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { cancel, onUrl, start } from "@fabianlars/tauri-plugin-oauth";
import { useNavigate } from "react-router-dom";

export const GitHubIcon = () => {
	return (
		<svg
			className="w-4 h-4"
			aria-hidden="true"
			viewBox="0 -3.5 256 256"
			xmlns="http://www.w3.org/2000/svg"
			preserveAspectRatio="xMinYMin meet"
			fill="#000000"
		>
			<g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
			<g
				id="SVGRepo_tracerCarrier"
				strokeLinecap="round"
				strokeLinejoin="round"
			></g>
			<g id="SVGRepo_iconCarrier">
				{" "}
				<g fill="#f5f5f5">
					{" "}
					<path d="M127.505 0C57.095 0 0 57.085 0 127.505c0 56.336 36.534 104.13 87.196 120.99 6.372 1.18 8.712-2.766 8.712-6.134 0-3.04-.119-13.085-.173-23.739-35.473 7.713-42.958-15.044-42.958-15.044-5.8-14.738-14.157-18.656-14.157-18.656-11.568-7.914.872-7.752.872-7.752 12.804.9 19.546 13.14 19.546 13.14 11.372 19.493 29.828 13.857 37.104 10.6 1.144-8.242 4.449-13.866 8.095-17.05-28.32-3.225-58.092-14.158-58.092-63.014 0-13.92 4.981-25.295 13.138-34.224-1.324-3.212-5.688-16.18 1.235-33.743 0 0 10.707-3.427 35.073 13.07 10.17-2.826 21.078-4.242 31.914-4.29 10.836.048 21.752 1.464 31.942 4.29 24.337-16.497 35.029-13.07 35.029-13.07 6.94 17.563 2.574 30.531 1.25 33.743 8.175 8.929 13.122 20.303 13.122 34.224 0 48.972-29.828 59.756-58.22 62.912 4.573 3.957 8.648 11.717 8.648 23.612 0 17.06-.148 30.791-.148 34.991 0 3.393 2.295 7.369 8.759 6.117 50.634-16.879 87.122-64.656 87.122-120.973C255.009 57.085 197.922 0 127.505 0"></path>{" "}
					<path d="M47.755 181.634c-.28.633-1.278.823-2.185.389-.925-.416-1.445-1.28-1.145-1.916.275-.652 1.273-.834 2.196-.396.927.415 1.455 1.287 1.134 1.923M54.027 187.23c-.608.564-1.797.302-2.604-.589-.834-.889-.99-2.077-.373-2.65.627-.563 1.78-.3 2.616.59.834.899.996 2.08.36 2.65M58.33 194.39c-.782.543-2.06.034-2.849-1.1-.781-1.133-.781-2.493.017-3.038.792-.545 2.05-.055 2.85 1.07.78 1.153.78 2.513-.019 3.069M65.606 202.683c-.699.77-2.187.564-3.277-.488-1.114-1.028-1.425-2.487-.724-3.258.707-.772 2.204-.555 3.302.488 1.107 1.026 1.445 2.496.7 3.258M75.01 205.483c-.307.998-1.741 1.452-3.185 1.028-1.442-.437-2.386-1.607-2.095-2.616.3-1.005 1.74-1.478 3.195-1.024 1.44.435 2.386 1.596 2.086 2.612M85.714 206.67c.036 1.052-1.189 1.924-2.705 1.943-1.525.033-2.758-.818-2.774-1.852 0-1.062 1.197-1.926 2.721-1.951 1.516-.03 2.758.815 2.758 1.86M96.228 206.267c.182 1.026-.872 2.08-2.377 2.36-1.48.27-2.85-.363-3.039-1.38-.184-1.052.89-2.105 2.367-2.378 1.508-.262 2.857.355 3.049 1.398"></path>{" "}
				</g>{" "}
			</g>
		</svg>
	);
};

export const DiscordIcon = () => {
	return (
		<svg
			className="w-4 h-4"
			fill="#ffffff"
			viewBox="0 0 32 32"
			version="1.1"
			xmlns="http://www.w3.org/2000/svg"
		>
			<g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
			<g
				id="SVGRepo_tracerCarrier"
				strokeLinecap="round"
				strokeLinejoin="round"
			></g>
			<g id="SVGRepo_iconCarrier">
				{" "}
				<title>discord</title>{" "}
				<path d="M20.992 20.163c-1.511-0.099-2.699-1.349-2.699-2.877 0-0.051 0.001-0.102 0.004-0.153l-0 0.007c-0.003-0.048-0.005-0.104-0.005-0.161 0-1.525 1.19-2.771 2.692-2.862l0.008-0c1.509 0.082 2.701 1.325 2.701 2.847 0 0.062-0.002 0.123-0.006 0.184l0-0.008c0.003 0.050 0.005 0.109 0.005 0.168 0 1.523-1.191 2.768-2.693 2.854l-0.008 0zM11.026 20.163c-1.511-0.099-2.699-1.349-2.699-2.877 0-0.051 0.001-0.102 0.004-0.153l-0 0.007c-0.003-0.048-0.005-0.104-0.005-0.161 0-1.525 1.19-2.771 2.692-2.862l0.008-0c1.509 0.082 2.701 1.325 2.701 2.847 0 0.062-0.002 0.123-0.006 0.184l0-0.008c0.003 0.048 0.005 0.104 0.005 0.161 0 1.525-1.19 2.771-2.692 2.862l-0.008 0zM26.393 6.465c-1.763-0.832-3.811-1.49-5.955-1.871l-0.149-0.022c-0.005-0.001-0.011-0.002-0.017-0.002-0.035 0-0.065 0.019-0.081 0.047l-0 0c-0.234 0.411-0.488 0.924-0.717 1.45l-0.043 0.111c-1.030-0.165-2.218-0.259-3.428-0.259s-2.398 0.094-3.557 0.275l0.129-0.017c-0.27-0.63-0.528-1.142-0.813-1.638l0.041 0.077c-0.017-0.029-0.048-0.047-0.083-0.047-0.005 0-0.011 0-0.016 0.001l0.001-0c-2.293 0.403-4.342 1.060-6.256 1.957l0.151-0.064c-0.017 0.007-0.031 0.019-0.040 0.034l-0 0c-2.854 4.041-4.562 9.069-4.562 14.496 0 0.907 0.048 1.802 0.141 2.684l-0.009-0.11c0.003 0.029 0.018 0.053 0.039 0.070l0 0c2.14 1.601 4.628 2.891 7.313 3.738l0.176 0.048c0.008 0.003 0.018 0.004 0.028 0.004 0.032 0 0.060-0.015 0.077-0.038l0-0c0.535-0.72 1.044-1.536 1.485-2.392l0.047-0.1c0.006-0.012 0.010-0.027 0.010-0.043 0-0.041-0.026-0.075-0.062-0.089l-0.001-0c-0.912-0.352-1.683-0.727-2.417-1.157l0.077 0.042c-0.029-0.017-0.048-0.048-0.048-0.083 0-0.031 0.015-0.059 0.038-0.076l0-0c0.157-0.118 0.315-0.24 0.465-0.364 0.016-0.013 0.037-0.021 0.059-0.021 0.014 0 0.027 0.003 0.038 0.008l-0.001-0c2.208 1.061 4.8 1.681 7.536 1.681s5.329-0.62 7.643-1.727l-0.107 0.046c0.012-0.006 0.025-0.009 0.040-0.009 0.022 0 0.043 0.008 0.059 0.021l-0-0c0.15 0.124 0.307 0.248 0.466 0.365 0.023 0.018 0.038 0.046 0.038 0.077 0 0.035-0.019 0.065-0.046 0.082l-0 0c-0.661 0.395-1.432 0.769-2.235 1.078l-0.105 0.036c-0.036 0.014-0.062 0.049-0.062 0.089 0 0.016 0.004 0.031 0.011 0.044l-0-0.001c0.501 0.96 1.009 1.775 1.571 2.548l-0.040-0.057c0.017 0.024 0.046 0.040 0.077 0.040 0.010 0 0.020-0.002 0.029-0.004l-0.001 0c2.865-0.892 5.358-2.182 7.566-3.832l-0.065 0.047c0.022-0.016 0.036-0.041 0.039-0.069l0-0c0.087-0.784 0.136-1.694 0.136-2.615 0-5.415-1.712-10.43-4.623-14.534l0.052 0.078c-0.008-0.016-0.022-0.029-0.038-0.036l-0-0z"></path>{" "}
			</g>
		</svg>
	);
};

export const GoogleIcon = () => {
	return (
		<svg
			className="w-4 h-4"
			width="256"
			height="262"
			viewBox="0 0 256 262"
			xmlns="http://www.w3.org/2000/svg"
			preserveAspectRatio="xMidYMid"
		>
			<path
				d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
				fill="#FFFFFF"
			/>
			<path
				d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
				fill="#FFFFFF"
			/>
			<path
				d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"
				fill="#FFFFFF"
			/>
			<path
				d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
				fill="#FFFFFF"
			/>
		</svg>
	);
};

export default function Login() {
	const [authPort, setAuthPort] = useState<number | undefined>();
	const [isLogging, setIsLogging] = useState(false);
	const [authUrl, setAuthUrl] = useState("");
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
		setIsLogging(true);
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
				setAuthUrl(response.data.url);
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
			{isLogging && (
				<div className="absolute w-screen h-screen flex flex-col justify-center items-center bg-neutral-900 text-white">
					<div className="flex gap-4 flex-col border border-white/10 p-8 rounded-xl h-fit w-full max-w-sm text-left">
					<h2 className="title text-neutral-200 text-2xl font-semibold">Sing in on your browser to continue</h2>
					<p className="text-sm text-neutral-400">If your browser does not open automatically, <button className="text-neutral-300 hover:text-neutral-200 slow hover:underline" onClick={() => window.navigator.clipboard.writeText(authUrl)}>copy the URL</button> and open the page manually.</p>
						
					</div>
				</div>
			)}
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
