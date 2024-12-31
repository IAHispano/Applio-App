import { useEffect } from "react";
import { getServerPort } from "../../utils/getBackendPort";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import Loading from "../convert/loading";
import AudioPlayer from "../convert/audio/audio-player/audio-player";
import { ChevronDown, ChevronDownIcon, RotateCcw } from "lucide-react";
import { useUVR } from "./uvrcontext";
import { Store } from "@tauri-apps/plugin-store";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

interface UVRProps {
	getAudios: () => void;
}

export default function UVR({}: UVRProps) {
	const {
		inputDir,
		file,
		uploaded,
		UVRLoading,
		UVRStatus,
		UVRError,
		UVRLink,
		isOpen,
		stemIsOpen,
		selectedStem,
		selectedModel,
		sampleRate,
		models,
		loadingModels,
		search,
		stemOptions,
		setInputDir,
		setFile,
		setUploaded,
		setIsOpen,
		setStemIsOpen,
		setSelectedStem,
		setSelectedModel,
		setSampleRate,
		setModels,
		setLoadingModels,
		setSearch,
		handleReset,
	} = useUVR();

	const { handleSeparateInstrumental } = useUVR();

	useEffect(() => {
		const getInputDir = async () => {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/get-input-dir`);
			const data = await response.text();
			console.log(data);
			setInputDir(data);
		};

		getInputDir();
	}, []);

	useEffect(() => {
		async function getUVRModels() {
			try {
				const port = await getServerPort();
				const response = await fetch(`http://localhost:${port}/get-uvr-models`);

				if (response.ok) {
					const data = await response.json();

					setModels(data);
					console.log("response:", data);
					setLoadingModels(false);
				} else {
					console.error("Error fetching models:", response.statusText);
				}
			} catch (error) {
				console.error("Fetch error:", error);
			}
		}

		getUVRModels();
	}, []);

	const handleSelectFile = async () => {
		const file = await dialogOpen({
			directory: false,
			multiple: false,
			defaultPath: inputDir,
			filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "webm"] }],
		});
		if (file) {
			console.log(file);
			setFile(file);
			setUploaded(true);
		}
	};

	const shouldAnimate = async () => {
		const store = await Store.load("settings.json");
		const shouldAnimate = await store.get("animateTours");
		if (shouldAnimate === undefined) {
			store.set("animateTours", true);
			await store.save();
			return true;
		}
		return shouldAnimate;
	};

	// uvr tour
	const tour = async () => {
		const shouldAnimateOption = await shouldAnimate();
		console.log("shouldAnimateOption", shouldAnimateOption);
		const driverObj = driver({
			disableActiveInteraction: true,
			smoothScroll: true,
			animate: shouldAnimateOption as boolean,
			steps: [
				{
					element: "#UVR",
					popover: {
						title: "Introducing Vocal Remover",
						description:
							"In this new version we have added a section to remove vowels from an audio. Follow this guide to learn more about it!",
					},
				},
				{
					element: "#UVRSelectAudio",
					popover: {
						title: "Upload your audio",
						description: "Upload your audio file to start the process.",
					},
				},
				{
					element: "#UVRSelectModel",
					popover: {
						title: "Select a model",
						description:
							"Select a model to use for separating the instrumental.",
					},
				},
				{
					element: "#UVRSeparateButton",
					popover: {
						title: "Separate instrumental",
						description: "Click the Separate button to start the process.",
					},
				},
			],
		});

		driverObj.drive();
	};

	useEffect(() => {
		const showTour = async () => {
			const store = await Store.load("tours.json");
			const showTour = await store.get("shouldShowUVR");
			if (showTour === true || showTour === undefined) {
				console.log("Tour started");
				tour();
				store.set("shouldShowUVR", false);
				await store.save();
			} else {
				console.log("Tour skipped");
			}
			console.log("showTour", showTour);
		};

		const shouldShowTours = async () => {
			const store = await Store.load("settings.json");
			const showTour = await store.get("tours");
			if (showTour === undefined) {
				store.set("tours", true);
				store.set("animateTours", true);
				await store.save();
				return true;
			}

			return showTour;
		};

		if (loadingModels === false) {
			shouldShowTours().then((shouldShow) => {
				if (shouldShow) {
					showTour();
				}
			});
		}
	}, [!loadingModels]);

	return (
		<div
			className="border border-white/10 h-full rounded-xl p-4 overflow-auto"
			id="UVR"
		>
			<div className="flex justify-between items-center m-auto mb-4">
				<div className="flex items-center justify-start">
					<h2 className="text-neutral-200 text-xl">Vocal remover</h2>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleReset}
						className="p-2 rounded-xl border border-white/10 hover:bg-white/10 slow w-10 h-8 flex items-center justify-center"
					>
						<RotateCcw className="w-4 h-4 opacity-70" />
					</button>
					<div className="flex items-center w-14 h-8 px-4 py-1 justify-center rounded-xl bg-orange-500/10 shadow-xl shadow-orange-500/10">
						<p className="text-sm text-neutral-300">Beta</p>
					</div>
				</div>
			</div>
			{loadingModels && (
				<div className="w-full h-28 flex flex-col justify-center items-center">
					<Loading />
					<p className="text-neutral-400 text-xs">Loading models...</p>
				</div>
			)}
			{!loadingModels && (
				<div className="flex flex-col gap-4">
					<button
						id="UVRSelectAudio"
						disabled={!!file}
						onClick={handleSelectFile}
						type="button"
						className="w-full h-24 bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl relative"
					>
						<div className="flex justify-center items-center m-auto h-full">
							{uploaded ? (
								<p className="text-neutral-300 max-w-sm truncate text-xs">
									{file}
								</p>
							) : (
								<p className="text-neutral-300">Select your audio</p>
							)}
						</div>
					</button>
					<div id="UVRSelectModel" className="relative">
						<div className="flex flex-col gap-0.5 mb-4">
							<h1 className="text-neutral-300 text-sm font-semibold">
								Select a model
							</h1>
							<p className="text-neutral-400 text-xs">
								Select the model you want to use for separating the instrumental
							</p>
							<div className="h-0.5 bg-white/10 rounded-full w-full mt-2" />
						</div>
						<button
							type="button"
							onClick={() => setIsOpen(!isOpen)}
							className={`w-full h-12 bg-white/10 rounded-xl px-4 text-${selectedModel ? "neutral-300" : "neutral-400"} text-sm focus:outline-none flex items-center justify-between`}
						>
							{selectedModel || "Select a model"}
							<ChevronDownIcon
								className={`w-4 h-4 transition-transform ${stemIsOpen ? "rotate-180" : ""}`}
							/>
						</button>
						<div className="h-fit w-full rounded-xl bg-orange-500/10 p-4 my-2 shadow-orange-500/10 shadow-lg">
							<h1 className="text-sm text-neutral-300 title font-medium">
								DEMUCS models are not available
							</h1>
							<p className="text-neutral-400 text-xs">
								We are working to bring them back, sorry for the inconvenience
							</p>
						</div>
						<div className="overflow-hidden">
							{isOpen && (
								<div className="flex flex-col w-full mt-2 bg-white/10 rounded-xl shadow-lg overflow-auto max-h-96">
									<div className="last:mb-0 mb-4">
										<div className="border-white/20 rounded-xl">
											<input
												type="text"
												value={search}
												onChange={(e) => setSearch(e.target.value)}
												className="w-full px-4 py-2 text-left text-sm text-neutral-300 bg-white/10 rounded-t-xl focus:outline-none relative"
												placeholder="Search models..."
											/>
										</div>
									</div>
									{Object.entries(models).map(([category, modelList]) => {
										const filteredModels = modelList.filter((model: string) =>
											model.toLowerCase().includes(search.toLowerCase()),
										);
										return (
											filteredModels.length > 0 && (
												<div key={category} className="mb-4 last:mb-0">
													<div className="px-4 py-2 uppercase title text-sm font-semibold text-neutral-300 bg-white/10">
														{category}
													</div>
													<div className="ml-4 pl-4 border-l border-white/20">
														{filteredModels.map(
															(model: string, index: number) => (
																<div
																	key={`${category}-${index}`}
																	className="relative"
																>
																	{index > 0 && (
																		<div className="absolute top-0 left-0 h-1/2 border-l border-white/20" />
																	)}
																	<button
																		onClick={() => {
																			setSelectedModel(model);
																			setIsOpen(false);
																		}}
																		className="w-full px-4 py-2 text-left text-sm text-neutral-300 hover:bg-white/10 relative"
																	>
																		<span className="absolute left-0 top-1/2 w-4 border-t border-white/20"></span>
																		{model}
																	</button>
																	{index < filteredModels.length - 1 && (
																		<div className="absolute bottom-0 left-0 h-1/2 border-l border-white/20" />
																	)}
																</div>
															),
														)}
													</div>
												</div>
											)
										);
									})}
									{Object.values(models).every(
										(modelList) =>
											modelList.filter((model: string) =>
												model.toLowerCase().includes(search.toLowerCase()),
											).length === 0,
									) && (
										<p className="text-neutral-400 text-xs text-center pb-2">
											No models found
										</p>
									)}
								</div>
							)}
						</div>
					</div>
					<div className="flex flex-col gap-0.5 mt-4">
						<h1 className="text-neutral-300 text-sm font-semibold">Options</h1>
						<p className="text-neutral-400 text-xs">
							Customize the separation process with these options
						</p>
						<div className="h-0.5 bg-white/10 rounded-full w-full mt-2" />
					</div>
					<div className="relative w-full">
						<div className="mb-2 flex flex-col px-0.5">
							<h3 className="text-neutral-300 text-xs">Stem removal</h3>
							<p className="text-neutral-400 text-xs">
								Output only single stem
							</p>
						</div>
						<button
							onClick={() => setStemIsOpen(!stemIsOpen)}
							className="flex items-center justify-between w-full px-4 py-2 text-sm text-neutral-300 bg-white/10 rounded-xl"
						>
							{selectedStem || "Stem removal"}
							<ChevronDown
								className={`w-4 h-4 transition-transform ${stemIsOpen ? "rotate-180" : ""}`}
							/>
						</button>
						{stemIsOpen && (
							<div className="flex flex-col w-full mt-2 bg-white/10 rounded-xl shadow-lg overflow-auto max-h-96">
								<div className="ml-4 pl-4 border-l border-white/20">
									{stemOptions.map((option, index) => (
										<div key={option} className="relative">
											{index > 0 && (
												<div className="absolute top-0 left-0 h-1/2 border-l border-white/20" />
											)}
											<button
												onClick={() => {
													setSelectedStem(option);
													setStemIsOpen(false);
												}}
												className="w-full px-4 py-2 text-left text-sm text-neutral-300 hover:bg-white/10 relative"
											>
												<span className="absolute left-0 top-1/2 w-4 border-t border-white/20"></span>
												{option}
											</button>
											{index < stemOptions.length - 1 && (
												<div className="absolute bottom-0 left-0 h-1/2 border-l border-white/20" />
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</div>
					<div>
						<div className="mb-2 flex flex-col px-0.5">
							<h3 className="text-neutral-300 text-xs">Sample rate</h3>
							<p className="text-neutral-400 text-xs">
								Modify the sample rate of the output audio
							</p>
						</div>
						<input
							type="number"
							min="8000"
							max="192000"
							value={sampleRate}
							onChange={(e) =>
								setSampleRate(e.target.value as unknown as number)
							}
							className="w-full px-4 py-2 text-left text-sm text-neutral-300 bg-white/10 rounded-xl focus:outline-none relative"
						/>
					</div>
					<button
						id="UVRSeparateButton"
						onClick={handleSeparateInstrumental}
						type="button"
						disabled={!!UVRLoading || !file}
						className="disabled:cursor-not-allowed disabled:shadow-inner w-full text-neutral-300 text-sm h-12 bg-white/10 enabled:bg-white/20 rounded-xl mt-4 enabled:hover:bg-white/30 slow"
					>
						Separate instrumental
					</button>
					{UVRLoading && (
						<div className="flex flex-col gap-2 w-full mt-auto justify-end items-center">
							{UVRStatus && (
								<p className="text-xs text-neutral-300/50 my-2 px-1 w-full py-2 rounded-xl text-center">
									{UVRStatus}
								</p>
							)}
							<div className="relative w-full h-fit my-6 flex justify-center items-center">
								<Loading />
							</div>
						</div>
					)}
					{UVRError && (
						<p className="text-xs text-white/50 my-2 py-2 px-1 bg-red-500/10 rounded-xl text-center">
							Error detected, see the logs for more information.
						</p>
					)}
					{UVRStatus.includes("Completed") && UVRLink && (
						<div className="w-full h-44 bg-neutral-600/50 rounded-xl relative mt-4 flex items-center p-4">
							<AudioPlayer audioBlob={UVRLink} />
						</div>
					)}
				</div>
			)}
		</div>
	);
}
