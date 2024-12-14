import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Loading from "../../components/convert/loading";
import { open } from "@tauri-apps/plugin-shell";
// import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Trash } from "lucide-react";

export default function AudioEditor() {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [audios, setAudios] = useState<{ file_name: string; file_path: string; title: string; creation_time: number; modification_time: number; file_size: number; duration?: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    
    // const [inputDir, setInputDir] = useState("");
	// const [file, setFile] = useState<string | null>(null);
    // const [uploaded, setUploaded] = useState(false);
    // const [UVRLoading, setUVRLoading] = useState(false);
    // const [UVRStatus, setUVRStatus] = useState("");
    // const [UVRError, setUVRError] = useState(false);
    // const [UVRLink, setUVRLink] = useState("");

    // get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		return port;
	}

    // useEffect(() => {
    //     const getInputDir = async () => {
    //         const port = await getServerPort();
    //         const response = await fetch(`http://localhost:${port}/get-input-dir`);
    //         const data = await response.text();
    //         console.log(data);
    //         setInputDir(data);
    //     };

    //     getInputDir();
    // }, []);

    const handleDownload = async () => {
        if (!audioUrl) {
            setError("Please enter an audio URL");
            return;
        };
        setStatus("Downloading...");
        const port = await getServerPort();
        const response = await fetch(`http://localhost:${port}/download-audio?link=${encodeURIComponent(audioUrl)}`);
        console.log(response);

        if (response.ok) {
            setStatus("Audio downloaded successfully");
            getAudios();
        } else {
            setError("Error downloading audio");
            console.error("Error downloading audio:", response.statusText);
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

    const deleteAllAudios = async () => {
        const port = await getServerPort();
        const response = await fetch(`http://localhost:${port}/delete-all-input-audios`);
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
        const response = await fetch(`http://localhost:${port}/delete-input-audio?id=${encodeURIComponent(id)}`);
        if (response.ok) {
            getAudios();
        }
    };

    // const handleSelectFile = async () => {
    //     const file = await dialogOpen({
    //         directory: false,
    //         multiple: false,
    //         defaultPath: inputDir,
    //         filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "webm"] }]
    //     });
    //     if (file) {
    //         console.log(file)
    //         setFile(file);
    //         setUploaded(true);
    //     }
    // };

    // const handleSeparateInstrumental = async () => {
    //     setUVRLoading(true);
    //     const port = await getServerPort();
    //     const eventSource = new EventSource(`http://localhost:${port}/separate?path=${encodeURIComponent(file as string)}`);
    //     eventSource.onmessage = (event) => {
    //         console.log(event.data);
    //         setUVRStatus(event.data);
    //         if (event.data.includes("error")) {
    //             setUVRError(true);
    //             setUVRLoading(false);
    //             eventSource.close();
    //         }
    //         if (event.data.includes("successfully")) {
    //             setUVRLoading(false);
    //             setUVRStatus("Completed successfully.");
    //             getAudios();
    //             eventSource.close();
    //         }

    //         // if (event.data.startsWith("[") && event.data.endsWith("]")) {
    //         //     const audioPath = event.data[1].file_path;
    //         //     setUVRLink(audioPath); 
    //         //     console.log('Audio URL set to:', audioPath);
    //         // }
            
    //     };
    //     eventSource.onerror = () => {
    //         setUVRError(true);
    //         console.error("Error occurred while separating instrumental.");
    //         setUVRLoading(false);
    //         eventSource.close();
    //     };
    // };

    useEffect(() => {
        getAudios();
    }, []);

	return (
		<div className="grid h-screen w-screen">
			<main className="flex flex-col items-center justify-start mt-10 mb-4 px-4 w-full overflow-auto">
				<div className="w-full h-full flex flex-col gap-4 overflow-auto">
					<div className="grid grid-cols-2 gap-4 w-full h-full border border-white/10 rounded-xl p-4">
                    <div className="flex flex-col gap-4">
                    <div className="flex flex-col mx-auto justify-start items-start w-full h-fit p-4 gap-2 border border-white/10 rounded-xl">
                    <h2 className="text-neutral-200 mb-2 text-xl">Download audio from URL</h2>
                    <input onChange={(e) => setAudioUrl(e.target.value)} type="text" className="w-full h-10 rounded-xl focus:outline-none bg-[#111111]/20 text-sm px-4 placeholder-neutral-400" placeholder="Paste here your link..."/>
					{error && (<p className="text-xs text-red-500/50 mb-2 px-1">{error}</p>)}
                    <button disabled={!!status} onClick={handleDownload} type="button" className="px-4 mt-2 h-10 w-full rounded-xl bg-white/10 enabled:hover:bg-white/20 disabled:bg-opacity-30 slow transition-colors duration-300 border border-white/10">{status ? status : "Download"}</button>
                    </div>
                    <div className="border border-white/10 h-full rounded-xl p-4">
                    <h2 className="text-neutral-200 text-xl mb-4">Vocal remover</h2>
                    <p className="flex justify-center m-auto items-center text-xs text-neutral-400">
                        Coming soon... Stay tuned!
                    </p>
                    {/* <button disabled={!!file} onClick={handleSelectFile} type="button" className="w-full h-24 bg-neutral-600/50 enabled:hover:bg-neutral-600/70 transition-colors duration-200 rounded-xl relative">
                        <div className="flex justify-center items-center m-auto h-full">
                        {uploaded ? (
                            <p className="text-neutral-300 max-w-sm truncate text-xs">{file}</p>
                        ): (
                            <p className="text-neutral-300">Select your audio</p>
                        )}
                        </div>
                    </button>
                    <button onClick={handleSeparateInstrumental} type="button" disabled={!!UVRLoading || !file} className="disabled:cursor-not-allowed w-full text-neutral-300 text-sm h-12 bg-neutral-600/60 rounded-xl mt-4 enabled:hover:bg-neutral-600 slow">Separate instrumental</button>
                    {UVRLoading && (
                        <div className="flex flex-col gap-2 w-full mt-auto justify-end items-center">
                        {UVRStatus && (
                            <p className="text-xs text-neutral-300/50 my-2 px-1 w-full py-2 rounded-xl text-center">{UVRStatus}</p>
                        )}
                        <div className="relative w-full h-fit my-6 flex justify-center items-center">
                            <Loading />
                        </div>
                        </div>
                    )}
                    {UVRError && (
                        <p className="text-xs text-red-500/50 my-2 py-2 px-1 bg-red-500/10 rounded-xl text-center">Error detected, see the logs for more information.</p>
                    )}
                    {UVRStatus.includes("Completed") && (
                        <div className="w-full h-44 bg-neutral-600/50 rounded-xl relative mt-4 flex items-center p-4">
                            <AudioPlayer 
                            src={UVRLink}
                            showJumpControls={false}
                            layout="stacked-reverse"
                            className="rounded-xl bg-[#111111]/20 p-4 w-full h-full"
                            />
                        </div>
                    )} */}
                    </div>
                    </div>
                    <div className="flex flex-col mx-auto justify-start items-start w-full h-full p-4 gap-4 border border-white/10 rounded-xl overflow-auto">
                    <div className="flex w-full justify-between items-center">
                    <h2 className="text-neutral-200 text-xl mb-2">Your audios</h2>
                    {audios.length > 0 && (<button type="button" onClick={deleteAllAudios} className="flex justify-center items-center bg-red-500/10 p-4 py-1 rounded-xl hover:bg-red-500/20 slow text-sm">Delete all</button>)}
                    </div>
                        {audios.map((audio, index) => (
                            <div key={index} className="flex flex-col gap-3 w-full p-4 border border-white/10 rounded-xl transition-shadow duration-300">
                            <div className="flex justify-between items-center gap-5">
                              <h3 className="text-neutral-200 title font-semibold text-lg truncate">{audio.title}</h3>
                              <div className="flex gap-2">
                                <button
                                  className="p-2 rounded-xl border-white/10 hover:bg-white/10 border transition-colors duration-200"
                                  type="button"
                                  onClick={() => downloadAudio(audio.file_path)}
                                  aria-label="Download audio"
                                >
                                 <FolderOpen className="w-4 h-4 opacity-70"/>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteAudio(audio.file_path)}
                                  className="p-2 rounded-xl border-white/10 hover:bg-red-500/10 border transition-colors duration-200"
                                  aria-label="Delete audio"
                                >
                                  <Trash className="w-4 h-4 opacity-70"/>
                                </button>
                              </div>
                            </div>
                            <p className="text-neutral-400 text-[9px] font-mono select-all text-balance">{audio.file_path}</p>
                          </div>
                        ))}
                        {loading && (
                            <div className="relative w-full h-full">
                            <Loading />
                            </div>
                        )}
                        {notFound && (
                            <div className="relative w-full h-full my-auto">
                            <p className="text-center text-neutral-400 text-xs z-50 flex justify-center items-center h-full">No audios found</p>
                            </div>
                        )}
                    </div>
					</div>
				</div>
			</main>
		</div>
    );
}