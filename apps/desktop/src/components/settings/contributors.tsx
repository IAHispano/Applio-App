import { useEffect, useState } from "react";
import { supabase } from "../../utils/database";
import Loading from "../convert/loading";

export default function Contributors() {
	const [contributors, setContributors] = useState<
		{ avatar_url: string; full_name: string; admin: boolean; role: string }[]
	>([]);
	const [loading, setLoading] = useState<boolean>(true);

	useEffect(() => {
		async function getContributors() {
			setLoading(true);
			try {
				const data = await supabase
					?.from("profiles")
					.select("avatar_url, full_name, admin, role")
					.eq("tester", "true")
					.then((response) => response);
				if (data?.error) {
					console.error(data.error);
				} else {
					setContributors(
						data?.data as {
							avatar_url: string;
							full_name: string;
							admin: boolean;
							role: string;
						}[],
					);
				}
			} catch (error) {
				console.error(error);
			} finally {
				setLoading(false);
			}
		}

		getContributors();
	}, []);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col">
				<h3 className="text-neutral-300 font-semibold mt-12">Contributors</h3>
			</div>
			{loading ? (
				<Loading />
			) : (
				<ul className="grid grid-cols-5 gap-x-0.5 text-xs text-neutral-400">
					{contributors.map((contributor) => (
						<li className="break-all" key={contributor.full_name}>
							{contributor.full_name}
							<span className="opacity-70">
								{contributor.admin && (
									<span className="text-neutral-300"> 🍏</span>
								)}
								{contributor.role === "premium" && (
									<span className="text-neutral-300"> 💌</span>
								)}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
