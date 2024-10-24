import React, { createContext, useContext, useState, ReactNode } from 'react';

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
    output: string;
    setOutput: React.Dispatch<React.SetStateAction<string>>;
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
    setConvertedAudio: React.Dispatch<React.SetStateAction<string>>;
    convertTime: string;
    setConvertTime: React.Dispatch<React.SetStateAction<string>>;
}

const ConvertContext = createContext<ConvertContextType | undefined>(undefined);

interface ConvertProviderProps {
    children: ReactNode;
}

export const ConvertProvider: React.FC<ConvertProviderProps> = ({ children }) => {
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
    const [output, setOutput] = useState("");
    const [pitch, setPitch] = useState(0);
    const [indexRate, setIndexRate] = useState(0.3);
    const [filterRadius, setFilterRadius] = useState(3);
    const [autotune, setAutotune] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState('0');
    const [convertedAudio, setConvertedAudio] = useState('');
    const [convertTime, setConvertTime] = useState('');

    return (
        <ConvertContext.Provider value={{
            models, setModels,
            currentIndex, setCurrentIndex,
            file, setFile,
            uploaded, setUploaded,
            info, setInfo,
            status, setStatus,
            error, setError,
            input, setInput,
            pth, setPth,
            index, setIndex,
            output, setOutput,
            pitch, setPitch,
            indexRate, setIndexRate,
            filterRadius, setFilterRadius,
            autotune, setAutotune,
            isPlaying, setIsPlaying,
            progress, setProgress,
            convertedAudio, setConvertedAudio,
            convertTime, setConvertTime,
        }}>
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
