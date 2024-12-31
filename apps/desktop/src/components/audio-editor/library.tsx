import { getServerPort } from "../../utils/getBackendPort";
import { FolderOpen, Trash } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import Loading from "../convert/loading";

interface LibraryProps {
	getAudios: () => void;
	setNotFound: React.Dispatch<React.SetStateAction<boolean>>;
	setAudios: React.Dispatch<React.SetStateAction<any[]>>;
	audios: {
		file_name: string;
		file_path: string;
		title: string;
		creation_time: number;
		modification_time: number;
		file_size: number;
		duration?: number;
	}[];
	loading: boolean;
	notFound: boolean;
}

export default function MyAudiosLibrary({
	getAudios,
	setNotFound,
	setAudios,
	audios,
	loading,
	notFound,
}: LibraryProps) {
	const deleteAllAudios = async () => {
		const port = await getServerPort();
		const response = await fetch(
			`http://localhost:${port}/delete-all-input-audios`,
		);
		if (response.ok) {
			setNotFound(true);
			setAudios([]);
		}
	};

	const downloadAudio = async (path: string) => {
		open(path);
	};

	const deleteAudio = async (id: string) => {
		const port = await getServerPort();
		const response = await fetch(
			`http://localhost:${port}/delete-input-audio?id=${encodeURIComponent(id)}`,
		);
		if (response.ok) {
			getAudios();
		}
	};

	return (
		<div className="flex flex-col mx-auto justify-start items-start w-full h-full p-4 gap-4 border border-white/10 rounded-xl overflow-auto scrollable">
			<div className="flex w-full justify-between items-start">
				<h2 className="text-neutral-200 text-xl">Your audios</h2>
				{audios.length > 0 && (
					<button
						type="button"
						onClick={deleteAllAudios}
						className="flex justify-center items-center bg-red-500/10 p-3 rounded-full hover:bg-red-500/20 slow text-sm"
					>
						<Trash className="w-4 h-4 opacity-70" />
					</button>
				)}
			</div>
			{audios
				.sort((a, b) => b.creation_time - a.creation_time)
				.map((audio, index) => (
					<div
						key={index}
						className="flex flex-col gap-3 w-full p-4 border border-white/10 rounded-xl transition-shadow duration-300"
					>
						<div className="flex justify-between items-center gap-5">
							<h3 className="text-neutral-200 title font-semibold text-lg truncate">
								{audio.title}
							</h3>
							<div className="flex gap-2">
								<button
									className="p-2 rounded-xl border-white/10 hover:bg-white/10 border transition-colors duration-200"
									type="button"
									onClick={() => downloadAudio(audio.file_path)}
									aria-label="Download audio"
								>
									<FolderOpen className="w-4 h-4 opacity-70" />
								</button>
								<button
									type="button"
									onClick={() => deleteAudio(audio.file_path)}
									className="p-2 rounded-xl border-white/10 hover:bg-red-500/10 border transition-colors duration-200"
									aria-label="Delete audio"
								>
									<Trash className="w-4 h-4 opacity-70" />
								</button>
							</div>
						</div>
						<p className="text-neutral-400 text-[9px] font-mono select-all break-all max-w-sm w-full">
							{audio.file_path}
						</p>
						<p className="text-neutral-400 text-[10px] flex justify-end w-full">
							{new Date(audio.creation_time * 1000).toLocaleString()}
						</p>
					</div>
				))}
			{loading && (
				<div className="relative w-full h-full">
					<Loading />
				</div>
			)}
			{notFound && (
				<div className="relative w-full h-full my-auto">
					<p className="text-center text-neutral-400 text-xs z-50 flex justify-center items-center h-full">
						No audios found
					</p>
				</div>
			)}
		</div>
	);
}
