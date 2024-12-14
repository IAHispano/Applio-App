import { invoke } from "@tauri-apps/api/core";
import React, { createContext, useContext, useState, ReactNode } from "react";

interface ConvertContextType {
	models: any[];
	setModels: React.Dispatch<React.SetStateAction<any[]>>;
	currentIndex: number;
	setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
	file: File | null;
	setFile: React.Dispatch<React.SetStateAction<File | null>>;
	uploaded: boolean;
	setUploaded: React.Dispatch<React.SetStateAction<boolean>>;
	info: string;
	setInfo: React.Dispatch<React.SetStateAction<string>>;
	status: string;
	setStatus: React.Dispatch<React.SetStateAction<string>>;
	error: boolean;
	setError: React.Dispatch<React.SetStateAction<boolean>>;
	input: string;
	setInput: React.Dispatch<React.SetStateAction<string>>;
	pth: string;
	setPth: React.Dispatch<React.SetStateAction<string>>;
	index: string;
	setIndex: React.Dispatch<React.SetStateAction<string>>;
	output: Blob | undefined;
	setOutput: React.Dispatch<React.SetStateAction<Blob | undefined>>;
	pitch: number;
	setPitch: React.Dispatch<React.SetStateAction<number>>;
	indexRate: number;
	setIndexRate: React.Dispatch<React.SetStateAction<number>>;
	filterRadius: number;
	setFilterRadius: React.Dispatch<React.SetStateAction<number>>;
	autotune: boolean;
	setAutotune: React.Dispatch<React.SetStateAction<boolean>>;
	isPlaying: boolean;
	setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
	progress: string;
	setProgress: React.Dispatch<React.SetStateAction<string>>;
	convertedAudio: string;
	setConvertedAudio: React.Dispatch<React.SetStateAction<string | undefined>>;
	convertTime: string;
	setConvertTime: React.Dispatch<React.SetStateAction<string>>;
	cleanAudio: boolean;
	setCleanAudio: React.Dispatch<React.SetStateAction<boolean>>;
	exportFormat: string;
	setExportFormat: React.Dispatch<React.SetStateAction<string>>;
	modelName: string;
	setModelName: React.Dispatch<React.SetStateAction<string>>;
	currentModel: any;
	setCurrentModel: React.Dispatch<React.SetStateAction<any>>;
}

const ConvertContext = createContext<ConvertContextType | undefined>(undefined);

interface ConvertProviderProps {
	children: ReactNode;
}

export const ConvertProvider: React.FC<ConvertProviderProps> = ({
	children,
}) => {
	const [models, setModels] = useState<any[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [file, setFile] = useState<File | null>(null);
	const [uploaded, setUploaded] = useState(false);
	const [info, setInfo] = useState("");
	const [status, setStatus] = useState("");
	const [error, setError] = useState(false);
	const [input, setInput] = useState("");
	const [pth, setPth] = useState("");
	const [index, setIndex] = useState("");
	const [output, setOutput] = useState<Blob | undefined>();
	const [pitch, setPitch] = useState<number>(0);
	const [indexRate, setIndexRate] = useState(0.3);
	const [filterRadius, setFilterRadius] = useState(3);
	const [autotune, setAutotune] = useState(false);
	const [isPlaying, setIsPlaying] = useState(false);
	const [progress, setProgress] = useState("0");
	const [convertedAudio, setConvertedAudio] = useState("");
	const [convertTime, setConvertTime] = useState("");
	const [cleanAudio, setCleanAudio] = useState(false);
	const [exportFormat, setExportFormat] = useState("WAV");
	const [modelName, setModelName] = useState("");
	const [currentModel, setCurrentModel] = useState<any>(null);

	return (
		<ConvertContext.Provider
			value={{
				models,
				setModels,
				currentIndex,
				setCurrentIndex,
				file,
				setFile,
				uploaded,
				setUploaded,
				info,
				setInfo,
				status,
				setStatus,
				error,
				setError,
				input,
				setInput,
				pth,
				setPth,
				index,
				setIndex,
				output,
				setOutput,
				pitch,
				setPitch,
				indexRate,
				setIndexRate,
				filterRadius,
				setFilterRadius,
				autotune,
				setAutotune,
				cleanAudio,
				setCleanAudio,
				isPlaying,
				setIsPlaying,
				progress,
				setProgress,
				convertedAudio,
				setConvertedAudio,
				convertTime,
				setConvertTime,
				exportFormat,
				setExportFormat,
				modelName,
				setModelName,
				currentModel, 
				setCurrentModel
			}}
		>
			{children}
		</ConvertContext.Provider>
	);
};

export const useConvertContext = () => {
	const context = useContext(ConvertContext);
	if (!context) {
		throw new Error("useConvertContext must be used within a ConvertProvider");
	}
	return context;
};

export const useConvert = () => {
	const {
		setStatus,
		setError,
		input,
		currentModel,
		pitch,
		indexRate,
		filterRadius,
		autotune,
		cleanAudio,
		exportFormat,
		modelName,
		setInfo,
		info,
		setConvertTime,
		setConvertedAudio,
		setOutput
	} = useConvertContext();

	// get server port
	async function getServerPort() {
		const port = await invoke("get_port");
		console.log("port", port);
		return port;
	}

	function transformPath(path: string) {
		return path.replace(/\\/g, "/");
	}

	async function getAudio(path: string) {
		const transformedPath = transformPath(path);
		const port = await getServerPort();
		try {
			const response = await fetch(
				`http://localhost:${port}/audio?path=${encodeURIComponent(
					transformedPath,
				)}`,
			);
			if (!response.ok) {
				throw new Error("Error getting audio");
			}
			const audioBlob = await response.blob();
			setOutput(audioBlob);
		} catch (error) {
			console.error("Error:", error);
		}
	}


	const convert = async () => {
		const startingTime = performance.now();
		setInfo("Starting...");
		setStatus("Sending request...");
		setError(false);

		const time = setInterval(() => {
			const actualTime = performance.now();
			const duration = (actualTime - startingTime) / 1000;
			setConvertTime(duration.toFixed(2));
		}, 100);

		console.log('export format', exportFormat.toUpperCase());

		const port = await getServerPort();
		console.log('INDEX AND PTH', currentModel.model_pth_file, currentModel.model_index_file);
		try {
			const url = `http://localhost:${port}/convert?input=${encodeURIComponent(
				input,
			)}&pth=${encodeURIComponent(currentModel.model_pth_file)}&index=${encodeURIComponent(
				currentModel.model_index_file,
			)}&pitch=${encodeURIComponent(pitch)}&indexRate=${encodeURIComponent(
				indexRate,
			)}&filterRadius=${encodeURIComponent(
				filterRadius,
			)}&autotune=${encodeURIComponent(
				autotune,
			)}&cleanaudio=${encodeURIComponent(
				cleanAudio,
			)}&exportformat=${
				exportFormat.toUpperCase()
			}&name=${encodeURIComponent(modelName)}`;
			const eventSource = new EventSource(url);
			console.log(url);
			eventSource.onmessage = (event) => {
				console.log(event.data);
				setStatus(event.data);
				if (event.data.includes("error")) {
					setInfo("Error");
					setStatus("An error has occurred, please try again.");
					setError(true);
					clearInterval(time);
					eventSource.close();
				}
				if (event.data.includes("finished")) {
					const audioPath = event.data.split("Audio path: ")[1];
					console.log(audioPath);
					setConvertedAudio(audioPath);
					getAudio(audioPath);
					setInfo("Conversion completed!");
					setStatus("Your audio has been converted successfully.");
					clearInterval(time);
					eventSource.close();
				}

				if (event.data.includes("completed")) {
					setInfo("Finishing...");
					setStatus("Receiving audio...");
					clearInterval(time);
				}
			};

			eventSource.onerror = (err) => {
				console.log(info);
				console.error("Error with event source:", err);
				eventSource.close();
				setError(true);
				clearInterval(time);
				setStatus("We detected an error, please try again.");
			};

			return () => {
				eventSource.close();
				clearInterval(time);
			};
		} catch (error) {
			console.error("Error:", error);
			clearInterval(time);
			setStatus("We detected an error. Please try again later.");
		}
	};

	return { convert, getServerPort, transformPath, getAudio };
}
