import { useEffect, useRef, useState } from "react";
import { RecordRTCPromisesHandler, StereoAudioRecorder } from "recordrtc";
import { useConvert, useConvertContext } from "../conversion-context";
import AudioPlayer from "./audio-player/audio-player";
import { FileUp, Mic, RotateCcw } from "lucide-react";

export default function AudioSelector() {
    const [recording, setRecording] = useState<boolean>(false);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
	const [recorder, setRecorder] = useState<RecordRTCPromisesHandler | null>(null);
    const [audioSection, setAudioSection] = useState("");
    const { getServerPort } = useConvert();
    const inputFileRef = useRef<HTMLInputElement | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

	const {
		file,
		setFile,
		uploaded,
		setUploaded,
		setInfo,
		setStatus,
		setInput,
        input,
		setPth,
		setIndex,
		setOutput,
		setPitch,
		setIndexRate,
		setFilterRadius,
		setAutotune,
		isPlaying,
		setConvertedAudio,
		setProgress,
		setExportFormat
	} = useConvertContext();

    const startRecording = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioRecorder = new RecordRTCPromisesHandler(stream, {
            type: "audio",
            mimeType: "audio/wav",
            recorderType: StereoAudioRecorder,
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
        setInput(result.file_path);
        setUploaded(true);
        console.log("Audio uploaded successfully:", result);
        } else {
        console.error("Error uploading audio:", response.statusText);
        }
    } catch (error) {
        console.error("Upload failed:", error);
    }
    };

      
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
            setAudioUrl(URL.createObjectURL(file));
            setAudioBlob(file);
		} catch (error) {
			console.error("Upload error:", error);
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
        setOutput(undefined)
        setConvertedAudio(undefined)
	};

    useEffect(() => {
        handleReset();
    }, [audioSection]);
	  
    return (
        <div className={`enabled:hover:opacity-100 relative ${audioBlob ? '' : 'border border-white/10'} h-full w-full rounded-xl p-4 flex flex-col gap-2 justify-center items-center`}>
            <div className="absolute w-full h-full rounded-xl backdrop-blur-3xl backdrop-filter noise opacity-40" />
            {!audioUrl && (
            <div className="absolute top-4 left-4 border border-white/10 rounded-xl overflow-hidden" style={{zIndex: 100}}>
            <div className="flex divide-x divide-white/10">
                    <button
                    aria-label="Import audio"
                    type="button"
                    onClick={() => setAudioSection("import")}
                    className="z-50 p-2 px-4 hover:bg-white/10 transition-colors duration-200 ease-in-out"
                    >
                    <FileUp className="w-5 h-5 opacity-80"/>
                    </button>
                    <button
                    aria-label="Record audio"
                    type="button"
                    onClick={() => setAudioSection("record")}
                    className="p-2 px-3.5 hover:bg-white/10 transition-colors duration-200 ease-in-out"
                    >
                    <Mic className="w-5 h-5 opacity-80"/>
                    </button>
            </div>
            </div>
            )}
            {uploaded || audioUrl ? (
                <>
                <button
                    aria-label="Reset conversion"
                    onClick={handleReset}
                    type="button"
                    style={{ zIndex: 100 }}
                    className="cursor-pointer absolute right-4 rounded-xl top-4 border border-white/10 hover:bg-white/10 slow p-3"
                >
                    <RotateCcw className="w-4 h-4 opacity-80" />
                </button>
                <p className="absolute left-4 top-9 max-w-[200px] truncate text-xs text-neutral-400">{file?.name || input}</p>
                </>
            ) : (
                <>
                {audioSection === "import" ? (
                    <FileUp className="w-12 h-12"/>
                ) : (
                    <>
                    {!audioUrl && (
                    <Mic className="w-12 h-12" />
                    )}
                    </>
                )}
                </>
            )}
            {!audioUrl && (
            <p className="text-sm text-neutral-300 z-50 truncate max-w-3xl">
                {audioSection === "import" ? "Import your audio" : recording ? "Stop Recording" : !audioUrl ? "Start Recording" : ""}
            </p>
            )}
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
            {audioUrl && audioBlob && (
                <div className="absolute inset-0 z-50">
                <AudioPlayer audioBlob={audioBlob} />
                </div>
            )}
        </div>
    )
}