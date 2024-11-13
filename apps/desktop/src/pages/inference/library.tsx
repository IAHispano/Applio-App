import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import Loading from "../../components/convert/loading";
import { useNavigate } from "react-router-dom";

export default function InferencesLibrary() {
	const [inferences, setInferences] = useState<any[]>([]);
	const [openInferenceId, setOpenInferenceId] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [value, setValue] = useState("");
	const navigate = useNavigate();

	async function getServerPort() {
		const port = await invoke("get_port");
		return port;
	}

	useEffect(() => {
		async function getInferences() {
			const port = await getServerPort();
			const response = await fetch(`http://localhost:${port}/get-inferences`);

			if (response.ok) {
				const data = await response.json();
				setInferences(data);
				console.log("data", data);
				console.log(data);
				setLoading(false);
			} else {
				console.log("Error fetching inferences");
			}
		}

		getInferences();
	}, []);

	const toggleDropdown = (id: number) => {
		setOpenInferenceId((prevId) => (prevId === id ? null : id));
	};

	const downloadAudio = async (path: string) => {
		open(path);
	};

	const deleteInference = async (id: number) => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-inference?id=${encodeURIComponent(id)}`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					console.log(data);
					setInferences(inferences.filter((item: any) => item.id !== id));
				} else {
					console.error("Error deleting inference:", data.message);
				}
			} else {
				console.error("Error deleting inference:", response.statusText);
			}
		} catch (error) {
			console.error("Error deleting inference:", error);
		}
	};

	const deleteAllInferences = async () => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-all-inferences`,
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

	const filteredData = value
		? inferences.filter((inference) =>
				inference.model_name.toLowerCase().includes(value.toLowerCase()),
			)
		: inferences;

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-center justify-start mt-10 mb-4 px-4 w-full overflow-auto">
				<div className="border border-white/10 rounded-xl p-4 w-full h-full flex flex-col gap-4 overflow-auto">
					{loading ? (
						<Loading />
					) : (
						<>
							{inferences.includes("No inferences found") ? (
								<div className="flex flex-col items-center justify-center w-full h-full">
									<h1 className="text-center text-sm text-neutral-400">
										No inferences found
									</h1>
								</div>
							) : (
								<div className="flex flex-col items-center w-full h-full gap-4">
									<div className="grid grid-cols-6 gap-4 w-full">
										<input
											type="text"
											className="col-span-5 w-full h-12 rounded-xl focus:outline-none bg-[#111111]/20 text-sm p-4"
											placeholder="Search..."
											value={value}
											onChange={(e) => setValue(e.target.value)}
										/>
										<button
											onClick={deleteAllInferences}
											className="col-span-1 rounded-xl bg-[#111111]/20 p-2 text-sm text-neutral-200 hover:shadow-xl hover:shadow-red-500/10 hover:bg-red-500/20 slow"
											type="button"
										>
											Delete all inferences
										</button>
									</div>
									{filteredData.map(
										(inference: {
											id: number;
											model_name: string;
											converted_at: string;
											indexRate: number;
											filterRadius: number;
											autotune: boolean;
											cleanaudio: boolean;
											exportformat: string;
											audio_output: string;
										}) => (
											<div
												key={inference.id}
												className="flex flex-col items-center mx-auto gap-2 w-full border border-white/10 rounded-xl p-4 bg-neutral-700/50"
											>
												<div className="flex flex-row gap-2 w-full">
													<div className="flex flex-col w-full">
														<h1 className="text-2xl font-semibold title truncate max-w-3xl">
															{decodeURIComponent(inference.model_name)}
														</h1>
														<p className="text-[10px] px-0.5 text-neutral-400">
															{new Date(
																inference.converted_at,
															).toLocaleDateString("en-US", {
																year: "numeric",
																month: "short",
																day: "2-digit",
															})}{" "}
															-{" "}
															{new Date(
																inference.converted_at,
															).toLocaleTimeString("en-US", {
																hour: "2-digit",
																minute: "2-digit",
															})}
														</p>
													</div>
													<button
														type="button"
														className="rounded-lg border border-white/10 text-black p-2 flex items-center justify-center hover:bg-neutral-700/50 hover:shadow-xl hover:shadow-white/10 slow"
														onClick={() => toggleDropdown(inference.id)}
													>
														{openInferenceId === inference.id ? (
															<svg
																aria-hidden="true"
																className="w-6 h-6 opacity-70"
																viewBox="0 0 24 24"
																fill="none"
																xmlns="http://www.w3.org/2000/svg"
															>
																<g id="SVGRepo_iconCarrier">
																	<path
																		d="M6 12H18"
																		stroke="#ffffff"
																		stroke-width="2"
																		stroke-linecap="round"
																		stroke-linejoin="round"
																	/>
																</g>
															</svg>
														) : (
															<svg
																aria-hidden="true"
																className="w-6 h-6 opacity-70"
																viewBox="0 0 24 24"
																fill="none"
																xmlns="http://www.w3.org/2000/svg"
															>
																<g id="SVGRepo_iconCarrier">
																	<path
																		d="M6 12H18M12 6V18"
																		stroke="#ffffff"
																		stroke-width="2"
																		stroke-linecap="round"
																		stroke-linejoin="round"
																	/>
																</g>
															</svg>
														)}
													</button>
													<button
														type="button"
														className="rounded-lg border border-white/10 text-black p-3 flex items-center justify-center hover:bg-neutral-700/50 hover:shadow-xl hover:shadow-white/10 slow"
														onClick={() =>
															downloadAudio(inference.audio_output)
														}
													>
														<svg
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="none"
															stroke="#ffffff"
															strokeWidth="2"
															strokeLinecap="round"
															strokeLinejoin="round"
															className="w-5 h-5 opacity-70"
															aria-hidden="true"
														>
															<path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
														</svg>
													</button>
													<button
														type="button"
														className="rounded-lg border border-white/10 text-black p-3 flex items-center justify-center hover:bg-red-700/20 hover:shadow-xl hover:shadow-red-700/10 slow"
														onClick={() => deleteInference(inference.id)}
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
												{openInferenceId === inference.id && (
													<div className="mt-4 w-full bg-neutral-800/50 p-4 rounded-xl">
														<table className="w-full text-sm text-left text-neutral-300">
															<thead>
																<tr>
																	<th className="px-4 py-2 text-sm font-semibold">
																		Property
																	</th>
																	<th className="px-4 py-2 text-sm font-semibold">
																		Value
																	</th>
																</tr>
															</thead>
															<tbody>
																<tr>
																	<td className="px-4 py-2">Index rate</td>
																	<td className="px-4 py-2">
																		{inference.indexRate}
																	</td>
																</tr>
																<tr>
																	<td className="px-4 py-2">Filter radius</td>
																	<td className="px-4 py-2">
																		{inference.filterRadius}
																	</td>
																</tr>
																<tr>
																	<td className="px-4 py-2">Autotune</td>
																	<td className="px-4 py-2">
																		{inference.autotune}
																	</td>
																</tr>
																<tr>
																	<td className="px-4 py-2">Clean audio</td>
																	<td className="px-4 py-2">
																		{inference.cleanaudio}
																	</td>
																</tr>
																<tr>
																	<td className="px-4 py-2">Export format</td>
																	<td className="px-4 py-2">
																		{inference.exportformat}
																	</td>
																</tr>
															</tbody>
														</table>
													</div>
												)}
											</div>
										),
									)}
								</div>
							)}
						</>
					)}
				</div>
			</main>
		</div>
	);
}
