export interface ModelType {
	id: string;
	name: string;
	epochs?: number;
	algorithm?: string;
	author?: string;
	from?: string;
	model_index_file: string;
	model_pth_file: string;
}
