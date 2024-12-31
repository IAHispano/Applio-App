import { getServerPort } from "../../utils/getBackendPort";
import { ArrowRight, FolderOpen, Trash } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import Loading from "../convert/loading";
import { useEffect, useState } from "react";

interface SelectAudioProps {
	selectAudio: string | undefined;
	setSelectedAudio: React.Dispatch<React.SetStateAction<string | undefined>>;
	handleUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
	uploadAudioFileInLibrary: (file: string) => Promise<void>;
}

export default function SelectAudio({
	uploadAudioFileInLibrary,
	handleUpload,
	selectAudio,
	setSelectedAudio,
}: SelectAudioProps) {
	const [audios, setAudios] = useState<
		{
			file_name: string;
			file_path: string;
			title: string;
			creation_time: number;
			modification_time: number;
			file_size: number;
			duration?: number;
		}[]
	>([]);
	const [filteredAudios, setFilteredAudios] = useState<typeof audios>([]);
	const [searchTerm, setSearchTerm] = useState("");
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);

	const getAudios = async () => {
		setLoading(true);
		const port = await getServerPort();
		const response = await fetch(`http://localhost:${port}/get-input-audios`);
		const data = await response.json();
		if (response.ok) {
			if (data.length === 0) {
				setLoading(false);
				setNotFound(true);
			} else {
				setLoading(false);
				setAudios(data);
				setFilteredAudios(data);
			}
		} else {
			setLoading(false);
			setNotFound(true);
		}
	};

	useEffect(() => {
		getAudios();
	}, []);

	useEffect(() => {
		getAudios();
	}, [handleUpload]);

	useEffect(() => {
		const filtered = audios.filter((audio) =>
			audio.title.toLowerCase().includes(searchTerm.toLowerCase()),
		);
		setFilteredAudios(filtered);
		setNotFound(filtered.length === 0);
	}, [searchTerm, audios]);

	const deleteAllAudios = async () => {
		const port = await getServerPort();
		const response = await fetch(
			`http://localhost:${port}/delete-all-input-audios`,
		);
		if (response.ok) {
			setNotFound(true);
			setAudios([]);
			setFilteredAudios([]);
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
		<div className="flex flex-col mx-auto justify-start items-start w-full h-full gap-4 rounded-xl">
			<div className="flex w-full justify-between items-center overflow-visible">
				{selectAudio ? (
					<h2 className="text-neutral-200 text-xl title font-semibold">
						Change audio
					</h2>
				) : (
					<h2 className="text-neutral-200 text-xl title font-semibold">
						Select an audio
					</h2>
				)}
				<div className="flex gap-2">
					{selectAudio && (
						<div
							className="flex w-fit h-full rounded-xl p-2 bg-white/10 hover:bg-white/20 slow cursor-pointer shadow-xl shadow-white/20 border border-white/20 overflow-visible"
							onClick={() => uploadAudioFileInLibrary(selectAudio as string)}
						>
							<ArrowRight className="w-4 h-4 opacity-80" />
						</div>
					)}
					<label
						htmlFor="audio-upload"
						className="cursor-pointer h-full w-fit text-xs px-4 hover:bg-white/10 p-2 rounded-xl border border-white/10 hover:shadow-xl slow"
					>
						Upload a new audio
					</label>
					<input
						id="audio-upload"
						type="file"
						accept="audio/*"
						onChange={handleUpload}
						className="hidden"
					/>
				</div>
			</div>
			<div className="w-full flex gap-4 h-full mb-4 max-h-10">
				<input
					className="w-full h-full px-4 rounded-lg bg-white/10 focus:outline-none text-sm text-neutral-200 mb-4"
					placeholder="Write here for search..."
					type="text"
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
				/>
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
			<div className="grid grid-cols-2 gap-4">
				{filteredAudios
					.sort((a, b) => b.creation_time - a.creation_time)
					.map((audio, index) => (
						<div
							key={index}
							className={`flex flex-col gap-3 w-full p-4 pb-2 border border-white/10 rounded-xl transition-shadow duration-300 hover:bg-white/10 hover:shadow-xl slow cursor-pointer ${audio.file_path === selectAudio ? "bg-white/10" : ""}`}
							onClick={() => setSelectedAudio(audio.file_path)}
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
							<p className="text-neutral-400 text-[9px] font-mono break-all max-w-sm w-full">
								{audio.file_path}
							</p>
							<p className="text-neutral-400 text-[10px] flex justify-end w-full">
								{new Date(audio.creation_time * 1000).toLocaleString()}
							</p>
						</div>
					))}
			</div>
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
