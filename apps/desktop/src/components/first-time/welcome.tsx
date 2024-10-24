import Background0 from "../svg/background0";

interface PreInstallProps {
	next: () => void;
}

export default function Welcome(props: PreInstallProps) {
	return (
		<section className="absolute inset-0 w-screen h-screen z-50 overflow-hidden bg-[#111111]">
			<Background0 />
			<div className="absolute inset-0 mt-auto flex z-50">
				<div className="flex flex-col items-center justify-center m-auto rounded-xl h-fit w-full max-w-xl py-3 bg-neutral-400/20">
					<h1 className="text-5xl max-xl:text-4xl font-bold z-50 mt-6 mb-2 title">
						Alpha release
					</h1>
					<p className="text-justify max-xl:max-w-[380px] max-w-[500px] text-sm text-neutral-300">
						We are delighted that you are trying Applio APP. As with any initial
						release, this version may contain bugs. We ask that you please
						report any problems you encounter via our discord. Your help will
						contribute to improving the user experience so that more people can
						use Applio for free.
					</p>
					<button
						type="button"
						className="rounded-xl bg-white text-black font-semibold px-8 py-2 mt-[5svh] hover:bg-white/80 slow"
						onClick={props.next}
					>
						Next
					</button>
				</div>
			</div>

			<p className="text-white/60 text-xs text-center absolute bottom-12 inset-x-0">
				Copyright © 2024 Applio.
			</p>
		</section>
	);
}
