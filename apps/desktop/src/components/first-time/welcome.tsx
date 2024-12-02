import Background0 from "../svg/background0";

interface PreInstallProps {
	next: () => void;
}

export default function Welcome(props: PreInstallProps) {
	return (
		<section className="absolute inset-0 w-screen h-screen z-50 overflow-hidden bg-[#111111]">
			<Background0 />
			<div className="absolute inset-0 flex items-center justify-center">
				<div className="flex flex-col items-center justify-center bg-neutral-700/40 rounded-xl p-8 max-w-lg w-full">
					<h1 className="text-3xl font-bold text-white mb-4 title">
						Welcome to Applio App
					</h1>
					<p className="text-base text-neutral-300 text-center leading-relaxed max-w-md">
						Thank you for exploring the Alpha release of Applio App. Please note
						that this early version might have some bugs. We would greatly
						appreciate your feedback—report any issues via our Discord.
						Together, we can make Applio App better for everyone.
					</p>
					<button
						type="button"
						className="mt-8 px-6 py-3 text-sm font-semibold text-black bg-white rounded-lg shadow-lg hover:bg-gray-200 transition duration-300"
						onClick={props.next}
						aria-label="Proceed to the next step"
					>
						Get Started
					</button>
				</div>
			</div>
			<p className="absolute bottom-8 inset-x-0 text-xs text-center text-white/70">
				© 2024 Applio. All rights reserved.
			</p>
		</section>
	);
}
