import { useState, useEffect, useId } from "react";
import { supabase } from "../../utils/database";
import { invoke } from "@tauri-apps/api/core";
import { TitleBar } from "../../components/layout/titlebar";
import { open } from "@tauri-apps/plugin-shell";
import { useNavigate, useSearchParams } from "react-router-dom";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

export default function Models() {
	const [value, setValue] = useState("");
	const [data, setData] = useState<any>();
	const [loading, setLoading] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [status, setStatus] = useState("");
	const [info, setInfo] = useState("");
	const [error, setError] = useState(false);
	const [mode, setMode] = useState("explore");
	const [url, setUrl] = useState("");
	const [downloadedModels, setDownloadedModels] = useState<any>([]);
	const [modelName, setModelName] = useState<string>();
	const [searchParams] = useSearchParams();
	const [myModelsValue, setMyModelsValue] = useState("");
	const [filePath, setFilePath] = useState<string | null>("");

	const navigate = useNavigate();

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
		setModelName(name);
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
			if (algorithm)
				queryParams.append("algorithm", encodeURIComponent(algorithm));
			if (name) queryParams.append("name", encodeURIComponent(name));
			if (author) queryParams.append("author", encodeURIComponent(author));
			if (from) queryParams.append("from", encodeURIComponent(from));

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

	useEffect(() => {
		const getDownloadedModels = async () => {
			try {
				const port = await getServerPort();
				const response = await fetch(`http://localhost:${port}/get-models`);
				if (response.ok) {
					const models = await response.json();

					console.log(models);
					setDownloadedModels(models);
				} else {
					console.error("Error fetching models:", response.statusText);
				}
			} catch (error) {
				console.error("Fetch error:", error);
			}
		};

		if (mode === "downloaded") {
			getDownloadedModels();
		}
	}, [mode]);

	const deleteModel = async (id: string) => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-model?id=${encodeURIComponent(id)}`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					console.log(data);
					setDownloadedModels(
						downloadedModels.filter((item: any) => item.id !== id),
					);
				} else {
					console.error("Error deleting model:", data.message);
				}
			} else {
				console.error("Error deleting model:", response.statusText);
			}
		} catch (error) {
			console.error("Error deleting model:", error);
		}
	};

	const deleteAllModels = async () => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-all-models`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					console.log(data);
					navigate(0);
				} else {
					console.error("Error deleting all inferences:", data.message);
				}
			} else {
				console.error("Error deleting all inferences:", response.statusText);
			}
		} catch (error) {
			console.error("Error deleting all inferences:", error);
		}
	};

	const filteredData = myModelsValue
		? downloadedModels.filter((downloadedModels: { name: string }) =>
				downloadedModels.name
					.toLowerCase()
					.includes(myModelsValue.toLowerCase()),
			)
		: downloadedModels;

	useEffect(() => {
		const searchValue = searchParams.get("search");
		if (searchValue) setValue(searchValue);
	}, []);

	const handleImportModel = async (modelPath: string) => {
		const id = crypto.randomUUID();
		const port = await getServerPort();
	
		setDropdownOpen(true);
		setInfo("Starting...");
		setStatus("Sending request...");
	
		try {
			const response = await fetch(`http://localhost:${port}/import-model?path=${encodeURIComponent(modelPath)}&id=${encodeURIComponent(id)}`, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
				},
			});
			setInfo("Importing...");
			setStatus("Importing model...");
			const data = await response.json();

			setInfo("Finishing...");
			setStatus("Imported successfully");
			
			if (data.status === "success") {
				setInfo("Imported successfully");
				setStatus("Imported successfully");
				setFilePath("");
			} else {
				setError(true);
				setInfo("Error");
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
											className={`h-2.5 rounded-full ${error ? "bg-red-500/30" : "bg-green-500"}`}
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
									{(info === "Downloaded" || info === "Imported successfully" || error) && (
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
				<div className="border border-white/10 rounded-xl p-4 w-full h-full flex flex-col gap-4 overflow-auto">
					<div className="bg-[#111111]/20 rounded-xl w-full p-4 flex gap-4">
						<button
							type="button"
							onClick={() => setMode("explore")}
							className={`px-4 py-1 rounded-xl ${mode === "explore" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}
						>
							Explore
						</button>
						<button
							type="button"
							onClick={() => setMode("import")}
							className={`px-4 py-1 rounded-xl ${mode === "import" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}
						>
							Import
						</button>
						<button
							type="button"
							onClick={() => setMode("downloaded")}
							className={`justify-end ml-auto px-4 py-1 rounded-xl ${mode === "downloaded" ? "bg-white/10 " : ""} border border-white/[0.05] text-sm text-neutral-300`}
						>
							My models
						</button>
					</div>
					{/* huggingface warning */}
					<div className="w-full rounded-xl p-4 bg-orange-500/10">
						<h1>Warning</h1>
						<p className="text-xs text-neutral-400">
							We are aware of a problem with models coming from HuggingFace, we
							are working on fixing it. As a workaround you can manually install
							those models that give error.
						</p>
					</div>
					{mode === "explore" && (
						<div>
							<input
								type="text"
								className="w-full h-12 rounded-xl focus:outline-none bg-[#111111]/20 text-sm p-4"
								placeholder="Search..."
								value={value}
								onChange={(e) => setValue(e.target.value)}
							/>
							<div className="w-full mt-6">
								{!loading && data === null && (
									<div className="flex flex-col items-center justify-center w-full h-full">
										<h1 className="text-center text-sm text-neutral-400">
											No results found
										</h1>
									</div>
								)}
								{loading && (
									<div className="flex flex-col items-center justify-center w-full h-full">
										<h1 className="text-center text-sm text-neutral-400">
											Loading...
										</h1>
									</div>
								)}
								{!value && (
									<div className="flex flex-col items-center justify-center w-full h-full">
										<h1 className="text-center text-sm text-neutral-400">
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
												className="w-full h-full min-h-[20svh] text-left rounded-xl focus:outline-none bg-[#111111]/20 p-4 hover:bg-[#111111]/30 slow flex flex-col items-start justify-start"
												key={item.id}
											>
												<h1 className="font-semibold title text-neutral-200 text-lg">
													{item.name}
												</h1>
												<p className="text-xs">
													created by {item.author_username} at
													<span className="pl-1">
														{new Date(item.created_at).toLocaleDateString(
															"en-US",
															{
																year: "numeric",
																month: "long",
																day: "numeric",
															},
														)}
													</span>
												</p>
												<div className="justify-end flex mt-auto gap-2">
													<p className="bg-[#111111]/50 px-2 rounded-md text-sm">
														{item.epochs} epochs
													</p>
													<p className="bg-[#111111]/50 px-2 rounded-md text-sm">
														{item.algorithm}
													</p>
													<p className="bg-[#111111]/50 px-2 rounded-md text-sm">
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
						<div className="w-full h-full flex flex-col gap-4">
							<h2 className="text-neutral-200">Download from URL</h2>
							<div className="flex flex-col w-full">
								<input
									required
									onChange={(e) => setUrl(e.target.value)}
									className="w-full h-12 rounded-xl focus:outline-none bg-[#111111]/20 text-sm p-4"
									placeholder="https://drive.google.com/file/d/1231207i231/view?usp=sharing"
									type="text"
								/>
							</div>
							{url && (
								<button
									onClick={() => downloadModel(url)}
									className="w-fit justify-end ml-auto mt-12 px-4 py-2 bg-white text-black rounded-xl text-sm hover:bg-opacity-80 slow"
									type="button"
								>
									Import
								</button>
							)}
							<div className="mt-12 w-full flex flex-col gap-4 p-1">
								<h2 className="text-neutral-200">Import from your local machine</h2>
								<div className='flex gap-4 w-full'>
								<button onClick={() => handleImportModelFile()} className="w-full h-12 rounded-xl focus:outline-none bg-[#111111]/20 border border-white/10 text-sm" type="button"> 
								{filePath ? ( <p className="text-sm text-neutral-300">{filePath}</p>) : (<p className="text-sm text-neutral-300">No file selected</p>)}
								</button>
								{filePath && (
									<button
										onClick={() => handleImportModel(filePath)}
										className="w-fit px-8 rounded-xl focus:outline-none bg-neutral-600/50 text-neutral-200 text-sm"
										type="button"
									>
										Import
									</button>
								)}
							</div>
							</div>
						</div>
					)}
					{mode === "downloaded" && (
						<>
							{downloadedModels.length === 0 && (
								<div className="flex flex-col items-center justify-center w-full h-full mb-12">
									<h1 className="text-center text-sm text-neutral-400">
										No models found
									</h1>
								</div>
							)}

							{!loading && downloadedModels.length > 0 && (
								<div className="grid grid-cols-6 gap-4 w-full">
									<input
										type="text"
										className="col-span-5 w-full h-12 rounded-xl focus:outline-none bg-[#111111]/20 text-sm p-4"
										placeholder="Search..."
										value={myModelsValue}
										onChange={(e) => setMyModelsValue(e.target.value)}
									/>
									<button
										onClick={deleteAllModels}
										className="col-span-1 rounded-xl bg-[#111111]/20 p-2 text-sm text-neutral-200 hover:shadow-xl hover:shadow-red-500/10 hover:bg-red-500/20 slow"
										type="button"
									>
										Delete all models
									</button>
								</div>
							)}
							<div className="w-full grid grid-cols-3 gap-4">
								{filteredData.map(
									(item: {
										id: string;
										name: string;
										downloaded_at: string;
										model_folder_path: string;
									}) => (
										<div
											key={item.id}
											className="w-full h-full min-h-[15svh] text-left rounded-xl focus:outline-none bg-[#111111]/20 p-4 flex flex-col items-start justify-start"
										>
											<div className="flex justify-between w-full items-center">
												<h1 className="text-center text-neutral-300 font-semibold title truncate max-w-[200px]">
													{decodeURIComponent(item.name)}
												</h1>
												<div className="flex gap-2">
													<button
														className="rounded-xl bg-neutral-800/60 border border-white/10 p-2 hover:bg-neutral-700 slow hover:shadow-xl hover:shadow-neutral-700 text-sm"
														type="button"
														onClick={() => open(item.model_folder_path)}
													>
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="none"
															stroke="#ffffff"
															strokeWidth="2"
															strokeLinecap="round"
															strokeLinejoin="round"
															className="w-4 h-4 opacity-70"
															aria-hidden="true"
														>
															<path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
														</svg>
													</button>
													<button
														type="button"
														className="rounded-xl bg-neutral-800/60 border border-white/10 p-2 hover:bg-red-500/20 hover:shadow-xl hover:shadow-red-500/20 text-sm text-white slow"
														onClick={() => deleteModel(item.id)}
													>
														<svg
															className="w-4 h-4 opacity-70"
															aria-hidden="true"
															viewBox="0 0 24 24"
															fill="none"
															xmlns="http://www.w3.org/2000/svg"
														>
															<g id="SVGRepo_bgCarrier" stroke-width="0" />
															<g
																id="SVGRepo_tracerCarrier"
																stroke-linecap="round"
																stroke-linejoin="round"
															/>
															<g id="SVGRepo_iconCarrier">
																{" "}
																<path
																	d="M4 7H20"
																	stroke="#ffffff"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																/>{" "}
																<path
																	d="M6 7V18C6 19.6569 7.34315 21 9 21H15C16.6569 21 18 19.6569 18 18V7"
																	stroke="#ffffff"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																/>{" "}
																<path
																	d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z"
																	stroke="#ffffff"
																	stroke-width="2"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																/>{" "}
															</g>
														</svg>
													</button>
												</div>
											</div>
											<div className="flex mt-auto ml-auto">
												<p className="text-xs text-neutral-400">
													{new Date(item.downloaded_at).toLocaleDateString(
														"en-US",
														{
															year: "numeric",
															month: "long",
															day: "numeric",
														},
													)}
												</p>
											</div>
										</div>
									),
								)}
							</div>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
