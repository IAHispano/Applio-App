import { useEffect, useState } from "react";
import { getServerPort } from "../../utils/getBackendPort";
import UVR from "../../components/audio-editor/uvr";
import MyAudiosLibrary from "../../components/audio-editor/library";
import AudioEditorComponent from "../../components/audio-editor/editor";
import { sendNotificationUtil } from "../../utils/sendNotification";

export default function AudioEditor() {
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [status, setStatus] = useState<string>("");
	const [error, setError] = useState<string>("");
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
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);
	const [page, setPage] = useState(1);

	const handleDownload = async () => {
		if (!audioUrl) {
			setError("Please enter an audio URL");
			return;
		}
		setStatus("Downloading...");
		sendNotificationUtil("Downloading audio", "Downloading audio...");
		const port = await getServerPort();
		const response = await fetch(
			`http://localhost:${port}/download-audio?link=${encodeURIComponent(audioUrl)}`,
		);
		console.log(response);

		if (response.ok) {
			setStatus("Audio downloaded successfully");
			getAudios();
			sendNotificationUtil(
				"Download finished",
				"Audio downloaded successfully!",
			);
		} else {
			setError("Error downloading audio");
			console.error("Error downloading audio:", response.statusText);
			sendNotificationUtil(
				"Download failed",
				"Error downloading audio, please try again.",
			);
		}
	};

	const getAudios = async () => {
		setLoading(true);
		const port = await getServerPort();
		const response = await fetch(`http://localhost:${port}/get-input-audios`);
		const data = await response.json();
		console.log(data);
		if (response.ok) {
			if (data.length === 0) {
				setLoading(false);
				setNotFound(true);
			} else {
				setLoading(false);
				setAudios(data);
			}
		} else {
			setLoading(false);
			setNotFound(true);
		}
	};

	useEffect(() => {
		getAudios();
	}, []);

	return (
		<div className="flex flex-col h-screen w-screen overflow-hidden">
			<div
				className="h-11 flex items-center px-4 w-fit gap-2"
				style={{ zIndex: 200 }}
			>
				<button
					className={`px-4 py-1 rounded-xl text-sm ${page === 1 ? "bg-white/10" : "border border-white/10"}`}
					onClick={() => setPage(1)}
				>
					Editor
				</button>
				<button
					className={`px-4 py-1 rounded-xl text-sm ${page === 2 ? "bg-white/10" : "border border-white/10"}`}
					onClick={() => setPage(2)}
				>
					Other
				</button>
			</div>
			<div className="flex p-4 pt-0 h-full overflow-hidden">
				{page === 1 && (
					<div className="grid gap-4 h-full w-full">
						<AudioEditorComponent />
					</div>
				)}
				{page === 2 && (
					<div className="grid grid-cols-2 gap-4 h-full w-full">
						<div className="flex flex-col gap-4 h-full overflow-hidden">
							<div className="border border-white/10 rounded-xl p-4">
								<h2 className="text-lg mb-4">Download audio from URL</h2>
								<input
									type="text"
									value={audioUrl as string}
									onChange={(e) => setAudioUrl(e.target.value)}
									className="w-full h-10 px-4 rounded-lg bg-white/10 focus:outline-none text-sm text-neutral-200 mb-4"
									placeholder="Paste here your link..."
								/>
								{error && <p className="text-red-400 text-xs mb-2">{error}</p>}
								<button
									onClick={handleDownload}
									disabled={!!status}
									className="w-full h-10 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 transition-colors duration-200"
								>
									{status || "Download"}
								</button>
							</div>
							<div className="flex-1 overflow-hidden">
								<div className="h-full overflow-y-auto">
									<MyAudiosLibrary
										setAudios={setAudios}
										setNotFound={setNotFound}
										getAudios={getAudios}
										audios={audios}
										loading={loading}
										notFound={notFound}
									/>
								</div>
							</div>
						</div>
						<div className="overflow-hidden">
							<div className="h-full overflow-y-auto">
								<UVR getAudios={getAudios} />
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
