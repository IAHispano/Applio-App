import { useConvert, useConvertContext } from "../../components/convert/conversion-context";
import { open } from "@tauri-apps/plugin-shell";
import ConversionOptions from "../../components/convert/conversion-options";
import ConversionModel from "../../components/convert/conversion-model";
import AudioSelector from "../../components/convert/audio/audio-selector";
import { FolderOpen } from "lucide-react";
import AudioPlayer from "../../components/convert/audio/audio-player/audio-player";

export default function Convert() {
	const {
		uploaded,
		info,
		status,
		error,
		output,
		convertedAudio,
		convertTime,
		currentModel
	} = useConvertContext();
	const { convert } = useConvert();

	const downloadAudio = async (path: string) => {
		const lastSlashIndex = path.lastIndexOf("\\");
		const pathWithoutFile = path.substring(0, lastSlashIndex);

		open(pathWithoutFile);
	};

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-end justify-center mt-6 w-full overflow-auto">
				<div className="flex gap-4 w-full h-full p-4 pb-4">
					<div className="col-span-3 row-span-2 rounded-xl w-full h-full">
						<div className="flex gap-2 w-full h-full rounded-xl">
							<div className="grid grid-cols-1 grid-rows-3 gap-2 w-full max-w-[40svh] h-full">
								<ConversionModel />
								<AudioSelector />
							</div>
							<div className="w-full h-full flex flex-col">
								<div className="row-span-full w-full h-full gap-2 grid grid-cols-1 grid-rows-12">
								<ConversionOptions />
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
														onClick={() => open("https://docs.applio.org")}
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
									<div className="w-full h-full flex gap-2">
										{convertedAudio && (
											<div className="flex gap-2 h-full w-full justify-center items-center">
												<div className="w-full h-full">
												<AudioPlayer audioBlob={output} />
												</div>
												<button
													aria-label="Open converted audio"
													className="border border-white/10 rounded-lg w-14 h-full flex items-center justify-center"
													type="button"
													onClick={() => downloadAudio(convertedAudio)}
												>
													<FolderOpen className="w-5 h-5 opacity-80" />
												</button>
											</div>
										)}
									</div>
								)}
								</div>
								<div className="relative group mt-2">
									{!uploaded &&!convertedAudio && (
										<p className="absolute left-0 right-0 bottom-full mb-4 text-xs text-red-400 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
											First upload your audio!
										</p>
									)}
									{!currentModel && !convertedAudio && uploaded && (
										<p className="absolute left-0 right-0 bottom-full mb-4 text-xs text-red-400 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
											Select a model!
										</p>
									)}
									{!convertedAudio && (
									<button
										aria-label="Convert audio"
										className="min-h-12 w-full bg-white disabled:opacity-60 text-black rounded-xl h-full enabled:hover:bg-white/80 slow"
										type="button"
										disabled={!!status || !uploaded || !currentModel}
										onClick={convert}
									>
										Convert
									</button>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
