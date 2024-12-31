import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { TitleBar } from "../../components/layout/titlebar";
import Loading from "../../components/convert/loading";
import { motion } from "framer-motion";
import { getServerPort } from "../../utils/getBackendPort";
import ModelsLibrary from "../../components/models/library";
import { sendNotificationUtil } from "../../utils/sendNotification";

export default function Models() {
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [status, setStatus] = useState("");
	const [info, setInfo] = useState("");
	const [error, setError] = useState(false);
	const [mode, setMode] = useState("import");
	const [url, setUrl] = useState("");
	const [modelName, setModelName] = useState<string | undefined>();
	const [modelEpochs, setEpochs] = useState<number | undefined>();
	const [modelAlgorithm, setAlgorithm] = useState<string | undefined>();
	const [filePath, setFilePath] = useState<string | null>("");
	const [imagePath, setImagePath] = useState<string | null>("");
	const [uploadedImage, setUploadedImage] = useState<string | undefined>("");
	const [imageLoading, setImageLoading] = useState(false);
	const [dominantColor, setDominantColor] = useState<string | null>("");

	const downloadModel = async (
		link: string,
		name?: string,
		epochs?: number,
		algorithm?: string,
		image?: string,
		id?: string,
		author?: string,
		from?: string,
	) => {
		const port = await getServerPort();
		setModelName(name);
		setDropdownOpen(true);
		setInfo("Starting...");
		setStatus("Sending request...");
		setError(false);
		sendNotificationUtil("Download started", "Downloading model...");
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
			if (algorithm)
				queryParams.append("algorithm", encodeURIComponent(algorithm));
			if (name) queryParams.append("name", encodeURIComponent(name));
			if (author) queryParams.append("author", encodeURIComponent(author));
			if (from) queryParams.append("from", encodeURIComponent(from));
			if (image) queryParams.append("image", encodeURIComponent(image));

			console.log(queryParams.toString());

			const eventSource = new EventSource(
				`http://localhost:${port}/download?${queryParams.toString()}`,
			);

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
					sendNotificationUtil(
						"Download finished",
						"Model downloaded successfully!",
					);
				}
				if (event.data.includes("error")) {
					setInfo("Error");
					setStatus("Error downloading model, please try again.");
					setError(true);
					eventSource.close();
					sendNotificationUtil(
						"Download failed",
						"Error downloading model, please try again.",
					);
				}
				if (event.data.includes("WinError") && event.data.includes("183")) {
					setInfo("Error");
					setStatus("You already have this model!");
					setError(true);
					eventSource.close();
					sendNotificationUtil(
						"Download failed",
						"You already have this model!",
					);
				}
			};

			eventSource.onerror = (err) => {
				console.log(info);
				console.error("Error with event source:", err);
				eventSource.close();
				setError(true);
				setStatus("We detected an error, please try again.");
				sendNotificationUtil(
					"Download failed",
					"We detected an error, please try again.",
				);
			};

			return () => {
				eventSource.close();
			};
		} catch (error) {
			console.error("Error:", error);
			setStatus("We detected an error. Please try again later.");
		}
	};

	const handleImportModel = async (modelPath: string) => {
		const id = crypto.randomUUID();
		const port = await getServerPort();

		setDropdownOpen(true);
		setInfo("Starting...");
		setStatus("Sending request...");
		sendNotificationUtil("Importing model", "Importing model...");

		try {
			const response = await fetch(
				`http://localhost:${port}/import-model?path=${encodeURIComponent(
					modelPath,
				)}&id=${encodeURIComponent(id)}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
				},
			);
			setInfo("Importing...");
			setStatus("Importing model...");
			const data = await response.json();

			setInfo("Finishing...");
			setStatus("Imported successfully");

			if (data.status === "success") {
				setInfo("Imported successfully");
				setStatus("Imported successfully");
				sendNotificationUtil("Import finished", "Model imported successfully!");
				setFilePath("");
			} else {
				setError(true);
				setInfo("Error");
				sendNotificationUtil(
					"Import failed",
					"Error importing model, please try again.",
				);
				setStatus(data.message);
			}
		} catch (err) {
			setError(true);
			console.error("Error:", err);
		}
	};

	const handleImportModelFile = async () => {
		const file = await dialogOpen({
			directory: true,
			multiple: false,
		});

		setFilePath(file);
	};
	const handleImportModelImage = async () => {
		setDominantColor(null);
		setImagePath("");
		setImageLoading(true);
		const file = await dialogOpen({
			directory: false,
			multiple: false,
			filters: [
				{ name: "Images", extensions: ["jpg", "png", "jpeg", "gif", "webp"] },
			],
		});

		if (file) {
			setUploadedImage(file);
			const port = await getServerPort();
			const imageUrl = `http://localhost:${port}/image?path=${encodeURIComponent(file)}`;

			const response = await fetch(imageUrl, { method: "GET" });
			if (response.ok) {
				setImagePath(imageUrl);
			} else {
				console.error("Error fetching image:", response.statusText);
			}
		}
	};

	useEffect(() => {
		if (imagePath) {
			const img = new Image();
			img.crossOrigin = "Anonymous";
			img.src = imagePath;
			img.onload = () => {
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				if (ctx) {
					canvas.width = img.width;
					canvas.height = img.height;
					ctx.drawImage(img, 0, 0);
					const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
					const data = imageData.data;
					let r = 0,
						g = 0,
						b = 0;
					let total = data.length / 4;
					for (let i = 0; i < data.length; i += 4) {
						r += data[i];
						g += data[i + 1];
						b += data[i + 2];
					}
					r = Math.floor(r / total);
					g = Math.floor(g / total);
					b = Math.floor(b / total);
					setDominantColor(`rgb(${r}, ${g}, ${b})`);
					console.log("Dominant Color:", `rgb(${r}, ${g}, ${b})`);
				}
			};
		}
	}, [imagePath]);

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-center justify-start mt-10 mb-4 px-4 w-full overflow-auto">
				{dropdownOpen && (
					<div
						className="absolute inset-0 bg-[#111111]/80 backdrop-blur-2xl backdrop-filter w-screen h-full overflow-hidden"
						style={{ zIndex: 250 }}
					>
						<TitleBar />
						<div className="w-full h-full flex justify-center items-center">
							<div className="w-full max-w-2xl h-fit min-h-[10svh]  border border-white/10 bg-[#2a2b2a] shadow-2xl shadow-white/10 rounded-xl p-4 flex flex-col">
								<div className="flex mb-auto justify-start items-start">
									<h1 className="text-xl truncate max-w-2xl">
										{info === "Downloading" ? "Downloading" : "Importing"}{" "}
										{modelName && (
											<span className="font-medium title">{modelName}</span>
										)}
									</h1>
								</div>
								<div className="mt-auto flex justify-end items-start flex-col gap-4 w-full">
									<div className="w-full flex rounded-full h-2 my-4 shadow-lg shadow-white/10 bg-[#111111]/80">
										<div
											className={`h-2.5 rounded-full ${
												error ? "bg-red-500/30" : "bg-green-500"
											}`}
											style={{
												width:
													info === "Starting..."
														? "20%"
														: info === "Downloading"
															? "50%"
															: info === "Downloaded"
																? "100%"
																: info === "Importing"
																	? "50%"
																	: info === "Imported successfully"
																		? "100%"
																		: "0%",
											}}
										/>
									</div>
									{!error && !modelName && (
										<p className="text-[10px] text-neutral-400 flex">
											{status}
										</p>
									)}
									{error && (
										<div className="px-4 py-2 text-sm rounded-xl bg-red-500/30 text-neutral-300 w-full">
											{status}
										</div>
									)}
									{(info === "Downloaded" ||
										info === "Imported successfully" ||
										error) && (
										<button
											type="button"
											className="flex justify-end ml-auto px-6 py-1.5 bg-white text-black rounded-xl text-sm"
											onClick={() => setDropdownOpen(false)}
											aria-label="Close modal"
										>
											Close
										</button>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
				<div className="rounded-xl w-full h-full flex flex-col gap-4 overflow-auto">
					<div className="border border-white/10 rounded-xl w-full p-4 flex gap-4">
						<button
							type="button"
							aria-label="Change to import models page"
							onClick={() => setMode("import")}
							className={`px-4 py-1 rounded-xl ${
								mode === "import" ? "bg-white/10 " : "border border-white/10"
							} text-sm text-neutral-300`}
						>
							Import
						</button>
						<button
							type="button"
							aria-label="Change to downloaded models page"
							onClick={() => setMode("downloaded")}
							className={`justify-end ml-auto px-4 py-1 rounded-xl ${
								mode === "downloaded"
									? "bg-white/10 "
									: "border border-white/10"
							} text-sm text-neutral-300`}
						>
							My models
						</button>
					</div>
					{mode === "import" && (
						<div className="w-full h-full grid grid-cols-2 justify-start items-start gap-4">
							<div className="h-full border border-white/10 rounded-xl p-4">
								<h2 className="text-neutral-200">Download from URL</h2>
								<div className="flex gap-4">
									<div className="">
										<button
											className="bg-white/10 hover:bg-white/10 rounded-xl h-64 w-56 mt-4"
											onClick={handleImportModelImage}
										>
											<motion.div
												className="text-sm text-neutral-300 text-center flex justify-center items-center w-full h-full rounded-xl relative"
												initial={{
													boxShadow: "0 0 0px 0px transparent",
												}}
												animate={{
													boxShadow: dominantColor
														? `0 0 20px 5px ${dominantColor}`
														: "none",
												}}
												transition={{
													duration: 0.5,
													ease: "easeIn",
												}}
											>
												{imagePath ? (
													<div className="w-full h-full">
														<img
															src={imagePath}
															onLoad={() => setImageLoading(false)}
															alt="image"
															className="w-full h-full object-cover rounded-xl hover:opacity-80 slow"
														/>
													</div>
												) : (
													<>
														{!imageLoading && (
															<p className="text-sm text-neutral-300">
																Select an image
															</p>
														)}
													</>
												)}
												{imageLoading && (
													<div className="absolute inset-0">
														<Loading />
													</div>
												)}
											</motion.div>
										</button>
									</div>
									<div className="flex flex-col gap-4 w-full h-full justify-center m-auto">
										<div className="flex flex-col gap-2 w-full -mt-2.5">
											<label>
												<p className="text-sm text-right text-neutral-300">
													Name
												</p>
											</label>
											<input
												aria-label="Enter a name for your model"
												onChange={(e) => setModelName(e.target.value)}
												className="w-full h-12 rounded-xl placeholder:text-neutral-400 focus:outline-none bg-white/10 text-sm p-4"
												placeholder="My awesome model"
												type="text"
											/>
										</div>
										<div className="flex flex-col gap-2 w-full">
											<label>
												<p className="text-sm text-right text-neutral-300">
													Epochs
												</p>
											</label>
											<input
												aria-label="Enter the number of epochs for your model"
												onChange={(e) =>
													setEpochs(e.target.value as unknown as number)
												}
												className="w-full h-12 rounded-xl placeholder:text-neutral-400 focus:outline-none bg-white/10 text-sm p-4"
												placeholder="1000"
												type="number"
											/>
										</div>
										<div className="flex flex-col gap-2 w-full">
											<label>
												<p className="text-sm text-right text-neutral-300">
													Algorithm
												</p>
											</label>
											<input
												aria-label="Enter the number of epochs for your model"
												onChange={(e) => setAlgorithm(e.target.value)}
												className="w-full h-12 rounded-xl placeholder:text-neutral-400 focus:outline-none bg-white/10 text-sm p-4"
												placeholder="Crepe"
												type="text"
											/>
										</div>
									</div>
								</div>
								<div className="flex flex-col gap-2 w-full mt-4">
									<label>
										<p className="text-sm text-neutral-300">URL *</p>
									</label>
									<input
										aria-label="Enter URL to download model from"
										required
										onChange={(e) => setUrl(e.target.value)}
										className="w-full h-12 rounded-xl placeholder:text-neutral-400 focus:outline-none bg-white/10 text-sm p-4"
										placeholder="https://drive.google.com/file/d/1231207i231/view?usp=sharing"
										type="url"
									/>
								</div>
								{url && (
									<button
										aria-label="Download model from URL"
										onClick={() =>
											downloadModel(
												url,
												modelName,
												modelEpochs,
												modelAlgorithm,
												uploadedImage,
											)
										}
										className="w-full justify-end ml-auto mt-4 px-4 py-2 bg-white text-black rounded-xl text-sm hover:bg-opacity-80 slow"
										type="button"
									>
										Import
									</button>
								)}
								{!url && (
									<p className="text-[10px] text-neutral-400 mt-4 italic text-right">
										<span className="text-neutral-300">*</span> means required
										field
									</p>
								)}
							</div>
							<div className="border border-white/10 h-full rounded-xl p-4">
								<div className="w-full flex flex-col gap-4">
									<h2 className="text-neutral-200">
										Import from your local machine
									</h2>
									<div className="flex flex-col gap-4 w-full">
										<button
											aria-label="Import model locally"
											onClick={() => handleImportModelFile()}
											className="w-full h-64 hover:bg-white/20 transition-colors duration-300 rounded-xl focus:outline-none bg-white/10 text-sm"
											type="button"
										>
											{filePath ? (
												<p className="text-sm text-neutral-300 text-wrap max-w-xs text-center flex mx-auto justify-center items-center">
													{filePath}
												</p>
											) : (
												<p className="text-sm text-neutral-300">
													No file selected
												</p>
											)}
										</button>
										{filePath && (
											<button
												aria-label="Load model locally"
												onClick={() => handleImportModel(filePath)}
												className="w-full p-2 rounded-xl focus:outline-none bg-white hover:opacity-80 slow text-black text-sm"
												type="button"
											>
												Import
											</button>
										)}
									</div>
								</div>
							</div>
						</div>
					)}
					{mode === "downloaded" && <ModelsLibrary />}
				</div>
			</main>
		</div>
	);
}
