import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow as getCurrent } from "@tauri-apps/api/window";

const ErrorSection = ({ errorMessage }: { errorMessage: string }) => (
	<motion.div
		initial={{ opacity: 0 }}
		animate={{ opacity: 1 }}
		transition={{ duration: 0.2 }}
		className="h-fit flex flex-col justify-start items-start gap-4 w-full pt-16 px-8"
	>
		<div className="bg-red-700/20 backdrop-filter backdrop-blur-xl border border-white/10 w-full p-6 rounded-lg shadow-lg">
			<h2 className="text-neutral-300 font-semibold text-lg">
				Installation Error
			</h2>
			<p className="text-neutral-400 text-sm mb-4">
				An error occurred during installation. Please follow these steps to
				troubleshoot:
			</p>
			<ul className="text-neutral-300 text-sm space-y-2 mb-4">
				<li className="flex items-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="w-4 h-4 mr-2 text-neutral-400"
					>
						<path d="M12 20h.01" />
						<path d="M2 8.82a15 15 0 0 1 20 0" />
						<path d="M5 12.859a10 10 0 0 1 14 0" />
						<path d="M8.5 16.429a5 5 0 0 1 7 0" />
					</svg>
					Check your internet connection.
				</li>
				<li className="flex items-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="w-4 h-4 mr-2 text-neutral-400"
					>
						<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
					</svg>
					Ensure the installation directory is writable.
				</li>
				<li className="flex items-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="w-4 h-4 mr-2 text-neutral-400"
					>
						<circle cx="12" cy="12" r="10" />
						<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
						<path d="M12 17h.01" />
					</svg>
					If unresolved, retry later or contact support.
				</li>
			</ul>

			<p className="text-neutral-300 font-semibold text-md">Error Details:</p>
			<pre
				className="text-neutral-400 text-sm mb-4 cursor-pointer"
				onClick={() => navigator.clipboard.writeText(errorMessage)}
			>
				{errorMessage}
			</pre>
			<div className="flex justify-end w-full gap-2">
				<a
					onClick={() => open("https://applio.org/discord", "_blank")}
					className="w-fit py-1 bg-[#1c1c1c]/50 border cursor-pointer border-white/10 text-neutral-300 text-sm rounded-xl px-3 hover:bg-[#1c1c1c]/70 transition-all duration-300"
				>
					Contact Support
				</a>
			</div>
		</div>
	</motion.div>
);

const InstallationProgress = ({
	value,
	version,
	isError,
}: {
	value: number;
	version?: string;
	isError: boolean;
}) => (
	<div className="h-fit flex flex-col justify-end items-start gap-2 w-full pb-12 px-10 pt-4">
		<h2 className="text-neutral-200 text-2xl font-semibold title">
			{isError ? "Installation Stopped" : "Installing..."}{" "}
			<span className="text-neutral-400 text-sm font-sans">
				({Math.round(value)}%)
			</span>
		</h2>
		<div className="backdrop-filter backdrop-blur-3xl border border-white/10 w-full mt-2 rounded-lg shadow-lg relative">
			{version && !isError && (
				<p
					className="text-[10px] w-full text-neutral-400 absolute top-[-22px] opacity-0 transition-opacity duration-200"
					style={{ opacity: value > 0 ? 1 : 0 }}
				>
					{version}
				</p>
			)}
			<div
				className={`h-2 rounded-lg ${
					isError ? "bg-red-500/40" : "bg-neutral-300"
				}`}
				style={{ width: isError ? "100%" : `${value}%` }}
			/>
		</div>
	</div>
);

export default function Install() {
	const [value, setValue] = useState<number>(0);
	const [error, setError] = useState<boolean>(false);
	const [success, setSuccess] = useState<boolean>(false);
	const [shouldShortcut, setShouldShortcut] = useState<boolean>(true);
	const [dir, setDir] = useState<string>("");
	const [version, setVersion] = useState<string>("");
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [timeLeft, setTimeLeft] = useState<number>(10);

	useEffect(() => {
		if (success) {
			const interval = setInterval(() => {
				setTimeLeft((prev) => {
					if (prev <= 1) {
						clearInterval(interval);
						getCurrent().close();
					}
					return prev - 1;
				});
			}, 1000);

			return () => clearInterval(interval);
		}
	}, [success]);

	const getLastVersion = async () => {
		const repoUrl = "https://huggingface.co/api/models/iahispano/applio-app";
		const token = import.meta.env.VITE_HF_TOKEN;

		const response = await fetch(repoUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			setError(true);
			setErrorMessage(`Error getting version: ${response.status}`);
			throw new Error(`Error getting version: ${response.status}`);
		}

		const data = await response.json();
		const files = data.siblings;
		const zipFiles = files
			.filter((file: any) => file.rfilename.endsWith(".zip"))
			.map((file: any) => ({
				name: file.rfilename,
				version: file.rfilename.match(/\d+\.\d+\.\d+/)?.[0] || "0.0.0",
			}));

		zipFiles.sort((a: any, b: any) => {
			const parseVersion = (version: string) =>
				version.split(".").map((num) => parseInt(num, 10));
			const [aMajor, aMinor, aPatch] = parseVersion(a.version);
			const [bMajor, bMinor, bPatch] = parseVersion(b.version);

			if (aMajor !== bMajor) return bMajor - aMajor;
			if (aMinor !== bMinor) return bMinor - aMinor;
			return bPatch - aPatch;
		});

		if (zipFiles.length === 0) {
			setError(true);
			setErrorMessage("No version found");
			throw new Error("No version found");
		}

		const latestZip = zipFiles[0];
		setVersion(latestZip.name);
		console.log(`Most recent version: ${latestZip.name}`);

		const url = `https://huggingface.co/iahispano/applio-app/resolve/main/${latestZip.name}`;
		return url;
	};

	useEffect(() => {
		const downloadApp = async () => {
			localStorage.getItem("shortcut") === "false" && setShouldShortcut(false);
			const setdir = localStorage.getItem("dir");

			console.log("setdir", setdir);

			try {
				const url = await getLastVersion();
				const token = import.meta.env.VITE_HF_TOKEN;

				if (!setdir) {
					const actual_dir = await invoke("get_actual_dir");
					if (!actual_dir) {
						setError(true);
						setErrorMessage("Actual directory is null");
						throw new Error("Actual directory is null");
					}
					setDir(actual_dir as string);
				} else {
					setDir(setdir as string);
				}

				if (dir) {
					const result = await invoke("download_zip", {
						url: url,
						outputPath: `${dir}/applio-app.zip`,
						token: token,
						shortcut: shouldShortcut,
					});

					console.log(result);

					if (typeof result === "string" && result.includes("error")) {
						setError(true);
						setErrorMessage(result);
						console.error(result);
					}
					if (typeof result === "string" && result.includes("downloaded")) {
						setSuccess(true);
					}
					console.log(url);
				}
			} catch (error) {
				setError(true);
				setErrorMessage(`${error}`);
				console.error("Error:", error);
			}
		};

		downloadApp();
	}, [dir, invoke]);

	useEffect(() => {
		const unlisten = listen("download-progress", (event) => {
			const progressValue = event.payload as number;
			setValue(progressValue);
		});

		return () => {
			unlisten;
		};
	}, []);

	return (
		<main className="min-h-screen min-w-screen overflow-hidden">
			<div className="w-full h-[100svh] overflow-hidden">
				{success && (
					<div className="w-full h-full flex flex-col justify-center items-center gap-2 px-4 text-center">
						<h1 className="text-3xl font-semibold text-white title">
							Installation Successful!
						</h1>
						<h2 className="text-sm text-neutral-300 max-w-md leading-relaxed">
							You can now close this window. It will automatically close in{" "}
							{timeLeft} {timeLeft === 1 ? "second!" : "seconds."}
						</h2>
					</div>
				)}

				<div className="flex flex-col justify-end items-end p-4 h-full">
					{error ? (
						<>
							<ErrorSection errorMessage={errorMessage} />
							<InstallationProgress value={value} isError={true} />
						</>
					) : (
						<InstallationProgress
							value={value}
							version={version}
							isError={false}
						/>
					)}
				</div>
			</div>
		</main>
	);
}
