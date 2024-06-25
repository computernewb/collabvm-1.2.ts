export default class CollabVMCapabilities {
    // Support for JPEG screen rects in binary msgpack format
    bin: boolean;

    constructor() {
        this.bin = false;
    }
}