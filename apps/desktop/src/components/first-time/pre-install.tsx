import { useEffect, useState } from "react";
import Background1 from "../svg/background1";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";

export default function PreInstall() {
	const [status, setStatus] = useState("Initializing...");
	const [info, setInfo] = useState("Preparing to download...");

	const navigate = useNavigate();

	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("Server port:", port);
		return port;
	}

	useEffect(() => {
		const fetchData = async () => {
			try {
				const port = await getServerPort();
				const eventSource = new EventSource(
					`http://localhost:${port}/pre-install`,
				);

				eventSource.onmessage = (event) => {
					console.log("Event Data:", event.data);
					setStatus(event.data);

					if (event.data.includes("RVC repository downloaded successfully.")) {
						setInfo("Installing components...");
						setStatus("Installation in progress. Please wait...");
					}

					if (event.data.includes("already exists")) {
						setInfo("The latest version is already installed. Redirecting...");
						setStatus("Installation complete.");
						navigate("/");
					}

					if (event.data.includes("Installing collected packages:")) {
						setInfo(
							"This process may take a few moments. Thank you for waiting.",
						);
					}

					if (
						event.data.includes(
							"RVC repository is up to date. No need to download.",
						)
					) {
						eventSource.close();
						setStatus("You are already on the latest version.");
						setInfo("No updates are needed at this time.");
					}

					if (event.data.includes("RVC CLI has been installed successfully")) {
						setInfo("Finalizing installation...");
						setStatus("Installation is almost done. Please hold on...");
						navigate("/pretraineds");
						eventSource.close();
					}
				};

				eventSource.onerror = (err) => {
					if (info !== "Error during extraction.") {
						console.error("EventSource Error:", err);
						console.error("Error target:", err.target);
						eventSource.close();
						setStatus("");
						setInfo("An unexpected error occurred. Please try again later.");
					} else {
						setInfo(
							"An error was detected. If the installation proceeds, it can be ignored.",
						);
					}
				};

				// Clean up
				return () => {
					eventSource.close();
				};
			} catch (error) {
				console.error("Failed to initialize installation:", error);
				setInfo("Unable to start the installation process. Please try again.");
			}
		};

		fetchData();
	}, []);

	return (
		<section className="absolute inset-0 z-50">
			<div className="w-screen h-screen absolute inset-0 bg-[#111111] pointer-events-none">
				<Background1 />
			</div>
			<div className="absolute inset-0 mt-auto flex z-50">
				<div className="z-50 flex flex-col w-full justify-center items-center mx-auto">
					<h1 className="font-bold text-4xl lg:text-5xl xl:text-6xl title">
						Applio App
					</h1>
					<p className="text-white/80 text-sm mt-1">
						We are setting up the necessary files to complete your installation.
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
						{info.includes("No updates are needed at this time.") && (
							<a
								href="/"
								className="text-sm rounded-xl px-4 py-1 mt-4 bg-white text-black border border-white/10"
							>
								Return to Home
							</a>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}
