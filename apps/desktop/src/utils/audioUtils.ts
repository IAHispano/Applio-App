export const bufferToWav = (audioBuffer: AudioBuffer): ArrayBuffer => {
	const numOfChan = audioBuffer.numberOfChannels;
	const length = audioBuffer.length * numOfChan * 2;
	const buffer = new ArrayBuffer(44 + length);
	const view = new DataView(buffer);
	const channels = [];
	let sample = 0;
	let offset = 0;
	let pos = 0;

	// write WAVE header
	setUint32(0x46464952); // "RIFF"
	setUint32(36 + length); // file length - 8
	setUint32(0x45564157); // "WAVE"

	setUint32(0x20746d66); // "fmt " chunk
	setUint32(16); // length = 16
	setUint16(1); // PCM (uncompressed)
	setUint16(numOfChan);
	setUint32(audioBuffer.sampleRate);
	setUint32(audioBuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
	setUint16(numOfChan * 2); // block-align
	setUint16(16); // 16-bit

	setUint32(0x61746164); // "data" - chunk
	setUint32(length); // chunk length

	// write interleaved data
	for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
		channels.push(audioBuffer.getChannelData(i));
	}

	while (pos < length) {
		for (let i = 0; i < numOfChan; i++) {
			sample = Math.max(-1, Math.min(1, channels[i][offset]));
			sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
			view.setInt16(pos, sample, true);
			pos += 2;
		}
		offset++;
	}

	return buffer;

	function setUint16(data: number) {
		view.setUint16(pos, data, true);
		pos += 2;
	}

	function setUint32(data: number) {
		view.setUint32(pos, data, true);
		pos += 4;
	}
};
