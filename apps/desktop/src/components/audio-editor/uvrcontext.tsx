import React, { createContext, useContext, ReactNode, useState } from "react";
import { getServerPort } from "../../utils/getBackendPort";
import { sendNotificationUtil } from "../../utils/sendNotification";

interface UVRContextProps {
	inputDir: string;
	file: string | null;
	uploaded: boolean;
	UVRLoading: boolean;
	UVRStatus: string;
	UVRError: boolean;
	UVRLink: Blob | undefined;
	isOpen: boolean;
	stemIsOpen: boolean;
	selectedStem: string | null;
	selectedModel: string | null;
	sampleRate: number;
	models: any[];
	loadingModels: boolean;
	search: string;
	stemOptions: string[];
	setInputDir: React.Dispatch<React.SetStateAction<string>>;
	setFile: React.Dispatch<React.SetStateAction<string | null>>;
	setUploaded: React.Dispatch<React.SetStateAction<boolean>>;
	setUVRLoading: React.Dispatch<React.SetStateAction<boolean>>;
	setUVRStatus: React.Dispatch<React.SetStateAction<string>>;
	setUVRError: React.Dispatch<React.SetStateAction<boolean>>;
	setUVRLink: React.Dispatch<React.SetStateAction<Blob | undefined>>;
	setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setStemIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setSelectedStem: React.Dispatch<React.SetStateAction<string | null>>;
	setSelectedModel: React.Dispatch<React.SetStateAction<string | null>>;
	setSampleRate: React.Dispatch<React.SetStateAction<number>>;
	setModels: React.Dispatch<React.SetStateAction<any[]>>;
	setLoadingModels: React.Dispatch<React.SetStateAction<boolean>>;
	setSearch: React.Dispatch<React.SetStateAction<string>>;
	handleSeparateInstrumental: () => Promise<void>;
	UVRinfo: string;
	setUVRinfo: React.Dispatch<React.SetStateAction<string>>;
	handleReset: () => void;
}

export const UVRContext = createContext<UVRContextProps | undefined>(undefined);

export const UVRProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const [inputDir, setInputDir] = useState<string>("");
	const [file, setFile] = useState<string | null>(null);
	const [uploaded, setUploaded] = useState<boolean>(false);
	const [UVRLoading, setUVRLoading] = useState<boolean>(false);
	const [UVRStatus, setUVRStatus] = useState<string>("");
	const [UVRError, setUVRError] = useState<boolean>(false);
	const [UVRLink, setUVRLink] = useState<Blob | undefined>(undefined);
	const [isOpen, setIsOpen] = useState<boolean>(false);
	const [stemIsOpen, setStemIsOpen] = useState<boolean>(false);
	const [selectedStem, setSelectedStem] = useState<string | null>("Vocal");
	const [selectedModel, setSelectedModel] = useState<string | null>(
		"2_HP-UVR.pth",
	);
	const [sampleRate, setSampleRate] = useState<number>(44100);
	const [models, setModels] = useState<any[]>([]);
	const [loadingModels, setLoadingModels] = useState<boolean>(true);
	const [search, setSearch] = useState<string>("");
	const [UVRinfo, setUVRinfo] = useState<string>("");
	const stemOptions = [
		"Instrumental",
		"Vocal",
		"Bass",
		"Guitar",
		"Piano",
		"Other",
	];

	const handleSeparateInstrumental = async () => {
		setUVRinfo("Starting instrumental separation...");
		setUVRLoading(true);
		sendNotificationUtil("Separation started", "Separating instrumental...");
		const port = await getServerPort();
		const eventSource = new EventSource(
			`http://localhost:${port}/separate?path=${encodeURIComponent(file as string)}&model=${encodeURIComponent(selectedModel as string)}&single_stem=${encodeURIComponent(selectedStem as string)}&sample_rate=${encodeURIComponent(sampleRate as number)}`,
		);
		eventSource.onmessage = (event) => {
			console.log(event.data);
			setUVRStatus(event.data);
			if (event.data.includes("error") || event.data.includes("RuntimeError")) {
				setUVRError(true);
				setUVRLoading(false);
				console.log("Error detected in separation process.", event.data);
				eventSource.close();
				sendNotificationUtil(
					"Separation failed",
					"Error separating instrumental, please try again.",
				);
			}
			if (event.data.includes("successfully")) {
				setUVRinfo("Completed instrumental separation.");
				setUVRLoading(false);
				setUVRStatus("Completed successfully.");
				window.location.reload(); // thinking about a better way to do this
				eventSource.close();
				sendNotificationUtil(
					"Separation finished",
					"Instrumental separation finished!",
				);
			}

			if (event.data.startsWith("[") && event.data.endsWith("]")) {
				const audioPath = event.data[1].file_path;
				setUVRLink(audioPath);
				console.log("Audio URL set to:", audioPath);
			}
		};
		eventSource.onerror = () => {
			setUVRError(true);
			console.error("Error occurred while separating instrumental.");
			setUVRLoading(false);
			eventSource.close();
			sendNotificationUtil(
				"Separation failed",
				"Error separating instrumental, please try again.",
			);
		};
	};

	const handleReset = () => {
		setInputDir("");
		setFile(null);
		setUploaded(false);
		setUVRLoading(false);
		setUVRStatus("");
		setUVRError(false);
		setUVRLink(undefined);
		setIsOpen(false);
		setStemIsOpen(false);
		setSelectedStem("Vocal");
		setSelectedModel("2_HP-UVR.pth");
		setSampleRate(44100);
		setModels([]);
		setLoadingModels(true);
		setSearch("");
		setUVRinfo("");
	};

	return (
		<UVRContext.Provider
			value={{
				inputDir,
				file,
				uploaded,
				UVRLoading,
				UVRStatus,
				UVRError,
				UVRLink,
				isOpen,
				stemIsOpen,
				selectedStem,
				selectedModel,
				sampleRate,
				models,
				loadingModels,
				search,
				stemOptions,
				setInputDir,
				setFile,
				setUploaded,
				setUVRLoading,
				setUVRStatus,
				setUVRError,
				setUVRLink,
				setIsOpen,
				setStemIsOpen,
				setSelectedStem,
				setSelectedModel,
				setSampleRate,
				setModels,
				setLoadingModels,
				setSearch,
				handleSeparateInstrumental,
				UVRinfo,
				setUVRinfo,
				handleReset,
			}}
		>
			{children}
		</UVRContext.Provider>
	);
};

export const useUVR = (): UVRContextProps => {
	const context = useContext(UVRContext);
	if (!context) {
		throw new Error("useUVR must be used within a UVRProvider");
	}
	return context;
};
