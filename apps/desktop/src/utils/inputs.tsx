import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type NumberInputProps = {
	label: string;
	value: number;
	onChange: (value: number) => void;
	min: number;
	max: number;
	step?: number;
	description?: string;
};

export const NumberInput: React.FC<NumberInputProps> = ({
	label,
	value,
	onChange,
	min,
	max,
	step = 1,
	description,
}) => (
	<div className="flex flex-col gap-0">
		<h2 className="text-neutral-200 text-lg font-medium">{label}</h2>
		<div className="flex gap-2 justify-center items-center my-2">
			<input
				type="number"
				value={value}
				onChange={(e) => {
					let val = Number(e.target.value);
					if (val < min) val = min;
					if (val > max) val = max;
					onChange(val);
				}}
				step={step}
				min={min}
				max={max}
				className="w-7 text-sm text-neutral-200 bg-transparent outline-none appearance-none rounded-xl"
			/>
			<input
				type="range"
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				min={min}
				max={max}
				step={step}
				className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
			/>
		</div>
		{description && (
			<p className="text-xs text-neutral-300 break-words">{description}</p>
		)}
	</div>
);

type ToggleSwitchProps = {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	description?: string;
};

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
	label,
	checked,
	onChange,
	description,
}) => (
	<div className="flex flex-col">
		<div className="flex justify-between items-start w-full">
			<div>
				<h2 className="text-neutral-200 text-lg font-medium">{label}</h2>
				{description && (
					<p className="text-xs text-neutral-300">{description}</p>
				)}
			</div>
			<label className="flex items-center cursor-pointer relative">
				<input
					type="checkbox"
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					className="peer h-5 w-5 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border mt-2 border-white/50 checked:bg-white"
				/>
				<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
					<Check className="w-3.5 h-3.5" />
				</span>
			</label>
		</div>
	</div>
);

type SelectInputProps = {
	label: string;
	options: string[];
	value: string;
	onChange: (value: string) => void;
	description?: string;
};

export const SelectInput: React.FC<SelectInputProps> = ({
	label,
	options,
	value,
	onChange,
	description,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, []);

	return (
		<div className="flex flex-col space-y-2">
			<div className="flex justify-between items-start m-auto w-full">
				<div className="flex flex-col">
					<h2 className="text-neutral-200 text-lg font-medium">{label}</h2>
					{description && (
						<p className="text-xs text-neutral-300">{description}</p>
					)}
				</div>
				<div className="relative inline-block" ref={dropdownRef}>
					<button
						onClick={() => setIsOpen(!isOpen)}
						className="h-8 w-full min-w-[100px] max-w-[200px] flex items-center justify-between text-sm px-4 py-2 cursor-pointer transition-all rounded-lg shadow-sm hover:shadow-md border border-white/10 bg-white text-neutral-700 focus:outline-none focus:border-white/20"
					>
						<span className="truncate">{value.toUpperCase()}</span>
						<ChevronDown
							className={`ml-2 h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
						/>
					</button>

					{isOpen && (
						<div className="absolute right-0 bottom-0 mt-2 w-full min-w-[190px] max-w-[200px] max-h-60 overflow-y-auto border border-slate-200 rounded-lg bg-white shadow-xl z-10">
							{options.map((option) => (
								<div
									key={option}
									className="px-4 py-2 text-sm text-neutral-800 break-words text-wrap hover:bg-neutral-300 cursor-pointer"
									onClick={() => {
										onChange(option);
										setIsOpen(false);
									}}
								>
									{option.toUpperCase()}
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
