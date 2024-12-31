import { Edit, FolderOpen, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getServerPort } from "../../utils/getBackendPort";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import Loading from "../convert/loading";
import Modal from "../layout/modal";

export default function ModelsLibrary() {
	const [loading, setLoading] = useState(true);
	const [downloadedModels, setDownloadedModels] = useState<any>([]);
	const [myModelsValue, setMyModelsValue] = useState("");
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [editModalOpen, setEditModalOpen] = useState(false);
	const [editModalId, setEditModalId] = useState<any | null>(null);
	const [uploadLoading, setUploadLoading] = useState(false);
	const [imagePath, setImagePath] = useState<string | null>("");
	const [imageLocalPath, setImageLocalPath] = useState<string | null>("");
	const [imageLoading, setImageLoading] = useState(false);
	const [modelName, setModelName] = useState<string | undefined>();
	const [modelEpochs, setEpochs] = useState<number | undefined>();
	const [modelAlgorithm, setAlgorithm] = useState<string | undefined>();
	const navigate = useNavigate();

	const handleImportModelImage = async () => {
		setImagePath("");
		setImageLoading(true);
		const file = await dialogOpen({
			directory: false,
			multiple: false,
			filters: [
				{ name: "Images", extensions: ["jpg", "png", "jpeg", "gif", "webp"] },
			],
		});

		if (file) {
			setImageLocalPath(file);
			const port = await getServerPort();
			const imageUrl = `http://localhost:${port}/image?path=${encodeURIComponent(file)}`;

			const response = await fetch(imageUrl, { method: "GET" });
			if (response.ok) {
				setImagePath(imageUrl);
			} else {
				console.error("Error fetching image:", response.statusText);
			}
		}
		setImageLoading(false);
	};

	useEffect(() => {
		const getDownloadedModels = async () => {
			try {
				const port = await getServerPort();
				const response = await fetch(`http://localhost:${port}/get-models`);
				if (response.ok) {
					const models = await response.json();
					setDownloadedModels(models);
					setLoading(false);
				} else {
					console.error("Error fetching models:", response.statusText);
				}
			} catch (error) {
				console.error("Fetch error:", error);
			}
		};

		getDownloadedModels();
	}, []);

	const deleteModel = async (id: string) => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-model?id=${encodeURIComponent(id)}`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					setDownloadedModels(
						downloadedModels.filter((item: any) => item.id !== id),
					);
				} else {
					console.error("Error deleting model:", data.message);
				}
			} else {
				console.error("Error deleting model:", response.statusText);
			}
		} catch (error) {
			console.error("Error deleting model:", error);
		}
	};

	const getImage = async (image: string) => {
		if (!image) return;
		setImageLocalPath(image);
		const port = await getServerPort();
		const imageUrl = `http://localhost:${port}/image?path=${image}`;
		const response = await fetch(imageUrl, { method: "GET" });
		if (response.ok) {
			setImagePath(imageUrl);
			setImageLoading(false);
		} else {
			console.error("Error fetching image:", response.statusText);
			setImageLoading(false);
			return "";
		}
	};

	const deleteAllModels = async () => {
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/delete-all-models`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					navigate(0);
				} else {
					console.error("Error deleting all models:", data.message);
				}
			} else {
				console.error("Error deleting all models:", response.statusText);
			}
		} catch (error) {
			console.error("Error deleting all models:", error);
		}
	};

	const filteredData = myModelsValue
		? downloadedModels.filter((model: { name: string }) =>
				model.name.toLowerCase().includes(myModelsValue.toLowerCase()),
			)
		: downloadedModels;

	const handleOpenEditModal = (id: string) => {
		setEditModalOpen(true);
		setEditModalId(id);
	};

	const handleUploadEdits = async () => {
		setUploadLoading(true);
		try {
			const port = await getServerPort();
			const response = await fetch(
				`http://localhost:${port}/edit-model?id=${encodeURIComponent(editModalId.id as string)}&name=${encodeURIComponent((modelName as string) || "")}&epochs=${encodeURIComponent((modelEpochs as number) || "")}&algorithm=${encodeURIComponent((modelAlgorithm as string) || "")}&image=${encodeURIComponent((imageLocalPath as string) || "")}`,
			);
			console.log(
				"url",
				`http://localhost:${port}/edit-model?id=${encodeURIComponent(editModalId.id as string)}&name=${encodeURIComponent((modelName as string) || "")}&epochs=${encodeURIComponent((modelEpochs as number) || "")}&algorithm=${encodeURIComponent((modelAlgorithm as string) || "")}&image=${encodeURIComponent((imageLocalPath as string) || "")}`,
			);
			if (response.ok) {
				const data = await response.json();
				if (data.status === "success") {
					setEditModalOpen(false);
					setUploadLoading(false);
					const modelsResponse = await fetch(
						`http://localhost:${port}/get-models`,
					);
					if (modelsResponse.ok) {
						const models = await modelsResponse.json();
						setDownloadedModels(models);
					}
				} else {
					console.error("Error editing model:", data.message);
				}
			} else {
				console.error("Error editing model:", response.statusText);
			}
		} catch (error) {
			console.error("Error editing model:", error);
		}
		setUploadLoading(false);
	};

	useEffect(() => {
		if (editModalId) {
			setModelName(editModalId.name);
			setEpochs(editModalId.epochs);
			setAlgorithm(editModalId.algorithm);
			getImage(editModalId.image);
			setImageLocalPath(editModalId.image);
		}
	}, [editModalId]);

	useEffect(() => {
		if (!editModalOpen) {
			setImagePath("");
			setImageLoading(false);
			setModelName("");
			setEpochs(undefined);
			setAlgorithm(undefined);
		}
	}, [editModalOpen]);

	return (
		<>
			{deleteModalOpen && (
				<Modal
					isOpen={deleteModalOpen}
					onClose={() => setDeleteModalOpen(false)}
					title="Delete all downloaded models"
				>
					<p className="text-sm text-neutral-300 max-w-xl">
						Are you sure you want to delete all downloaded models? This action
						cannot be undone.
					</p>
					<div className="mt-auto flex justify-end">
						<button
							type="button"
							onClick={deleteAllModels}
							className="px-6 py-1.5 bg-red-500/20 text-white rounded-xl text-sm hover:bg-red-500/30 slow"
						>
							Delete
						</button>
					</div>
				</Modal>
			)}
			{editModalOpen && (
				<Modal
					isOpen={editModalOpen}
					onClose={() => setEditModalOpen(false)}
					title="Edit model"
				>
					{!uploadLoading ? (
						<div className="flex gap-4 w-full justify-start items-start m-auto mt-4">
							<div>
								<button
									className="bg-white/10 hover:bg-white/10 rounded-xl h-56 w-48"
									onClick={handleImportModelImage}
								>
									<div className="text-sm text-neutral-300 text-center flex justify-center items-center w-full h-full rounded-xl relative">
										{imagePath ? (
											<div className="w-full h-full">
												<img
													src={imagePath}
													onLoad={() => setImageLoading(false)}
													alt="Model preview"
													className="w-full h-full object-cover rounded-xl hover:opacity-80 slow"
												/>
											</div>
										) : (
											<>
												{!imageLoading && (
													<p className="text-sm text-neutral-300">
														Select an image
													</p>
												)}
											</>
										)}
										{imageLoading && (
											<div className="absolute inset-0">
												<Loading />
											</div>
										)}
									</div>
								</button>
							</div>
							<div className="flex flex-col gap-4 w-full">
								<input
									type="text"
									className="w-full h-12 rounded-xl focus:outline-none bg-white/10 text-sm p-4"
									placeholder="Enter a new name for your model"
									value={modelName ? decodeURIComponent(modelName) : ""}
									onChange={(e) => setModelName(e.target.value)}
								/>
								<input
									type="number"
									className="w-full h-12 rounded-xl focus:outline-none bg-white/10 text-sm p-4"
									placeholder="Enter the new epochs number for your model"
									value={modelEpochs || ""}
									onChange={(e) => setEpochs(parseInt(e.target.value))}
								/>
								<input
									type="text"
									className="w-full h-12 rounded-xl focus:outline-none bg-white/10 text-sm p-4"
									placeholder="Enter a new algorithm for your model"
									value={modelAlgorithm || ""}
									onChange={(e) => setAlgorithm(e.target.value)}
								/>
							</div>
						</div>
					) : (
						<div className="flex flex-col items-center justify-center w-full h-full mb-12">
							<Loading />
						</div>
					)}
					<div className="mt-4 flex justify-end gap-4">
						<button
							type="button"
							onClick={handleUploadEdits}
							className="px-6 py-1.5 bg-white/10 text-white rounded-xl text-sm hover:bg-white/20 slow"
						>
							Save
						</button>
					</div>
				</Modal>
			)}
			{loading && (
				<div className="flex flex-col items-center justify-center w-full h-full mb-12">
					<Loading />
				</div>
			)}
			{downloadedModels.length === 0 && !loading && (
				<div className="flex flex-col items-center justify-center w-full h-full mb-12">
					<h1 className="text-center text-sm text-neutral-400">
						No models found
					</h1>
				</div>
			)}

			{!loading && downloadedModels.length > 0 && (
				<div className="flex gap-2 w-full">
					<input
						type="text"
						className="w-full h-12 rounded-xl focus:outline-none bg-white/10 text-sm p-4"
						placeholder="Search..."
						value={myModelsValue}
						onChange={(e) => setMyModelsValue(e.target.value)}
						aria-label="Search for downloaded models"
					/>
					<button
						onClick={() => setDeleteModalOpen(true)}
						className="w-fit rounded-xl bg-red-500/10 p-4 justify-center items-center flex text-sm text-neutral-200 hover:shadow-xl hover:shadow-red-500/10 hover:bg-red-500/20 slow"
						type="button"
						aria-label="Delete all downloaded models"
					>
						<Trash className="w-4 h-4 opacity-70" />
					</button>
				</div>
			)}
			<div className="w-full grid grid-cols-3 gap-4">
				{filteredData.map(
					(item: {
						id: string;
						name: string;
						downloaded_at: string;
						model_folder_path: string;
					}) => (
						<div
							key={item.id}
							className="w-full h-full min-h-[15svh] text-left rounded-xl focus:outline-none border border-white/10 p-4 flex flex-col items-start justify-start"
						>
							<div className="flex justify-between w-full items-center">
								<h1 className="text-center text-neutral-300 font-semibold title truncate max-w-[200px]">
									{decodeURIComponent(item.name)}
								</h1>
								<div className="flex gap-2">
									<button
										className="rounded-xl border border-white/10 p-2 slow hover:shadow-xl hover:shadow-neutral-700 text-sm"
										type="button"
										onClick={() => handleOpenEditModal(item as any)}
										aria-label="Edit model name"
									>
										<Edit className="w-4 h-4 opacity-70" />
									</button>
									<button
										className="rounded-xl border border-white/10 p-2 slow hover:shadow-xl hover:shadow-neutral-700 text-sm"
										type="button"
										onClick={() => open(item.model_folder_path)}
										aria-label="Open model folder"
									>
										<FolderOpen className="w-4 h-4 opacity-70" />
									</button>
									<button
										type="button"
										className="rounded-xl border border-white/10 p-2 hover:bg-red-500/20 hover:shadow-xl hover:shadow-red-500/20 text-sm text-white slow"
										onClick={() => deleteModel(item.id)}
										aria-label={`Delete model ${item.name}`}
									>
										<Trash className="w-4 h-4 opacity-70" />
									</button>
								</div>
							</div>
							<div className="flex mt-auto ml-auto">
								<p className="text-xs text-neutral-400">
									{new Date(item.downloaded_at).toLocaleDateString("en-US", {
										year: "numeric",
										month: "long",
										day: "numeric",
									})}
								</p>
							</div>
						</div>
					),
				)}
			</div>
		</>
	);
}
