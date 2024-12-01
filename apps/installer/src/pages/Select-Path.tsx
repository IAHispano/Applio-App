import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";

export default function SelectPath() {
	const [value, setValue] = useState("");
	const navigate = useNavigate();
	const [shortcut, setShortcut] = useState(true);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const getActualDir = async () => {
			setLoading(true);
			try {
				const dir = await invoke("get_actual_dir");
				setValue(dir as string);
			} catch (err) {
				setError("Failed to fetch the directory.");
			} finally {
				setLoading(false);
			}
		};

		const dir = localStorage.getItem("dir");

		if (dir) {
			setValue(dir);
		} else {
			getActualDir();
		}
	}, []);

	const handleChange = async () => {
		setLoading(true);
		try {
			const dir = await open({
				directory: true,
				multiple: false,
			});

			if (dir) {
				localStorage.setItem("dir", dir);
				setValue(dir);
			} else {
				setError("No directory selected.");
			}
		} catch (err) {
			setError("Failed to open the directory.");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		localStorage.setItem("shortcut", shortcut.toString());
	}, [shortcut]);

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 1 }}
			className="flex justify-center items-center p-4 w-full h-full m-auto"
		>
			<div className="w-full h-full flex flex-col max-w-2xl mt-auto justify-end pb-28 text-neutral-300 gap-2">
				<h1 className="text-xl font-semibold">Installation Path</h1>
				<p className="text-neutral-300 text-xs font-semilight">
					A new folder will be created in the selected directory.
				</p>

				<div className="w-full flex gap-3 mt-2">
					<input
						value={value}
						placeholder={loading ? "Loading..." : "Select a directory"}
						readOnly
						className="shadow w-full cursor-default appearance-none px-4 py-1 bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm rounded-xl duration-400 focus:outline-none disabled:cursor-not-allowed"
						aria-label="Selected directory"
					/>
					<button
						type="button"
						onClick={handleChange}
						disabled={loading}
						className="w-fit px-4 py-1 bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm rounded-xl hover:bg-[#1c1c1c]/30 transition-all duration-400"
						aria-label="Change installation directory"
					>
						{loading ? "Loading..." : "Change"}
					</button>
				</div>

				{error && <p className="text-red-500 text-xs mt-2">{error}</p>}

				<div className="flex gap-2 p-1 items-center w-full">
					<h2 className="text-neutral-300 text-xs font-medium">
						Create shortcut
					</h2>
					<div className="inline-flex items-center">
						<label className="flex items-center cursor-pointer relative">
							<input
								checked={shortcut}
								onChange={(e) => setShortcut(e.target.checked)}
								type="checkbox"
								className="peer h-4 w-4 cursor-pointer transition-all appearance-none rounded shadow hover:shadow-md border border-slate-300 checked:bg-white"
								id="check"
								aria-label="Create a shortcut"
							/>
							<span className="absolute text-black opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="h-2.5 w-2.5"
									viewBox="0 0 20 20"
									fill="currentColor"
									stroke="currentColor"
									strokeWidth="1"
									aria-label="Checkmark"
									aria-hidden="true"
								>
									<path
										fill-rule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clip-rule="evenodd"
									/>
								</svg>
							</span>
						</label>
					</div>
				</div>
			</div>
			<div className="absolute bottom-3 right-4 flex flex-col items-center group">
				<p className="text-neutral-400 absolute text-xs text-balance text-end bottom-10 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
					Next
				</p>
				<button
					onClick={() => navigate("/install")}
					type="button"
					className="w-8 h-8 flex justify-center items-center bg-[#1c1c1c]/50 border border-white/10 text-neutral-300 text-sm rounded-xl hover:bg-[#1c1c1c]/30 transition-all duration-400"
					aria-label="Go to installation"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="w-5 h-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="m9 18 6-6-6-6" />
					</svg>
				</button>
			</div>
		</motion.div>
	);
}
