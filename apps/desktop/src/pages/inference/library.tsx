import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";

export default function InferencesLibrary() {
  const [inferences, setInferences] = useState<any[]>([]);
  const [openInferenceId, setOpenInferenceId] = useState<number | null>(null);

  async function getServerPort() {
    const port = await invoke("get_port");
    return port;
  }

  useEffect(() => {
    async function getInferences() {
      const port = await getServerPort();
      const response = await fetch(`http://localhost:${port}/get-inferences`);

      if (response.ok) {
        const data = await response.json();
        setInferences(data);
        console.log(data);
      } else {
        console.log("Error fetching inferences");
      }
    }

    getInferences();
  }, []);

  const toggleDropdown = (id: number) => {
    setOpenInferenceId((prevId) => (prevId === id ? null : id));
  };

  const downloadAudio = async (path: string) => {
	open(path);
};

  return (
    <div className="grid h-screen w-screen">
      <main className="flex flex-col items-center justify-start mt-6 w-full overflow-visible">
        <div className="w-full flex flex-col gap-4 p-4">
          {inferences.map((inference: any) => (
            <div
              key={inference.id}
              className="flex flex-col items-center m-auto gap-2 w-full border border-white/10 rounded-xl p-4 bg-neutral-700/50"
            >
              <div className="flex flex-row gap-2 w-full">
                <div className="flex flex-col w-full">
                  <h1 className="text-2xl font-semibold title truncate max-w-3xl">
                    {decodeURIComponent(inference.model_name)}
                  </h1>
                  <p className="text-[10px] px-0.5 text-neutral-400">
                    {new Date(inference.converted_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                    })}{" "}
                    -{" "}
                    {new Date(inference.converted_at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
				<button
					type="button"
					className="rounded-lg border border-white/10 text-black p-2 flex items-center justify-center hover:bg-neutral-700/50 slow"
					onClick={() => toggleDropdown(inference.id)} 
					>
					{openInferenceId === inference.id ? (
						<svg aria-hidden="true" className="w-6 h-6 opacity-70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_iconCarrier"><path d="M6 12H18" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></g></svg>
					) : (
						<svg aria-hidden="true" className="w-6 h-6 opacity-70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_iconCarrier"><path d="M6 12H18M12 6V18" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></g></svg>
					)}
				</button>
				<button
				type="button"
				className="rounded-lg border border-white/10 text-black p-3 flex items-center justify-center hover:bg-neutral-700/50 slow" onClick={() => downloadAudio(inference.audio_output)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-70" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
				</button>
              </div>
			  {openInferenceId === inference.id && (
				<div className="mt-4 w-full bg-neutral-800/50 p-4 rounded-xl">
					<table className="w-full text-sm text-left text-neutral-300">
					<thead>
						<tr>
						<th className="px-4 py-2 text-sm font-semibold">Property</th>
						<th className="px-4 py-2 text-sm font-semibold">Value</th>
						</tr>
					</thead>
					<tbody>
						<tr>
						<td className="px-4 py-2">Index rate</td>
						<td className="px-4 py-2">{inference.indexRate}</td>
						</tr>
						<tr>
						<td className="px-4 py-2">Filter radius</td>
						<td className="px-4 py-2">{inference.filterRadius}</td>
						</tr>
						<tr>
						<td className="px-4 py-2">Autotune</td>
						<td className="px-4 py-2">{inference.autotune}</td>
						</tr>
						<tr>
						<td className="px-4 py-2">Clean audio</td>
						<td className="px-4 py-2">{inference.cleanaudio}</td>
						</tr>
						<tr>
						<td className="px-4 py-2">Export format</td>
						<td className="px-4 py-2">{inference.exportformat}</td>
						</tr>
					</tbody>
					</table>
				</div>
				)}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
