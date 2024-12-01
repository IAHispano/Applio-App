import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { motion } from "motion/react";

const ErrorSection = () => (
	<motion.div
		initial={{ opacity: 0 }}
		animate={{ opacity: 1 }}
		transition={{ duration: 0.2 }}
		className="h-fit flex flex-col justify-start items-start gap-4 w-full pt-16 px-8"
	>
		<div className="bg-red-500/40 backdrop-filter backdrop-blur-3xl border border-white/10 w-full p-6 rounded-lg shadow-lg">
			<h2 className="text-neutral-300 font-semibold text-lg">Error Detected</h2>
			<p className="text-neutral-400 text-sm mb-4">
				Something went wrong during installation. Please check the following
				steps to resolve the issue:
			</p>
			<ul className="text-neutral-300 text-sm space-y-2 mb-4">
				<li>• Verify your internet connection.</li>
				<li>• Ensure the installation directory is accessible.</li>
				<li>
					• If the issue persists, try again later or reach out for assistance.
				</li>
			</ul>
			<div className="flex justify-end w-full">
				<a
					href="https://applio.org/discord"
					target="_blank"
					rel="noopener noreferrer"
					className="w-fit px-4 py-2 bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm rounded-xl hover:bg-[#1c1c1c]/30 transition-all duration-400"
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
			{isError ? "Stopped" : "Installing..."}{" "}
			<span className="text-neutral-400 text-sm font-sans">
				({Math.round(value)}%)
			</span>
		</h2>
		<div className="backdrop-filter backdrop-blur-3xl border border-white/10 w-full mt-2 rounded-lg shadow-lg">
			<div
				className={`h-2 rounded-lg  ${
					isError ? "bg-red-500/40" : "bg-neutral-300"
				}`}
				style={{ width: isError ? "100%" : `${value}%` }}
			/>
		</div>
		{version && !isError && (
			<p className="text-[10px] text-right mx-auto w-full text-neutral-400">
				Installing {version}
			</p>
		)}
	</div>
);

export default function Install() {
	const [value, setValue] = useState<number>(0);
	const [error, setError] = useState<boolean>(false);
	const [success, setSuccess] = useState<boolean>(false);
	const [shouldShortcut, setShouldShortcut] = useState<boolean>(true);
	const [dir, setDir] = useState<string>("");
	const [version, setVersion] = useState<string>("");

	const getLastVersion = async () => {
		const repoUrl = "https://huggingface.co/api/models/bygimenez/applio-app";
		const token = import.meta.env.VITE_HF_TOKEN;

		const response = await fetch(repoUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			setError(true);
			throw new Error(`error getting version: ${response.status}`);
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
			throw new Error("no version found");
		}

		const latestZip = zipFiles[0];
		setVersion(latestZip.name);
		console.log(`version most recent: ${latestZip.name}`);

		const url = `https://huggingface.co/bygimenez/applio-app/resolve/main/${latestZip.name}`;
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
						throw new Error("actual_dir is null");
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
						console.error(result);
					}
					if (typeof result === "string" && result.includes("downloaded")) {
						setSuccess(true);
					}
					console.log(url);
				}
			} catch (error) {
				setError(true);
				console.error("error", error);
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
					<div className="w-full h-full flex flex-col justify-center items-center">
						<h1 className="text-3xl text-white title font-semibold">
							Successfully installed!
						</h1>
						<h2 className="text-neutral-300 max-w-sm text-sm text-balance text-center">
							You can now close this window and start using Applio App.
						</h2>
					</div>
				)}

				<div className="flex flex-col justify-end items-end p-4 h-full">
					{error ? (
						<>
							<ErrorSection />
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
