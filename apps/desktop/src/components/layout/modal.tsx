import { X } from "lucide-react";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	children: React.ReactNode;
	title?: string;
}

export default function Modal({
	isOpen,
	onClose,
	children,
	title,
}: ModalProps) {
	return (
		<>
			{isOpen && (
				<div
					className="absolute inset-0 bg-[#111111]/80 backdrop-blur-2xl backdrop-filter w-screen h-full overflow-hidden"
					style={{ zIndex: 250 }}
				>
					<div className="w-full h-full flex justify-center items-center">
						<div className="w-full max-w-2xl h-fit min-h-[30svh] border border-white/10 bg-[#2a2b2a] shadow-2xl shadow-white/10 rounded-xl p-4 flex flex-col relative">
							<button
								className="absolute right-4 top-4 rounded-xl border border-white/10 p-2 hover:bg-white/10 hover:shadow-xl hover:shadow-white/10 slow"
								onClick={onClose}
								aria-label="Close modal"
							>
								<X className="w-4 h-4 opacity-70" />
							</button>
							{title && (
								<div className="flex my-2">
									<h2 className="text-2xl text-neutral-200 font-semibold title">
										{title}
									</h2>
								</div>
							)}
							{children}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
