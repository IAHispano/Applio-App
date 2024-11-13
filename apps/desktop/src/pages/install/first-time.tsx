import { useState } from "react";
import Welcome from "../../components/first-time/welcome";
import PreInstall from "../../components/first-time/pre-install";

export default function FirstTime() {
	const [page, setPage] = useState(0);

	const handleNextPage = () => {
		setPage(page + 1);
	};

	return (
		<main className="absolute inset-0 bg-[#0a0a0a] w-full h-full p-4 flex flex-col justify-center items-center">
			{page === 0 && <Welcome next={handleNextPage} />}
			{page === 1 && <PreInstall />}
		</main>
	);
}
