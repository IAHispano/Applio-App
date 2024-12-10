import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { AudioVisualizer } from "react-audio-visualize";
import { Link } from "react-router-dom";
import { useConvertContext } from "../../components/convert/conversion-context";
import Loading from "../../components/convert/loading";
import { supabase } from "../../utils/database";
import { open } from "@tauri-apps/plugin-shell";
import { RecordRTCPromisesHandler } from 'recordrtc';

export default function Convert() {
	const {
		models,
		setModels,
		currentIndex,
		setCurrentIndex,
		file,
		setFile,
		uploaded,
		setUploaded,
		info,
		setInfo,
		status,
		setStatus,
		error,
		setError,
		input,
		setInput,
		pth,
		setPth,
		index,
		setIndex,
		output,
		setOutput,
		pitch,
		setPitch,
		indexRate,
		setIndexRate,
		filterRadius,
		setFilterRadius,
		autotune,
		setAutotune,
		isPlaying,
		setIsPlaying,
		setProgress,
		convertedAudio,
		setConvertedAudio,
		convertTime,
		setConvertTime,
		cleanAudio,
		setCleanAudio,
		exportFormat,
		setExportFormat,
	} = useConvertContext();
	const audioRef = useRef<HTMLAudioElement>(null);
	const visualizerRef = useRef<HTMLCanvasElement | null>(null);

	const [loading, setLoading] = useState(true);
	const [previewModels, setPreviewModels] = useState<any>([]);
	const [modelName, setModelName] = useState<string>("");
	const [audioSection, setAudioSection] = useState("");
	const inputFileRef = useRef<HTMLInputElement | null>(null);

	const [recording, setRecording] = useState<boolean>(false);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
	const [recorder, setRecorder] = useState<RecordRTCPromisesHandler | null>(null);
  
	const startRecording = async () => {
	  try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const audioRecorder = new RecordRTCPromisesHandler(stream, {
		  type: "audio",
		});
  
		await audioRecorder.startRecording();
		setRecorder(audioRecorder);
		setRecording(true);
	  } catch (error) {
		console.error("Error starting recording:", error);
	  }
	};
  
	const stopRecording = async () => {
	  if (!recorder) return;
  
	  try {
		await recorder.stopRecording();
		const audioBlob = await recorder.getBlob();
		setAudioBlob(audioBlob);
		const audioUrl = URL.createObjectURL(audioBlob);
		setAudioUrl(audioUrl);
  
		console.log("Audio URL:", audioUrl);
		uploadAudio(audioBlob);
	  } catch (error) {
		console.error("Error stopping recording:", error);
	  } finally {
		setRecording(false);
	  }
	};
  
	const uploadAudio = async (audioBlob: Blob) => {
		try {
		  const port = await getServerPort();
		  const response = await fetch(`http://localhost:${port}/upload-input`, {
			method: "POST",
			headers: {
			  "Content-Type": "application/octet-stream", 
			},
			body: audioBlob, 
		  });
	  
		  if (response.ok) {
			const result = await response.json();
			setAudioUrl(result.file_path);
			console.log("Audio uploaded successfully:", result);
		  } else {
			console.error("Error uploading audio:", response.statusText);
		  }
		} catch (error) {
		  console.error("Upload failed:", error);
		}
	  };
	  

	const togglePlayPause = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause();
			} else {
				audioRef.current.play();
			}
			setIsPlaying((prevState) => !prevState);
		}
	};

	const handleTimeUpdate = () => {
		if (audioRef.current) {
			const progress =
				(audioRef.current.currentTime / audioRef.current.duration) * 100;
			setProgress(progress as unknown as string);
		}
	};

	useEffect(() => {
		const audioElement = audioRef.current;
		if (audioElement) {
			audioElement.addEventListener("timeupdate", handleTimeUpdate);
			return () => {
				audioElement.removeEventListener("timeupdate", handleTimeUpdate);
			};
		}
	}, [isPlaying]);

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	useEffect(() => {
		async function getLocalModels() {
			try {
				const port = await getServerPort();
				const response = await fetch(`http://localhost:${port}/get-models`);
				if (response.ok) {
					const models = await response.json();
					setModels(models);
					setLoading(false);
				} else {
					console.error("Error fetching models:", response.statusText);
					setLoading(false);
				}
			} catch (error) {
				console.error("Fetch error:", error);
			}
		}

		getLocalModels();
	}, []);

	useEffect(() => {
		if (models[currentIndex] && models[currentIndex].model_index_file) {
			console.log("model_index_file:", models[currentIndex].model_index_file);
			console.log("model_pth_file:", models[currentIndex].model_pth_file);
			setIndex(models[currentIndex].model_index_file);
			setPth(models[currentIndex].model_pth_file);
			setModelName(models[currentIndex].name);
		}
	}, [models, currentIndex]);

	const nextModel = () => {
		if (currentIndex < models.length - 1) {
			setCurrentIndex(currentIndex + 1);
		}
	};

	const prevModel = () => {
		if (currentIndex > 0) {
			setCurrentIndex(currentIndex - 1);
		}
	};

	const currentModel = models[currentIndex];

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFile = e.target.files?.[0];
		if (selectedFile) {
			setFile(selectedFile);
			console.log("File selected:", selectedFile);
		}
	};

	useEffect(() => {
		if (file) {
			handleUpload();
		}
	}, [file]);

	const handleUpload = async () => {
		if (!file) {
			console.error("No file selected");
			return;
		}

		const formData = new FormData();
		formData.append("audio", file);

		try {
			const port = await getServerPort();
			console.log("Server port:", port);
			const response = await fetch(`http://localhost:${port}/upload`, {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				throw new Error("Error uploading file");
			}

			const data = await response.json();
			console.log("Upload response:", data);
			setUploaded(true);
			setInput(data[0].file_path);
		} catch (error) {
			console.error("Upload error:", error);
		}
	};

	const convert = async () => {
		const startingTime = performance.now();
		setInfo("Starting...");
		setStatus("Sending request...");
		setError(false);

		const time = setInterval(() => {
			const actualTime = performance.now();
			const duration = (actualTime - startingTime) / 1000;
			setConvertTime(duration.toFixed(2));
		}, 100);

		const port = await getServerPort();
		try {
			const url = `http://localhost:${port}/convert?input=${encodeURIComponent(
				input,
			)}&pth=${encodeURIComponent(pth)}&index=${encodeURIComponent(
				index,
			)}&pitch=${encodeURIComponent(pitch)}&indexRate=${encodeURIComponent(
				indexRate,
			)}&filterRadius=${encodeURIComponent(
				filterRadius,
			)}&autotune=${encodeURIComponent(
				autotune,
			)}&cleanaudio=${encodeURIComponent(
				cleanAudio,
			)}&exportformat=${encodeURIComponent(
				exportFormat,
			)}&name=${encodeURIComponent(modelName)}`;
			const eventSource = new EventSource(url);
			console.log(url);
			eventSource.onmessage = (event) => {
				console.log(event.data);
				setStatus(event.data);
				if (event.data.includes("error")) {
					setInfo("Error");
					setStatus("An error has occurred, please try again.");
					setError(true);
					clearInterval(time);
					eventSource.close();
				}
				if (event.data.includes("finished")) {
					const audioPath = event.data.split("Audio path: ")[1];
					console.log(audioPath);
					setConvertedAudio(audioPath);
					getAudio(audioPath);
					setInfo("Conversion completed!");
					setStatus("Your audio has been converted successfully.");
					clearInterval(time);
					eventSource.close();
				}

				if (event.data.includes("completed")) {
					setInfo("Finishing...");
					setStatus("Receiving audio...");
					clearInterval(time);
				}
			};

			eventSource.onerror = (err) => {
				console.log(info);
				console.error("Error with event source:", err);
				eventSource.close();
				setError(true);
				clearInterval(time);
				setStatus("We detected an error, please try again.");
			};

			return () => {
				eventSource.close();
				clearInterval(time);
			};
		} catch (error) {
			console.error("Error:", error);
			clearInterval(time);
			setStatus("We detected an error. Please try again later.");
		}
	};

	const openDocs = async () => {
		open("https://docs.applio.org");
	};

	const downloadAudio = async (path: string) => {
		const lastSlashIndex = path.lastIndexOf("\\");
		const pathWithoutFile = path.substring(0, lastSlashIndex);

		open(pathWithoutFile);
	};

	function transformPath(path: string) {
		return path.replace(/\\/g, "/");
	}

	async function getAudio(path: string) {
		const transformedPath = transformPath(path);
		const port = await getServerPort();
		try {
			const response = await fetch(
				`http://localhost:${port}/audio?path=${encodeURIComponent(
					transformedPath,
				)}`,
			);
			if (!response.ok) {
				throw new Error("Error getting audio");
			}
			const audioBlob = await response.blob();
			setOutput(audioBlob);
		} catch (error) {
			console.error("Error:", error);
		}
	}

	const handleReset = () => {
		setInput("");
		setPth("");
		setIndex("");
		setStatus("");
		setInfo("");
		setFile(null);
		setInput("");
		setExportFormat("wav");
		setPitch(0);
		setIndexRate(0.3);
		setFilterRadius(3);
		setAutotune(false);
		setOutput(undefined);
		setUploaded(false);
		setFile(null);
		if (inputFileRef.current) {
			inputFileRef.current.value = "";
		}
		setAudioUrl(null);
		setAudioBlob(null);
	};

	const divRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const generateGradient = () => {
			if (divRef.current) {
				divRef.current.style.background = `linear-gradient(${Math.floor(
					Math.random() * 360,
				)}deg, rgb(${Math.floor(Math.random() * 256)}, ${Math.floor(
					Math.random() * 256,
				)}, ${Math.floor(Math.random() * 256)}), rgb(${Math.floor(
					Math.random() * 256,
				)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(
					Math.random() * 256,
				)}))`;
			}
		};

		generateGradient();
	}, [pth]);

	useEffect(() => {
		async function getPreviewModels() {
			const { data, error } = (await supabase
				?.from("models")
				.select("*")
				.limit(4)
				.order("id", { ascending: false })) || { data: null, error: null };
			if (data) {
				console.log("models", data);
				setPreviewModels(data);
			} else {
				console.error("Error fetching preview models:", error);
			}
		}

		getPreviewModels();
	}, [!currentModel]);

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-center mt-6 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-4">
					<div className="col-span-3 row-span-2 rounded-xl w-full h-full">
						<div className="flex gap-2 w-full h-full rounded-xl">
							<div className="grid grid-cols-1 grid-rows-3 gap-2 w-full max-w-[40svh] h-full">
								<div className="relative rounded-xl row-span-2 w-full h-full">
									<div
										ref={divRef}
										className="absolute w-full h-full rounded-xl backdrop-blur-3xl backdrop-filter noise opacity-30"
									/>
									{loading && (
										<div className="w-full h-full flex justify-center items-center">
											<Loading />
										</div>
									)}
									{!loading && (
										<div className="w-full h-full flex flex-col py-2">
											<p className="text-center text-neutral-200 mt-2 text-xl max-w-xl mx-4 truncate z-50">
												{currentModel
													? decodeURIComponent(currentModel.name)
													: ""}
											</p>
											<div className="w-full h-full gap-2">
												<div className="flex justify-between items-center my-auto h-full gap-2 overflow-hidden">
													{!currentModel && (
														<div className="absolute rounded-xl w-full h-full">
															<div className="absolute bottom-0 xl:left-8 xl:right-8 left-4 right-4">
																<h1 className="p-4 text-3xl title text-center font-semibold xl:max-w-5xl max-w-[200px] flex justify-center mx-auto">
																	Import your model
																</h1>
																<div className="bg-[#111111]/50 mb-1 h-[40svh] rounded-t-xl overflow-hidden">
																	<div className="flex flex-col gap-2 p-4">
																		{previewModels.length > 0 &&
																			previewModels.map((item: any) => (
																				<Link
																					to='/models'
																					key={item.id}
																				>
																					<div className="p-4 rounded-xl bg-[#111111]/60 hover:bg-[#111111]/80 slow">
																						<h1 className="font-medium title text-sm max-w-sm truncate">
																							{item.name}
																						</h1>
																					</div>
																				</Link>
																			))}
																		<div className="p-4 rounded-xl bg-[#111111]/60 hover:bg-[#111111]/80 slow">
																			<h1 className="font-medium title text-sm max-w-sm truncate">
																				And more...
																			</h1>
																		</div>
																	</div>
																</div>
															</div>
														</div>
													)}
													{currentModel && (
														<div className="m-auto flex gap-4 justify-center items-center">
															<button
																aria-label="Previous model"
																type="button"
																className="bg-white/10 hover:bg-white/20 disabled:hover:bg-white/10 slow disabled:opacity-60 border border-white/10 p-2 rounded-full z-50"
																style={{ zIndex: 500 }}
																onClick={prevModel}
																disabled={currentIndex === 0}
															>
																<svg
																	className="w-6 h-6 max-md:w-3 max-md:h-3 opacity-60"
																	viewBox="0 0 24 24"
																	fill="none"
																	xmlns="http://www.w3.org/2000/svg"
																	aria-hidden="true"
																>
																	<path
																		fillRule="evenodd"
																		clipRule="evenodd"
																		d="M15.7071 4.29289C16.0976 4.68342 16.0976 5.31658 15.7071 5.70711L9.41421 12L15.7071 18.2929C16.0976 18.6834 16.0976 19.3166 15.7071 19.7071C15.3166 20.0976 14.6834 20.0976 14.2929 19.7071L7.29289 12.7071C7.10536 12.5196 7 12.2652 7 12C7 11.7348 7.10536 11.4804 7.29289 11.2929L14.2929 4.29289C14.6834 3.90237 15.3166 3.90237 15.7071 4.29289Z"
																		fill="#ffffff"
																	/>
																</svg>
															</button>
															<ul className="noise rounded-xl gap-1 flex flex-col w-full text-center mx-4 z-50">
																{currentModel.epochs && (
																	<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/10 px-4 py-1 rounded-xl">
																		{currentModel
																			? currentModel.epochs
																			: "Undefined"}{" "}
																		epochs
																	</li>
																)}
																{currentModel.algorithm && (
																	<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/10 px-4 py-1 rounded-xl">
																		{currentModel
																			? currentModel.algorithm
																			: "Undefined algorithm"}
																	</li>
																)}
																{currentModel.author && (
																	<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/10 px-4 py-1 rounded-xl">
																		{currentModel
																			? encodeURIComponent(currentModel.author)
																			: "Undefined author"}
																	</li>
																)}
																{currentModel.from && (
																	<li className="text-sm max-md:text-xs text-neutral-200 bg-black/40 border border-white/10 px-4 py-1 rounded-xl">
																		{currentModel
																			? encodeURIComponent(currentModel.from)
																			: "Undefined server"}
																	</li>
																)}
															</ul>
															<button
																aria-label="Next model"
																type="button"
																className="bg-white/10 hover:bg-white/20 disabled:hover:bg-white/10 disabled:opacity-60 slow border border-white/10 p-2 rounded-full"
																style={{ zIndex: 500 }}
																onClick={nextModel}
																disabled={currentIndex === models.length - 1}
															>
																<svg
																	className="w-6 h-6 max-md:w-3 max-md:h-3 opacity-60"
																	viewBox="0 0 24 24"
																	fill="none"
																	xmlns="http://www.w3.org/2000/svg"
																	aria-hidden="true"
																>
																	<path
																		fillRule="evenodd"
																		clipRule="evenodd"
																		d="M8.29289 4.29289C8.68342 3.90237 9.31658 3.90237 9.70711 4.29289L16.7071 11.2929C17.0976 11.6834 17.0976 12.3166 16.7071 12.7071L9.70711 19.7071C9.31658 20.0976 8.68342 20.0976 8.29289 19.7071C7.90237 19.3166 7.90237 18.6834 8.29289 18.2929L14.5858 12L8.29289 5.70711C7.90237 5.31658 7.90237 4.68342 8.29289 4.29289Z"
																		fill="#ffffff"
																	/>
																</svg>
															</button>
														</div>
													)}
												</div>
											</div>
											{currentModel && (
												<p className="text-center text-neutral-300 text-xs z-50">
													Download more models{" "}
													<Link
														to="/models"
														className="text-white hover:underline"
														aria-label="Go to models page"
													>
														here
													</Link>
													.
												</p>
											)}
										</div>
									)}
								</div>
								<div className="enabled:hover:opactiy-100 relative border border-white/10 h-full w-full rounded-xl p-4 slow flex flex-col gap-2 justify-center items-center">
									<div className="absolute w-full h-full rounded-xl backdrop-blur-3xl backdrop-filter noise opacity-40" />
									<div className="absolute top-4 left-4 bg-neutral-800/50 rounded-xl overflow-hidden" style={{zIndex: 100}}>
									<div className="flex divide-x divide-white/10">
											<button
											aria-label="Import audio"
											type="button"
											onClick={() => setAudioSection("import")}
											className="z-50 p-2 px-4 hover:bg-white/10 transition-colors duration-200 ease-in-out"
											>
											<svg aria-hidden="true" className="w-4 h-4" fill="#ffffff" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0" /><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" /><g id="SVGRepo_iconCarrier"> <path d="m807.186 686.592 272.864 272.864H0v112.94h1080.05l-272.864 272.978 79.736 79.849 409.296-409.183-409.296-409.184-79.736 79.736ZM1870.419 434.69l-329.221-329.11C1509.688 74.07 1465.979 56 1421.48 56H451.773v730.612h112.94V168.941h790.584v451.762h451.762v1129.405H564.714v-508.233h-112.94v621.173H1920V554.52c0-45.176-17.619-87.754-49.58-119.83Zm-402.181-242.37 315.443 315.442h-315.443V192.319Z" fill-rule="evenodd" /></g></svg>
											</button>
											<button
											aria-label="Record audio"
											type="button"
											onClick={() => setAudioSection("record")}
											className="p-2 px-3.5 hover:bg-white/10 transition-colors duration-200 ease-in-out"
											>
											<svg className="w-6 h-6 opacity-80" fill="#ffffff" viewBox="-9.5 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>record</title> <path d="M2.656 11.25v-2.969c0-1.906 1.719-3.5 3.906-3.5 2.156 0 3.906 1.594 3.906 3.5v2.969h-7.813zM13.188 11.438v5.969c-1.281 3.5-5.063 4.031-5.063 4.031v3.969h4.156v1.781h-11.438v-1.781h4.188v-3.969s-3.75-0.531-5.031-4.031v-5.969l1.531-0.719v5.438s0.469 3.656 5.031 3.656 5.094-3.656 5.094-3.656v-5.438zM10.469 12.281v2.688c0 1.906-1.75 3.5-3.906 3.5-2.188 0-3.906-1.594-3.906-3.5v-2.688h7.813z"></path> </g></svg>
											</button>
									</div>
									</div>
									{uploaded || audioUrl ? (
										<>
											<button
												aria-label="Reset conversion"
												onClick={handleReset}
												type="button"
												style={{ zIndex: 100 }}
												className="cursor-pointer absolute right-4 rounded-xl top-4 hover:bg-neutral-800 slow bg-neutral-800/80 p-3"
											>
												<svg className="w-4 h-4 opacity-60" fill="#ffffff" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" strokeWidth="0"/><g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"/><g id="SVGRepo_iconCarrier"><path d="M960 0v213.333c411.627 0 746.667 334.934 746.667 746.667S1371.627 1706.667 960 1706.667 213.333 1371.733 213.333 960c0-197.013 78.4-382.507 213.334-520.747v254.08H640V106.667H53.333V320h191.04C88.64 494.08 0 720.96 0 960c0 529.28 430.613 960 960 960s960-430.72 960-960S1489.387 0 960 0" fill-rule="evenodd"/></g></svg>
											</button>
											{!audioUrl && (
											<svg
												className="w-16 h-16 opacity-60"
												viewBox="0 0 24 24"
												fill="none"
												xmlns="http://www.w3.org/2000/svg"
												aria-hidden="true"
											>
												<g id="SVGRepo_bgCarrier" strokeWidth="0" />
												<g
													id="SVGRepo_tracerCarrier"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
												<g id="SVGRepo_iconCarrier">
													<g id="Interface / Check">
														<path
															id="Vector"
															d="M6 12L10.2426 16.2426L18.727 7.75732"
															stroke="#ffffff"
															strokeWidth="2"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</g>
												</g>
											</svg>
											)}
										</>
									) : (
										<>
										{audioSection === "import" ? (
											<svg aria-hidden="true" className="w-12 h-12" fill="#ffffff" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0" /><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" /><g id="SVGRepo_iconCarrier"> <path d="m807.186 686.592 272.864 272.864H0v112.94h1080.05l-272.864 272.978 79.736 79.849 409.296-409.183-409.296-409.184-79.736 79.736ZM1870.419 434.69l-329.221-329.11C1509.688 74.07 1465.979 56 1421.48 56H451.773v730.612h112.94V168.941h790.584v451.762h451.762v1129.405H564.714v-508.233h-112.94v621.173H1920V554.52c0-45.176-17.619-87.754-49.58-119.83Zm-402.181-242.37 315.443 315.442h-315.443V192.319Z" fill-rule="evenodd" /></g></svg>
											
										) : (
											<>
											{!audioUrl && (
											<svg className="w-16 h-16 opacity-80" fill="#ffffff" viewBox="-9.5 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>record</title> <path d="M2.656 11.25v-2.969c0-1.906 1.719-3.5 3.906-3.5 2.156 0 3.906 1.594 3.906 3.5v2.969h-7.813zM13.188 11.438v5.969c-1.281 3.5-5.063 4.031-5.063 4.031v3.969h4.156v1.781h-11.438v-1.781h4.188v-3.969s-3.75-0.531-5.031-4.031v-5.969l1.531-0.719v5.438s0.469 3.656 5.031 3.656 5.094-3.656 5.094-3.656v-5.438zM10.469 12.281v2.688c0 1.906-1.75 3.5-3.906 3.5-2.188 0-3.906-1.594-3.906-3.5v-2.688h7.813z"></path> </g></svg>
											)}
											</>
										)}
										</>
									)}
									<p className="text-sm text-neutral-300 z-50 truncate max-w-3xl">
										{file ? file.name : audioSection === "import" ? "Import your audio" : recording ? "Stop Recording" : !audioUrl ? "Start Recording" : ""}
									</p>
									{audioSection === "import" ? (
										<input
											ref={inputFileRef}
											disabled={uploaded}
											type="file"
											accept="audio/*"
											className="absolute inset-0 opacity-0 z-50 enabled:cursor-pointer disabled:cursor-not-allowed"
											onChange={handleFileChange}
											aria-label="Select your audio"
										/>
									) : (
										<>
										{!audioUrl && (
										<button className="absolute inset-0 opacity-0 z-50 enabled:cursor-pointer disabled:cursor-not-allowed" type="button" onClick={recording ? stopRecording : startRecording}>
										</button>
										)}
										</>
									)}
									{audioUrl && (
										<div className="w-full justify-end items-end mt-auto h-[10svh] flex gap-2" style={{zIndex: 100}}>
										<div className="w-full border border-white/20 rounded-xl pl-4 h-18 flex justify-between items-center gap-4">
											<div className="flex justify-start items-center">
											<button
													type="button"
													className="w-full h-full"
													onClick={togglePlayPause}
													aria-label="Toggle play/pause"
												>
													{isPlaying ? (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z"
																clipRule="evenodd"
															/>
														</svg>
													) : (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
																clipRule="evenodd"
															/>
														</svg>
													)}
												</button>
											</div>
											<div className="aspect-video w-full max-w-full max-h-[10svh] overflow-hidden flex items-center gap-4">
												<AudioVisualizer
													aria-label="Audio visualizer"
													ref={visualizerRef}
													blob={audioBlob as Blob}
													width={500}
													height={500}
													barWidth={1}
													gap={6}
													barColor="#22aa68"
													style={{
														height: "8svh",
														width: "100%",
														aspectRatio: "16 / 9",
													}}
												/>
											</div>
											{/* biome-ignore lint/a11y/useMediaCaption: <explanation> */}
											<audio
												ref={audioRef}
												className="hidden"
												onPlay={() => setIsPlaying(true)}
												onPause={() => setIsPlaying(false)}
											>
												<source
													src={audioUrl}
													type="audio/wav"
												/>
											</audio>
										</div>
									</div>
									)}
								</div>
							</div>
							<div className="w-full h-full grid grid-cols-1 grid-rows-12 gap-2">
								<div className="row-span-full w-full h-full border border-white/10 rounded-xl p-4 flex flex-col gap-6 max-h-full overflow-auto">
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Pitch
										</h2>
										<div className="flex gap-0 justify-center items-center">
											<input
												aria-label="Set pitch"
												type="number"
												value={pitch}
												onChange={(e) => {
													let value = Number.parseFloat(e.target.value);
													if (value < -24) value = -24;
													if (value > 24) value = 24;
													setPitch(value);
												}}
												step="0.1"
												min="-24"
												max="24"
												className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
											/>
											<input
												aria-label="Set pitch"
												value={pitch}
												onChange={(e) => setPitch(Number(e.target.value))}
												type="range"
												defaultValue="0"
												min="-24"
												max="24"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Set the pitch of the audio. Higher values result in a
											higher pitch.
										</p>
									</div>
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Index Rate
										</h2>
										<div className="flex gap-2 justify-center items-center">
											<input
												aria-label="Set index rate"
												type="number"
												value={indexRate}
												onChange={(e) => {
													let value = Number.parseFloat(e.target.value);
													if (value < 0) value = 0;
													if (value > 1) value = 1;
													setIndexRate(value);
												}}
												step="0.01"
												min="0.0"
												max="1.0"
												className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
											/>
											<input
												aria-label="Set index rate"
												value={indexRate}
												onChange={(e) => setIndexRate(Number(e.target.value))}
												type="range"
												defaultValue="0.3"
												min="0.0"
												max="1.0"
												step="0.1"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Control the influence of the index file on the output.
											Higher values mean stronger influence. Lower values can
											help reduce artifacts but may result in less accurate
											voice cloning.
										</p>
									</div>
									<div className="flex flex-col gap-2">
										<h2 className="text-neutral-200 text-lg font-medium">
											Filter Radius
										</h2>
										<div className="flex gap-2 justify-center items-center">
											<input
												aria-label="Set filter radius"
												type="number"
												value={filterRadius}
												onChange={(e) => {
													let value = Number.parseFloat(e.target.value);
													if (value < 0) value = 0;
													if (value > 10) value = 10;
													setFilterRadius(value);
												}}
												step="1"
												min="0"
												max="10"
												className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
											/>
											<input
												aria-label="Set filter radius"
												value={filterRadius}
												onChange={(e) =>
													setFilterRadius(Number(e.target.value))
												}
												type="range"
												defaultValue="3"
												min="0"
												max="10"
												className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
											/>
										</div>
										<p className="text-xs text-neutral-300">
											Apply median filtering to the extracted pitch values if
											this value is greater than or equal to three. This can
											help reduce breathiness in the output audio.
										</p>
									</div>
									<div className="flex flex-col mt-8">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Autotune
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<input
														aria-label="Set autotune"
														checked={autotune}
														onChange={(e) => setAutotune(e.target.checked)}
														type="checkbox"
														className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
														id="check"
													/>
													<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															className="h-3.5 w-3.5"
															viewBox="0 0 20 20"
															fill="currentColor"
															stroke="currentColor"
															strokeWidth="1"
															aria-label="Checkmark"
															aria-hidden="true"
														>
															<path
																fill-rule="evenodd"
																d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
																clip-rule="evenodd"
															/>
														</svg>
													</span>
												</label>
											</div>
										</div>
										<p className="text-xs text-neutral-300">
											Apply a light autotune to the inferred audio. Particularly
											useful for singing voice conversions.
										</p>
									</div>
									<div className="flex flex-col">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Clean audio
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<input
														aria-label="Set clean audio"
														checked={cleanAudio}
														onChange={(e) => setCleanAudio(e.target.checked)}
														type="checkbox"
														className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
														id="check"
													/>
													<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															className="h-3.5 w-3.5"
															viewBox="0 0 20 20"
															fill="currentColor"
															stroke="currentColor"
															strokeWidth="1"
															aria-label="Checkmark"
															aria-hidden="true"
														>
															<path
																fill-rule="evenodd"
																d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
																clip-rule="evenodd"
															/>
														</svg>
													</span>
												</label>
											</div>
										</div>
										<p className="text-xs text-neutral-300">
											Clean the output audio using noise reduction algorithms.
											Recommended for speech conversions.
										</p>
									</div>
									<div className="flex flex-col">
										<div className="flex justify-between items-center w-full">
											<h2 className="text-neutral-200 text-lg font-medium">
												Export format
											</h2>
											<div className="inline-flex items-center">
												<label className="flex items-center cursor-pointer relative">
													<select
														aria-label="Set export format"
														defaultValue={exportFormat}
														onChange={(e) => setExportFormat(e.target.value)}
														className="h-8 w-fit flex items-center justify-center text-end px-4 cursor-pointer transition-all appearance-none rounded-lg shadow-sm hover:shadow-md border border-slate-300 bg-white text-slate-700 focus:outline-none focus:border-slate-400"
													>
														<option value="WAV">WAV</option>
														<option value="MP3">MP3</option>
													</select>
													<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
														<svg
															xmlns="http://www.w3.org/2000/svg"
															className="h-3.5 w-3.5"
															viewBox="0 0 20 20"
															fill="currentColor"
															stroke="currentColor"
															strokeWidth="1"
															aria-label="Checkmark"
															aria-hidden="true"
														>
															<path
																fill-rule="evenodd"
																d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
																clip-rule="evenodd"
															/>
														</svg>
													</span>
												</label>
											</div>
										</div>
										<p className="text-xs text-neutral-300">
											Select the desired output audio format.
										</p>
									</div>
								</div>
								{(status || info) && (
									<div
										className={`min-h-fit w-full h-full border border-white/20 rounded-xl p-4 flex justify-between items-center ${
											error ? "bg-red-500/10" : ""
										}`}
									>
										<div>
											<p className="font-medium">{info}</p>
											{!status.includes("completed") && (
												<p className="text-sm text-neutral-300 max-w-3xl truncate">
													{status}
												</p>
											)}
											{error && (
												<p className="text-neutral-400 text-xs mt-1">
													Maybe you have done something wrong?{" "}
													<button
														aria-label="Check the docs"
														className="text-neutral-300 hover:underline"
														type="button"
														onClick={openDocs}
													>
														Check the docs
													</button>
													.
												</p>
											)}
										</div>
										<div className="justify-start mb-auto flex">
											<p className="text-sm text-neutral-400">
												{convertTime || 0}s
											</p>
										</div>
									</div>
								)}
								{info.includes("completed!") && output && (
									<div className="w-full h-[10svh] flex gap-2">
										<div className="w-full border border-white/20 rounded-xl pl-4 h-18 flex justify-between items-center gap-4">
											<div className="flex justify-start items-center">
												<button
													type="button"
													className="w-full h-full"
													onClick={togglePlayPause}
													aria-label="Toggle play/pause"
												>
													{isPlaying ? (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z"
																clipRule="evenodd"
															/>
														</svg>
													) : (
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="currentColor"
															className="w-5 h-5"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
																clipRule="evenodd"
															/>
														</svg>
													)}
												</button>
											</div>
											<div className="aspect-video w-full max-w-full max-h-[10svh] overflow-hidden flex items-center gap-4">
												<AudioVisualizer
													aria-label="Audio visualizer"
													ref={visualizerRef}
													blob={output}
													width={500}
													height={500}
													barWidth={1}
													gap={6}
													barColor="#22aa68"
													style={{
														height: "8svh",
														width: "100%",
														aspectRatio: "16 / 9",
													}}
												/>
											</div>
											{/* biome-ignore lint/a11y/useMediaCaption: <explanation> */}
											<audio
												ref={audioRef}
												className="hidden"
												onPlay={() => setIsPlaying(true)}
												onPause={() => setIsPlaying(false)}
											>
												<source
													src={URL.createObjectURL(output)}
													type="audio/wav"
												/>
											</audio>
										</div>
										{convertedAudio && (
											<div className="flex flex-col gap-2 h-full">
												<button
													aria-label="Open converted audio"
													className="border border-white/20 px-5 rounded-lg w-fit h-full flex items-center justify-center"
													type="button"
													onClick={() => downloadAudio(convertedAudio)}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														viewBox="0 0 24 24"
														fill="none"
														stroke="#ffffff"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
														className="w-6 h-6"
														aria-hidden="true"
													>
														<path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
													</svg>
												</button>
											</div>
										)}
									</div>
								)}
								<div className="relative group">
									{!uploaded && (
										<p className="absolute left-0 right-0 bottom-full mb-4 text-xs text-red-400 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
											First upload your audio!
										</p>
									)}
									{!currentModel && uploaded && (
										<p className="absolute left-0 right-0 bottom-full mb-4 text-xs text-red-400 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
											Select a model!
										</p>
									)}
									<button
										aria-label="Convert audio"
										className="min-h-12 w-full bg-white disabled:opacity-60 text-black rounded-xl h-full enabled:hover:bg-white/80 slow"
										type="button"
										disabled={!!status || !uploaded || !currentModel}
										onClick={convert}
									>
										Convert
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
