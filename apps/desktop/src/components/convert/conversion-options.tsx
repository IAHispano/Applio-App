import { useConvertContext } from "../../components/convert/conversion-context";
import { NumberInput, SelectInput, ToggleSwitch } from "../../utils/inputs";

export default function ConversionOptions() {
	const optionsConfig = [
		{
			type: "number",
			key: "pitch",
			label: "Pitch",
			min: -24,
			max: 24,
			step: 0.1,
			description:
				"Set the pitch of the audio. Higher values result in a higher pitch.",
		},
		{
			type: "number",
			key: "indexRate",
			label: "Index Rate",
			min: 0,
			max: 1,
			step: 0.01,
			description:
				"Control the influence of the index file on the output. Higher values mean stronger influence.",
		},
		{
			type: "number",
			key: "filterRadius",
			label: "Filter Radius",
			min: 0,
			max: 10,
			step: 1,
			description:
				"Apply median filtering to reduce breathiness in the output audio.",
		},
		{
			type: "number",
			key: "hopLength",
			label: "Hop Length",
			min: 1,
			max: 512,
			step: 10,
			description:
				"Only applicable for the Crepe pitch extraction method. Determines the time it takes for the system to react to a significant pitch change. Smaller values require more processing time but can lead to better pitch accuracy.",
		},
		{
			type: "toggle",
			key: "autotune",
			label: "Autotune",
			description: "Apply a light autotune to the inferred audio.",
		},
		{
			type: "toggle",
			key: "cleanAudio",
			label: "Clean Audio",
			description: "Clean the output audio using noise reduction algorithms.",
		},
		{
			type: "select",
			key: "exportFormat",
			label: "Export Format",
			options: ["WAV", "MP3"],
			description: "Select the desired output audio format.",
		},
		{
			type: "select",
			key: "f0Method",
			label: "F0 Method",
			options: [
				"crepe",
				"crepe-tiny",
				"rmvpe",
				"fcpe",
				"hybrid[crepe+rmvpe]",
				"hybrid[crepe+fcpe]",
				"hybrid[rmvpe+fcpe]",
				"hybrid[crepe+rmvpe+fcpe]",
			],
			description:
				"Select the method for extracting the fundamental frequency.",
		},
	];

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
		hopLength,
		setHopLength,
		f0Method,
		setF0Method,
	} = useConvertContext();

	const optionHandlers: Record<string, any> = {
		pitch: { value: pitch, onChange: setPitch },
		indexRate: { value: indexRate, onChange: setIndexRate },
		filterRadius: { value: filterRadius, onChange: setFilterRadius },
		autotune: { value: autotune, onChange: setAutotune },
		cleanAudio: { value: cleanAudio, onChange: setCleanAudio },
		exportFormat: { value: exportFormat, onChange: setExportFormat },
		hopLength: { value: hopLength, onChange: setHopLength },
		f0Method: { value: f0Method, onChange: setF0Method },
	};

	return (
		<div className="w-full h-full border border-white/10 rounded-xl p-4 overflow-auto">
			<div className="flex flex-col gap-6">
				{optionsConfig.map((option) => {
					const handler = optionHandlers[option.key];
					if (option.type === "number") {
						return (
							<NumberInput
								key={option.key}
								label={option.label}
								value={handler.value}
								onChange={handler.onChange}
								min={option.min as number}
								max={option.max as number}
								step={option.step}
								description={option.description}
							/>
						);
					}
					if (option.type === "toggle") {
						return (
							<div className={`${option.key === "autotune" ? "mt-10" : ""}`}>
								<ToggleSwitch
									key={option.key}
									label={option.label}
									checked={handler.value}
									onChange={handler.onChange}
									description={option.description}
								/>
							</div>
						);
					}
					if (option.type === "select") {
						return (
							<SelectInput
								label={option.label}
								options={option.options ?? []}
								value={handler.value}
								onChange={handler.onChange}
								description={option.description}
							/>
						);
					}
				})}
			</div>
		</div>
	);
}
