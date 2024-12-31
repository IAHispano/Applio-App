export function ModelList() {
	return (
		<div className="absolute rounded-xl w-full h-full">
			<div className="absolute bottom-0 xl:left-8 xl:right-8 left-4 right-4">
				<h1 className="p-4 text-3xl title text-center font-semibold xl:max-w-5xl max-w-[200px] flex justify-center mx-auto">
					Import your model
				</h1>
				<div className="bg-[#111111]/50 mb-1 h-[40svh] rounded-t-xl overflow-hidden">
					<div className="flex flex-col gap-2 p-4">
						<div className="p-4 rounded-xl bg-[#111111]/60 hover:bg-[#111111]/80 slow">
							<h1 className="font-medium title text-sm max-w-sm truncate">
								And more...
							</h1>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
