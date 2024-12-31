import { useCallback } from "react";

export const useAudioProcessor = () => {
	const cutAudio = useCallback(
		(
			audioBuffer: AudioBuffer,
			selection: { start: number; end: number },
		): AudioBuffer => {
			const sampleRate = audioBuffer.sampleRate;
			const channels = audioBuffer.numberOfChannels;
			const startSample = Math.floor(selection.start * sampleRate);
			const endSample = Math.floor(selection.end * sampleRate);
			const newLength = endSample - startSample;

			// Create a new buffer for the selected portion
			const newBuffer = new AudioContext().createBuffer(
				channels,
				newLength,
				sampleRate,
			);

			// Copy the selected portion for each channel
			for (let channel = 0; channel < channels; channel++) {
				const newData = newBuffer.getChannelData(channel);
				const originalData = audioBuffer.getChannelData(channel);

				// Use TypedArray.set for better performance
				newData.set(originalData.subarray(startSample, endSample));
			}

			return newBuffer;
		},
		[],
	);

	return { cutAudio };
};
