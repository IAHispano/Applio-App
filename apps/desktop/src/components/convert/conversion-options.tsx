import { Check } from "lucide-react";
import { useConvertContext } from "../../components/convert/conversion-context";

export default function ConversionOptions() {
    const {
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
		exportFormat,
		setExportFormat,
	} = useConvertContext();

	return (
        <div className="row-span-full w-full h-full border border-white/10 rounded-xl p-4 flex flex-col gap-6 max-h-full overflow-auto">
                <div className="flex flex-col gap-2">
                    <h2 className="text-neutral-200 text-lg font-medium">
                        Pitch
                    </h2>
                    <div className="flex gap-0 justify-center items-center">
                        <input
                            aria-label="Set pitch"
                            type="number"
                            value={pitch}
                            onChange={(e) => {
                                let value = Number.parseFloat(e.target.value);
                                if (value < -24) value = -24;
                                if (value > 24) value = 24;
                                setPitch(value);
                            }}
                            step="0.1"
                            min="-24"
                            max="24"
                            className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
                        />
                        <input
                            aria-label="Set pitch"
                            value={pitch}
                            onChange={(e) => setPitch(Number(e.target.value))}
                            type="range"
                            defaultValue="0"
                            min="-24"
                            max="24"
                            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                    <p className="text-xs text-neutral-300">
                        Set the pitch of the audio. Higher values result in a
                        higher pitch.
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <h2 className="text-neutral-200 text-lg font-medium">
                        Index Rate
                    </h2>
                    <div className="flex gap-2 justify-center items-center">
                        <input
                            aria-label="Set index rate"
                            type="number"
                            value={indexRate}
                            onChange={(e) => {
                                let value = Number.parseFloat(e.target.value);
                                if (value < 0) value = 0;
                                if (value > 1) value = 1;
                                setIndexRate(value);
                            }}
                            step="0.01"
                            min="0.0"
                            max="1.0"
                            className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
                        />
                        <input
                            aria-label="Set index rate"
                            value={indexRate}
                            onChange={(e) => setIndexRate(Number(e.target.value))}
                            type="range"
                            defaultValue="0.3"
                            min="0.0"
                            max="1.0"
                            step="0.1"
                            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                    <p className="text-xs text-neutral-300">
                        Control the influence of the index file on the output.
                        Higher values mean stronger influence. Lower values can
                        help reduce artifacts but may result in less accurate
                        voice cloning.
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <h2 className="text-neutral-200 text-lg font-medium">
                        Filter Radius
                    </h2>
                    <div className="flex gap-2 justify-center items-center">
                        <input
                            aria-label="Set filter radius"
                            type="number"
                            value={filterRadius}
                            onChange={(e) => {
                                let value = Number.parseFloat(e.target.value);
                                if (value < 0) value = 0;
                                if (value > 10) value = 10;
                                setFilterRadius(value);
                            }}
                            step="1"
                            min="0"
                            max="10"
                            className="w-8 text-sm text-neutral-200 bg-transparent outline-none appearance-none"
                        />
                        <input
                            aria-label="Set filter radius"
                            value={filterRadius}
                            onChange={(e) =>
                                setFilterRadius(Number(e.target.value))
                            }
                            type="range"
                            defaultValue="3"
                            min="0"
                            max="10"
                            className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                    <p className="text-xs text-neutral-300">
                        Apply median filtering to the extracted pitch values if
                        this value is greater than or equal to three. This can
                        help reduce breathiness in the output audio.
                    </p>
                </div>
                <div className="flex flex-col mt-8">
                    <div className="flex justify-between items-center w-full">
                        <h2 className="text-neutral-200 text-lg font-medium">
                            Autotune
                        </h2>
                        <div className="inline-flex items-center">
                            <label className="flex items-center cursor-pointer relative">
                                <input
                                    aria-label="Set autotune"
                                    checked={autotune}
                                    onChange={(e) => setAutotune(e.target.checked)}
                                    type="checkbox"
                                    className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
                                    id="check"
                                />
                                <span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                                    <Check className="w-3.5 h-3.5"/>
                                </span>
                            </label>
                        </div>
                    </div>
                    <p className="text-xs text-neutral-300">
                        Apply a light autotune to the inferred audio. Particularly
                        useful for singing voice conversions.
                    </p>
                </div>
                <div className="flex flex-col">
                    <div className="flex justify-between items-center w-full">
                        <h2 className="text-neutral-200 text-lg font-medium">
                            Clean audio
                        </h2>
                        <div className="inline-flex items-center">
                            <label className="flex items-center cursor-pointer relative">
                                <input
                                    aria-label="Set clean audio"
                                    checked={cleanAudio}
                                    onChange={(e) => setCleanAudio(e.target.checked)}
                                    type="checkbox"
                                    className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
                                    id="check"
                                />
                                <span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                                    <Check className="w-3.5 h-3.5"/>
                                </span>
                            </label>
                        </div>
                    </div>
                    <p className="text-xs text-neutral-300">
                        Clean the output audio using noise reduction algorithms.
                        Recommended for speech conversions.
                    </p>
                </div>
                <div className="flex flex-col">
                    <div className="flex justify-between items-center w-full">
                        <h2 className="text-neutral-200 text-lg font-medium">
                            Export format
                        </h2>
                        <div className="inline-flex items-center">
                            <label className="flex items-center cursor-pointer relative">
                                <select
                                    aria-label="Set export format"
                                    defaultValue={exportFormat}
                                    onChange={(e) => setExportFormat(e.target.value.toUpperCase())}
                                    className="h-8 w-fit flex items-center justify-center text-end px-4 cursor-pointer transition-all appearance-none rounded-lg shadow-sm hover:shadow-md border border-slate-300 bg-white text-slate-700 focus:outline-none focus:border-slate-400"
                                >
                                    <option value="WAV">WAV</option>
                                    <option value="MP3">MP3</option>
                                </select>
                            </label>
                        </div>
                    </div>
                    <p className="text-xs text-neutral-300">
                        Select the desired output audio format.
                    </p>
                </div>
            </div>
    )
}