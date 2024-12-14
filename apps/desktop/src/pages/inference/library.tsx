import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Loading from "../../components/convert/loading";
import { FolderOpen, Minus, Plus, Trash } from "lucide-react";

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
				setInferences(["No inferences found"]);
				setLoading(false);
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
											aria-label="Search for inferences"
											type="text"
											className="col-span-5 w-full h-12 rounded-xl focus:outline-none bg-white/10 text-sm p-4"
											placeholder="Search..."
											value={value}
											onChange={(e) => setValue(e.target.value)}
										/>
										<button
											aria-label="Delete all inferences"
											onClick={deleteAllInferences}
											className="col-span-1 rounded-xl bg-white/10 p-2 text-sm text-neutral-200 hover:shadow-xl hover:shadow-red-500/10 hover:bg-red-500/20 slow"
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
												className="flex flex-col items-center mx-auto gap-2 w-full border border-white/10 rounded-xl p-4	"
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
														aria-label="Open inference details"
														type="button"
														className="rounded-lg border border-white/10 text-white p-2 flex items-center justify-center hover:bg-neutral-700/50 hover:shadow-xl hover:shadow-white/10 slow"
														onClick={() => toggleDropdown(inference.id)}
													>
														{openInferenceId === inference.id ? (
															<Minus className="w-6 h-6 opacity-70"/>
														) : (
															<Plus className="w-6 h-6 opacity-70"/>
														)}
													</button>
													<button
														aria-label="Open converted audio"
														type="button"
														className="rounded-lg border border-white/10 text-white p-3 flex items-center justify-center hover:bg-neutral-700/50 hover:shadow-xl hover:shadow-white/10 slow"
														onClick={() =>
															downloadAudio(inference.audio_output)
														}
													>
														<FolderOpen className="w-5 h-5 opacity-70"/>
													</button>
													<button
														aria-label="Delete inference"
														type="button"
														className="rounded-lg border border-white/10 text-white p-3 flex items-center justify-center hover:bg-red-700/20 hover:shadow-xl hover:shadow-red-700/10 slow"
														onClick={() => deleteInference(inference.id)}
													>
														<Trash className="w-4 h-4 opacity-70"/>
													</button>
												</div>
												{openInferenceId === inference.id && (
													<div className="mt-4 w-full bg-white/10 p-4 rounded-xl">
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
