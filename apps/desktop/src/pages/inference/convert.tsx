import {
	useConvert,
	useConvertContext,
} from "../../components/convert/conversion-context";
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
		currentModel,
	} = useConvertContext();
	const { convert } = useConvert();

	const downloadAudio = async (path: string) => {
		const lastSlashIndex = path.lastIndexOf("\\");
		const pathWithoutFile = path.substring(0, lastSlashIndex);
		await open(pathWithoutFile);
	};

	return (
		<div className="h-screen w-screen flex flex-col overflow-hidden pt-6">
			<main className="flex-1 p-4 overflow-hidden">
				<div className="h-full flex gap-4">
					<LeftPanel />
					<RightPanel
						status={status}
						info={info}
						error={error}
						convertTime={convertTime}
						output={output}
						convertedAudio={convertedAudio}
						downloadAudio={downloadAudio}
						uploaded={uploaded}
						currentModel={currentModel}
						convert={convert}
					/>
				</div>
			</main>
		</div>
	);
}

function LeftPanel() {
	return (
		<div className="flex flex-col gap-2 w-[300px] min-w-[300px]">
			<ConversionModel />
			<AudioSelector />
		</div>
	);
}

interface RightPanelProps {
	status: string;
	info: string;
	error: boolean;
	convertTime: string;
	output: Blob | undefined;
	convertedAudio: string | undefined;
	downloadAudio: (path: string) => Promise<void>;
	uploaded: boolean;
	currentModel: string;
	convert: () => void;
}

function RightPanel({
	status,
	info,
	error,
	convertTime,
	output,
	convertedAudio,
	downloadAudio,
	uploaded,
	currentModel,
	convert,
}: RightPanelProps) {
	return (
		<div className="flex-1 flex flex-col h-full overflow-hidden">
			<div className="flex-1 flex flex-col overflow-hidden">
				<div className="flex-1 overflow-auto">
					<ConversionOptions />
				</div>
				<StatusInfo
					status={status}
					info={info}
					error={error}
					convertTime={convertTime}
				/>
				<ConvertedAudioPlayer
					info={info}
					output={output}
					convertedAudio={convertedAudio}
					downloadAudio={downloadAudio}
				/>
			</div>
			<ConvertButton
				uploaded={uploaded}
				convertedAudio={convertedAudio}
				currentModel={currentModel}
				status={status}
				convert={convert}
			/>
		</div>
	);
}

interface StatusInfoProps {
	status: string;
	info: string;
	error: boolean;
	convertTime: string;
}

function StatusInfo({ status, info, error, convertTime }: StatusInfoProps) {
	if (!(status || info)) return null;

	return (
		<div
			className={`max-h-24 mt-2 w-full h-full border border-white/20 rounded-xl p-4 flex justify-between items-center ${
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
				<p className="text-sm text-neutral-400">{convertTime || 0}s</p>
			</div>
		</div>
	);
}

interface ConvertedAudioPlayerProps {
	info: string;
	output: Blob | undefined;
	convertedAudio: string | undefined;
	downloadAudio: (path: string) => Promise<void>;
}

function ConvertedAudioPlayer({
	info,
	output,
	convertedAudio,
	downloadAudio,
}: ConvertedAudioPlayerProps) {
	if (!info.includes("completed!") || !output) return null;

	return (
		<div className="w-full h-full max-h-36 mt-2 flex gap-2">
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
	);
}

interface ConvertButtonProps {
	uploaded: boolean;
	convertedAudio: string | undefined;
	currentModel: string;
	status: string;
	convert: () => void;
}

function ConvertButton({
	uploaded,
	convertedAudio,
	currentModel,
	status,
	convert,
}: ConvertButtonProps) {
	if (convertedAudio) return null;

	return (
		<div className="relative group mt-2">
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
				className="min-h-12 w-full bg-white disabled:opacity-60 text-black rounded-xl h-full enabled:hover:bg-white/80 slow shadow-xl disabled:cursor-not-allowed"
				type="button"
				disabled={!!status || !uploaded || !currentModel}
				onClick={convert}
			>
				Convert
			</button>
		</div>
	);
}
